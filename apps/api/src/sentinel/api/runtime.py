"""Process-wide bus, key pool, and investigation runner."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import structlog
from pydantic import SecretStr

from sentinel.core.config import Settings
from sentinel.core.errors import EvidenceIntegrityError
from sentinel.db.repositories import Repositories
from sentinel.db.session import build_engine, init_schema, session_factory
from sentinel.orchestrator.bus import EventBus, sign_head
from sentinel.orchestrator.engine import (
    InvestigationOrchestrator,
    InvestigationTarget,
    TargetEnricher,
    TinyFishNavigator,
)
from sentinel.tinyfish import AgentEvent, AgentRunRequest, KeyLease, KeyPool, TinyFishClient

log = structlog.get_logger(__name__)


class PoolNavigator:
    """Agent stream that keeps the orchestrator lease while the client runs.

    VERIFY: ``TinyFishClient.stream_agent`` acquires a second lease. The
    orchestrator already holds ``lease``. The pool is sized so both fit.
    """

    def __init__(self, client: TinyFishClient) -> None:
        self._client = client

    def stream(
        self,
        request: AgentRunRequest,
        lease: KeyLease,
    ) -> AsyncIterator[AgentEvent]:
        """Yield Agent events. ``lease`` is the orchestrator's key."""
        log.info("agent_stream", key_label=lease.label)

        async def _events() -> AsyncIterator[AgentEvent]:
            async for event in self._client.stream_agent(request):
                yield event

        return _events()


class Runtime:
    """Services bound to one FastAPI process."""

    def __init__(
        self,
        settings: Settings,
        *,
        database_url: str,
        bus: EventBus,
        pool: KeyPool,
        orchestrator: InvestigationOrchestrator,
        client: TinyFishClient | None,
    ) -> None:
        self.settings = settings
        self.engine = build_engine(database_url)
        self.sessions = session_factory(self.engine)
        self.bus = bus
        self.pool = pool
        self.orchestrator = orchestrator
        self.client = client
        self.heartbeat_seconds = 15.0
        self.schema_ready = False
        self._schema_lock = asyncio.Lock()

    async def ensure_schema(self) -> None:
        """Create tables once per process."""
        if self.schema_ready:
            return
        async with self._schema_lock:
            if self.schema_ready:
                return
            await init_schema(self.engine)
            self.schema_ready = True

    async def run_case(
        self,
        case_id: str,
        max_parallel: int,
        focus: str | None,
        use_profiles: bool,
    ) -> None:
        """Run the orchestrator and persist the graph, evidence, and ledger."""
        await self.ensure_schema()
        try:
            async with self.sessions() as session:
                store = Repositories(session)
                case = await store.cases.get(case_id)
                if case is None:
                    return
                rows = await store.targets.list_for_case(case_id)
                targets = tuple(
                    InvestigationTarget(target_id=row.target_id, url=row.url, host=row.host)
                    for row in rows
                )
            if not targets:
                await self._mark(case_id, "cancelled")
                return
            result = await self.orchestrator.run(
                case_id,
                targets,
                max_parallel=max_parallel,
                focus=focus,
                use_profiles=use_profiles,
            )
            entries = await self.bus.entries(case_id)
            verified = await self.bus.verify(case_id)
            if not verified.ok or not verified.signature_ok:
                raise EvidenceIntegrityError("ledger head does not verify")
            signature = sign_head(
                self.settings.evidence_signing_secret.get_secret_value(),
                verified.head_hash,
                len(entries),
            )
            async with self.sessions() as session:
                store = Repositories(session)
                await store.ledger.replace(case_id, entries, signature, verified.head_hash)
                await store.graphs.replace(case_id, result.graph)
                await store.indicators.replace_from_graph(case_id, result.graph)
                await store.evidence.replace_from_entries(case_id, entries)
                await store.targets.save_reports(case_id, entries)
                if not await store.cases.set_status(case_id, "completed"):
                    return
                await session.commit()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.info(
                "investigation_failed",
                case_id=case_id,
                error_type=exc.__class__.__name__,
            )
            await self._mark(case_id, "cancelled")

    async def aclose(self) -> None:
        """Close the HTTP client, the bus ledger, and the engine."""
        if self.client is not None:
            await self.client.aclose()
        await self.bus.aclose()
        await self.engine.dispose()

    async def _mark(self, case_id: str, status: str) -> None:
        async with self.sessions() as session:
            updated = await Repositories(session).cases.set_status(case_id, status)
            if updated:
                await session.commit()


def build_runtime(
    settings: Settings,
    *,
    database_url: str | None = None,
    navigator: TinyFishNavigator | None = None,
    enrich_target: TargetEnricher | None = None,
) -> Runtime:
    """Wire the bus, key pool, and orchestrator for ``settings``."""
    url = database_url if database_url is not None else settings.database_url.get_secret_value()
    secret: SecretStr = settings.evidence_signing_secret
    bus = EventBus(secret=secret)
    # VERIFY: one orchestrator lease plus one TinyFishClient lease, five ways.
    pool = KeyPool(settings.tinyfish_api_keys, concurrency_per_key=10)
    client: TinyFishClient | None = None
    selected = navigator
    if selected is None:
        client = TinyFishClient(
            pool,
            agent_base_url=str(settings.tinyfish_agent_base_url),
            total_timeout_seconds=float(settings.max_seconds_per_run),
        )
        selected = PoolNavigator(client)
    if enrich_target is None:
        orchestrator = InvestigationOrchestrator(bus, pool, selected)
    else:
        orchestrator = InvestigationOrchestrator(
            bus,
            pool,
            selected,
            enrich_target=enrich_target,
        )
    return Runtime(
        settings,
        database_url=url,
        bus=bus,
        pool=pool,
        orchestrator=orchestrator,
        client=client,
    )
