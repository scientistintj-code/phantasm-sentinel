"""Multi-target investigation runs.

Each target takes one semaphore slot, then passive enrichment, then one TinyFish
Agent stream. The navigator receives the leased key. ``TinyFishClient.stream_agent``
acquires a lease of its own, so a navigator must send ``lease.api_key`` itself
and must not call ``stream_agent`` on the same pool while this lease is held.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable, Sequence
from datetime import UTC, datetime
from typing import Literal, Protocol

import structlog
from pydantic import BaseModel, ConfigDict, Field

from sentinel.core.errors import KeyPoolExhaustedError, SentinelError, TinyFishError
from sentinel.orchestrator.bus import (
    EVIDENCE_FIELDS,
    CaseCompleted,
    CaseStarted,
    EventBus,
    GraphUpdated,
    StepUpdated,
    TargetCompleted,
    TargetFailed,
    TargetReport,
    TargetStarted,
)
from sentinel.orchestrator.bus import (
    Risk as ReportRisk,
)
from sentinel.pipeline.enrichment import InfraProfile, enrich
from sentinel.pipeline.goals import active_stage_prompt
from sentinel.pipeline.schemas import (
    ActiveNavigationResult,
    EvidenceItem,
    EvidenceSeverity,
    parse_active_navigation,
)
from sentinel.tinyfish import (
    AgentEvent,
    AgentRunRequest,
    CompleteEvent,
    HeartbeatEvent,
    KeyLease,
    KeyOutcome,
    KeyPool,
    ProgressEvent,
    StartedEvent,
    StreamingUrlEvent,
)
from sentinel.tinyfish.models import ErrorCategory, RunStatus

log = structlog.get_logger(__name__)

_FROZEN = ConfigDict(frozen=True, extra="forbid")
_POINTS = {"safe": 0, "medium": 12, "high": 25}
NodeType = Literal["domain", "gateway", "merchant", "host", "bank", "contact"]
_NODE_TYPES: dict[str, NodeType] = {
    "publishable_key": "merchant",
    "merchant_id": "merchant",
    "client_id": "merchant",
    "processor_host": "gateway",
    "form_action_host": "gateway",
    "checkout_script_host": "gateway",
    "ip": "host",
    "descriptor": "bank",
    "telegram": "contact",
    "email": "contact",
    "phone": "contact",
}


class KeyRotationRequired(Exception):
    """The leased key should be marked and the run tried with another key."""

    def __init__(
        self,
        outcome: KeyOutcome,
        message: str,
        *,
        retry_after_seconds: float | None = None,
    ) -> None:
        self.outcome = outcome
        self.retry_after_seconds = retry_after_seconds
        super().__init__(message)


class TinyFishNavigator(Protocol):
    """One Agent SSE run that uses the key on ``lease``."""

    def stream(
        self,
        request: AgentRunRequest,
        lease: KeyLease,
    ) -> AsyncIterator[AgentEvent]:
        """Yield documented Agent events. Raise ``KeyRotationRequired`` to rotate."""


class TargetEnricher(Protocol):
    """Passive enrichment for one validated URL."""

    async def __call__(self, url: str) -> InfraProfile:
        """Return infrastructure facts. Raise ``InvalidTargetError`` for a rejected URL."""


class InvestigationTarget(BaseModel):
    """One accepted target. ``host`` is the normalized hostname."""

    model_config = _FROZEN

    target_id: str = Field(min_length=1)
    url: str = Field(min_length=1)
    host: str = Field(min_length=1)


class GraphNode(BaseModel):
    """One graph node. ``target_id`` is set on domain nodes."""

    model_config = _FROZEN

    id: str
    type: NodeType
    label: str
    target_id: str | None = None


class GraphEdge(BaseModel):
    """Link from a domain node to an indicator node."""

    model_config = _FROZEN

    a: str
    b: str
    weight: float = Field(ge=0, le=1)
    kind: str


class GraphCluster(BaseModel):
    """Targets that share an indicator node."""

    model_config = _FROZEN

    id: str
    members: list[str]
    confidence: float = Field(ge=0, le=1)
    explanation: str


class GraphSnapshot(BaseModel):
    """Case graph after one investigation run."""

    model_config = _FROZEN

    version: int = Field(ge=1)
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    clusters: list[GraphCluster]
    insight: str


class InvestigationResult(BaseModel):
    """Counts and graph produced by ``InvestigationOrchestrator.run``."""

    model_config = _FROZEN

    graph: GraphSnapshot
    completed: tuple[str, ...]
    failed: tuple[str, ...]


class _Check:
    def __init__(self, field: str, passed: bool, reason: str | None) -> None:
        self.field = field
        self.passed = passed
        self.reason = reason


class _GraphDraft:
    def __init__(self) -> None:
        self.nodes: dict[str, GraphNode] = {}
        self.edges: list[GraphEdge] = []
        self._edge_keys: set[tuple[str, str, str]] = set()
        self._shared: dict[str, set[str]] = {}

    def add_domain(self, target_id: str, host: str) -> str:
        node_id = f"domain:{host}"
        self.nodes.setdefault(
            node_id,
            GraphNode(id=node_id, type="domain", label=host, target_id=target_id),
        )
        return node_id

    def add_link(
        self,
        target_id: str,
        host: str,
        kind: str,
        value: str,
        confidence: float,
    ) -> None:
        node_type = _NODE_TYPES.get(kind)
        if node_type is None or value == "":
            return
        domain_id = self.add_domain(target_id, host)
        node_id = f"{node_type}:{value}"
        self.nodes.setdefault(node_id, GraphNode(id=node_id, type=node_type, label=value))
        key = (domain_id, node_id, kind)
        if key in self._edge_keys:
            return
        self._edge_keys.add(key)
        weight = min(1.0, max(0.0, confidence))
        self.edges.append(GraphEdge(a=domain_id, b=node_id, weight=weight, kind=kind))
        self._shared.setdefault(node_id, set()).add(target_id)

    def finish(self) -> GraphSnapshot:
        clusters = _clusters(self._shared)
        if clusters:
            insight = f"{len(clusters)} shared-infrastructure cluster(s)"
        else:
            insight = "No shared infrastructure"
        nodes = [self.nodes[key] for key in sorted(self.nodes)]
        return GraphSnapshot(
            version=1,
            nodes=nodes,
            edges=list(self.edges),
            clusters=clusters,
            insight=insight,
        )


class InvestigationOrchestrator:
    """Runs passive enrichment and TinyFish navigation for many targets."""

    def __init__(
        self,
        bus: EventBus,
        pool: KeyPool,
        client: TinyFishNavigator,
        *,
        enrich_target: TargetEnricher | None = None,
        key_acquire_timeout: float = 1.0,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        if key_acquire_timeout < 0:
            raise ValueError("key_acquire_timeout must be >= 0")
        self._bus = bus
        self._pool = pool
        self._client = client
        self._enrich = _enrich_url if enrich_target is None else enrich_target
        self._key_acquire_timeout = key_acquire_timeout
        self._now: Callable[[], datetime] = _utc_now if now is None else now

    async def run(
        self,
        case_id: str,
        targets: Sequence[InvestigationTarget],
        *,
        max_parallel: int = 1,
        focus: str | None = None,
        use_profiles: bool = False,
    ) -> InvestigationResult:
        """Investigate every target and publish the case lifecycle events.

        ``max_parallel`` is an integer from 1 to 5. ``focus`` is the investigate
        hint and is at most 300 characters. The active-stage goal always includes
        the stop-before-payment safety clause.
        """
        if not 1 <= max_parallel <= 5:
            raise ValueError("max_parallel must be from 1 to 5")
        active_stage_prompt(focus)
        semaphore = asyncio.Semaphore(max_parallel)
        graph_lock = asyncio.Lock()
        draft = _GraphDraft()
        log.info(
            "case_started",
            case_id=case_id,
            target_count=len(targets),
            max_parallel=max_parallel,
        )
        await self._bus.publish(
            CaseStarted(
                case_id=case_id,
                target_count=len(targets),
                max_parallel=max_parallel,
            )
        )
        flags = await asyncio.gather(
            *(
                self._worker(
                    case_id=case_id,
                    target=target,
                    semaphore=semaphore,
                    graph_lock=graph_lock,
                    draft=draft,
                    focus=focus,
                    use_profiles=use_profiles,
                )
                for target in targets
            )
        )
        completed = tuple(target.target_id for target, ok in zip(targets, flags, strict=True) if ok)
        failed = tuple(
            target.target_id for target, ok in zip(targets, flags, strict=True) if not ok
        )
        graph = draft.finish()
        await self._bus.publish(GraphUpdated(case_id=case_id, version=graph.version))
        await self._bus.publish(
            CaseCompleted(
                case_id=case_id,
                targets=len(completed),
                failed=len(failed),
                clusters=len(graph.clusters),
            )
        )
        log.info(
            "case_completed",
            case_id=case_id,
            targets=len(completed),
            failed=len(failed),
            clusters=len(graph.clusters),
        )
        return InvestigationResult(graph=graph, completed=completed, failed=failed)

    async def _worker(
        self,
        *,
        case_id: str,
        target: InvestigationTarget,
        semaphore: asyncio.Semaphore,
        graph_lock: asyncio.Lock,
        draft: _GraphDraft,
        focus: str | None,
        use_profiles: bool,
    ) -> bool:
        async with semaphore:
            await self._bus.publish(
                TargetStarted(
                    case_id=case_id,
                    target_id=target.target_id,
                    url=target.url,
                    host=target.host,
                )
            )
            try:
                profile = await self._enrich(target.url)
                report, parsed = await self._navigate(
                    case_id=case_id,
                    target=target,
                    profile=profile,
                    focus=focus,
                    use_profiles=use_profiles,
                )
            except SentinelError as exc:
                log.info(
                    "target_failed",
                    case_id=case_id,
                    target_id=target.target_id,
                    error_code=exc.code,
                )
                await self._bus.publish(
                    TargetFailed(
                        case_id=case_id,
                        target_id=target.target_id,
                        error_code=exc.code,
                        message=exc.message,
                    )
                )
                return False
            async with graph_lock:
                _contribute(draft, target, profile, parsed)
            await self._bus.publish(
                TargetCompleted(
                    case_id=case_id,
                    target_id=target.target_id,
                    report=report,
                )
            )
            return True

    async def _navigate(
        self,
        *,
        case_id: str,
        target: InvestigationTarget,
        profile: InfraProfile,
        focus: str | None,
        use_profiles: bool,
    ) -> tuple[TargetReport, ActiveNavigationResult]:
        request = _run_request(target, focus, use_profiles)
        slots = await self._pool.snapshot()
        last_error: SentinelError | None = None
        for _attempt in range(max(1, len(slots))):
            try:
                lease = await self._pool.acquire(timeout=self._key_acquire_timeout)
            except KeyPoolExhaustedError as exc:
                last_error = exc
                break
            try:
                return await self._drive(case_id, target, profile, request, lease)
            except KeyRotationRequired as rotation:
                await _apply_rotation(lease, rotation)
                log.info(
                    "key_rotation",
                    case_id=case_id,
                    target_id=target.target_id,
                    key_label=lease.label,
                    outcome=rotation.outcome.value,
                )
                last_error = TinyFishError(str(rotation))
            finally:
                await lease.release()
        if last_error is None:
            raise TinyFishError("TinyFish navigation failed")
        raise last_error

    async def _drive(
        self,
        case_id: str,
        target: InvestigationTarget,
        profile: InfraProfile,
        request: AgentRunRequest,
        lease: KeyLease,
    ) -> tuple[TargetReport, ActiveNavigationResult]:
        index = 0
        complete: CompleteEvent | None = None
        async for event in self._client.stream(request, lease):
            if isinstance(event, HeartbeatEvent):
                continue
            if isinstance(event, StartedEvent):
                log.info(
                    "tinyfish_started",
                    case_id=case_id,
                    target_id=target.target_id,
                    run_id=event.run_id,
                    key_label=lease.label,
                )
                continue
            if isinstance(event, StreamingUrlEvent | ProgressEvent):
                index += 1
                purpose = event.purpose if isinstance(event, ProgressEvent) else event.streaming_url
                await self._bus.publish(
                    StepUpdated(
                        case_id=case_id,
                        target_id=target.target_id,
                        index=index,
                        purpose=purpose,
                        run_id=event.run_id,
                    )
                )
                continue
            if isinstance(event, CompleteEvent):
                complete = event
                break
        if complete is None:
            raise TinyFishError("TinyFish stream ended before completion")
        if _is_billing(complete):
            message = "TinyFish billing rejected the run"
            if complete.error is not None and complete.error.message:
                message = complete.error.message
            raise KeyRotationRequired(KeyOutcome.EXHAUSTED, message)
        if complete.status is not RunStatus.COMPLETED:
            message = "TinyFish run failed"
            if complete.error is not None and complete.error.message:
                message = complete.error.message
            raise TinyFishError(message)
        await lease.mark_success()
        parsed = parse_active_navigation(complete.result)
        report, checks = _build_report(target, profile, parsed, self._now())
        failed = sum(1 for check in checks if not check.passed)
        log.info(
            "payload_validated",
            case_id=case_id,
            target_id=target.target_id,
            run_id=complete.run_id,
            passed=len(checks) - failed,
            failed=failed,
            score=report.risk.score,
            label=report.risk.label,
        )
        return report, parsed


def _utc_now() -> datetime:
    return datetime.now(UTC)


async def _enrich_url(url: str) -> InfraProfile:
    return await enrich(url)


def _run_request(
    target: InvestigationTarget,
    focus: str | None,
    use_profiles: bool,
) -> AgentRunRequest:
    # Investigate exposes ``use_profiles``. TinyFish expects ``use_profile``.
    # No profile id is available on the investigate request, so none is sent.
    # Stealth, proxy, and max_steps are not on the investigate request.
    profile = True if use_profiles else None
    return AgentRunRequest(
        url=target.url,
        goal=active_stage_prompt(focus),
        use_profile=profile,
    )


async def _apply_rotation(lease: KeyLease, rotation: KeyRotationRequired) -> None:
    if rotation.outcome is KeyOutcome.RATE_LIMITED:
        retry_after = 0.0 if rotation.retry_after_seconds is None else rotation.retry_after_seconds
        await lease.mark_rate_limited(retry_after)
        return
    if rotation.outcome is KeyOutcome.EXHAUSTED:
        await lease.mark_exhausted()
        return
    if rotation.outcome is KeyOutcome.INVALID:
        await lease.mark_invalid()
        return
    await lease.mark_success()


def _is_billing(event: CompleteEvent) -> bool:
    if event.error is None:
        return False
    if event.error.category is ErrorCategory.BILLING_FAILURE:
        return True
    return event.error.code == "BILLING_REJECTED"


def _contribute(
    draft: _GraphDraft,
    target: InvestigationTarget,
    profile: InfraProfile,
    parsed: ActiveNavigationResult,
) -> None:
    draft.add_domain(target.target_id, target.host)
    for infra in profile.indicators:
        draft.add_link(target.target_id, target.host, infra.kind, infra.value, 0.5)
    for candidate in parsed.indicators:
        draft.add_link(
            target.target_id,
            target.host,
            candidate.kind,
            candidate.value,
            candidate.confidence,
        )


def _clusters(shared: dict[str, set[str]]) -> list[GraphCluster]:
    groups: list[set[str]] = []
    for members in shared.values():
        if len(members) < 2:
            continue
        placed = False
        for group in groups:
            if group.intersection(members):
                group.update(members)
                placed = True
                break
        if not placed:
            groups.append(set(members))
    changed = True
    while changed:
        changed = False
        merged: list[set[str]] = []
        for group in groups:
            for existing in merged:
                if existing.intersection(group):
                    existing.update(group)
                    changed = True
                    break
            else:
                merged.append(set(group))
        groups = merged
    clusters: list[GraphCluster] = []
    ordered = sorted(groups, key=lambda group: min(group))
    for index, group in enumerate(ordered, start=1):
        clusters.append(
            GraphCluster(
                id=f"cluster-{index}",
                members=sorted(group),
                confidence=0.5,
                explanation=("Targets share a merchant, gateway, host, bank, or contact indicator"),
            )
        )
    return clusters


def _build_report(
    target: InvestigationTarget,
    profile: InfraProfile,
    parsed: ActiveNavigationResult,
    now: datetime,
) -> tuple[TargetReport, list[_Check]]:
    supplied: dict[str, EvidenceItem] = {}
    for item in parsed.evidence:
        if item.value != "" and item.field not in supplied:
            supplied[item.field] = item
    derived = _derived_rows(target, profile, parsed, now)
    evidence: list[EvidenceItem] = []
    for field in EVIDENCE_FIELDS:
        evidence.append(supplied.get(field, derived[field]))
    checks = [
        _Check(row.field, row.value != "", None if row.value != "" else "missing")
        for row in evidence
    ]
    passed = sum(1 for check in checks if check.passed)
    score = 0
    for row in evidence:
        if row.value == "":
            continue
        score += _POINTS[row.severity]
    score = min(100, score)
    label, verdict = _risk_label(score)
    report = TargetReport(
        target_id=target.target_id,
        host=target.host,
        risk=ReportRisk(
            score=score,
            label=label,
            evidence_coverage=f"{passed}/8",
            verdict=verdict,
        ),
        evidence=tuple(evidence),
    )
    return report, checks


def _derived_rows(
    target: InvestigationTarget,
    profile: InfraProfile,
    parsed: ActiveNavigationResult,
    now: datetime,
) -> dict[str, EvidenceItem]:
    merchant = ""
    if parsed.merchant_identities.merchant_identifiers:
        merchant = parsed.merchant_identities.merchant_identifiers[0]
    gateway = ""
    if parsed.processing.payment_processors:
        gateway = parsed.processing.payment_processors[0]
    host_ip = ""
    if profile.a:
        host_ip = profile.a[0]
    elif profile.aaaa:
        host_ip = profile.aaaa[0]
    age_value, age_severity = _domain_age(profile.created, now)
    issuer = profile.issuer or ""
    redirect_value, redirect_severity = _redirect_chain(profile.redirect_hosts)
    return {
        "merchant_id": EvidenceItem(
            field="merchant_id",
            value=merchant,
            severity="safe",
            source="agent" if merchant else "derived",
        ),
        "gateway": EvidenceItem(
            field="gateway",
            value=gateway,
            severity="safe",
            source="agent" if gateway else "derived",
        ),
        "payment_endpoint": EvidenceItem(field="payment_endpoint", value="", source="derived"),
        "host_ip": EvidenceItem(
            field="host_ip",
            value=host_ip,
            severity="safe",
            source="infra" if host_ip else "derived",
        ),
        "domain_age": EvidenceItem(
            field="domain_age",
            value=age_value,
            severity=age_severity,
            source="derived",
        ),
        "ssl_issuer": EvidenceItem(
            field="ssl_issuer",
            value=issuer,
            severity="safe",
            source="infra" if issuer else "derived",
        ),
        "suspicious_scripts": EvidenceItem(
            field="suspicious_scripts",
            value="",
            source="derived",
        ),
        "redirect_chain": EvidenceItem(
            field="redirect_chain",
            value=redirect_value,
            severity=redirect_severity,
            source="infra" if redirect_value else "derived",
        ),
    }


def _domain_age(
    created: datetime | None,
    now: datetime,
) -> tuple[str, EvidenceSeverity]:
    if created is None:
        return "", "safe"
    stamp = created if created.tzinfo is not None else created.replace(tzinfo=UTC)
    days = (now - stamp).days
    if days < 0:
        days = 0
    if days < 30:
        return f"{days}d", "high"
    if days < 365:
        return f"{days}d", "medium"
    return f"{days}d", "safe"


def _redirect_chain(
    hosts: tuple[str, ...] | None,
) -> tuple[str, EvidenceSeverity]:
    if not hosts:
        return "", "safe"
    value = " -> ".join(hosts)
    if len(hosts) >= 3:
        return value, "high"
    if len(hosts) == 2:
        return value, "medium"
    return value, "safe"


def _risk_label(score: int) -> tuple[Literal["LOW", "MEDIUM", "HIGH"], str]:
    if score >= 67:
        return "HIGH", "High risk"
    if score >= 34:
        return "MEDIUM", "Medium risk"
    return "LOW", "Low risk"
