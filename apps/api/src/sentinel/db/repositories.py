"""Repositories for cases, targets, indicators, evidence, graphs, and the ledger."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from pydantic import SecretStr
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from sentinel.core.errors import EvidenceIntegrityError
from sentinel.db.clock import utc_timestamp
from sentinel.db.models import (
    CaseRow,
    EvidenceRow,
    GraphRow,
    IndicatorRow,
    LedgerEntryRow,
    LedgerHeadRow,
    TargetRow,
)
from sentinel.orchestrator.bus import (
    EventBus,
    LedgerEntry,
    LedgerVerification,
    MemoryLedger,
    TargetReport,
)
from sentinel.orchestrator.engine import GraphSnapshot

_PAGE_SIZE = 100
_INFRA_KINDS = frozenset({"ip", "ns", "cert_fingerprint", "registrar", "domain"})


@dataclass(frozen=True)
class NewTarget:
    """An accepted target ready to insert."""

    target_id: str
    url: str
    host: str


@dataclass(frozen=True)
class StoredHead:
    """HMAC head persisted beside ledger entries."""

    signature: str
    head_hash: str
    entry_count: int


class CaseRepository:
    """Load and store cases."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(self, *, title: str, authorized_by: str) -> CaseRow:
        """Insert a case and assign the next ``PS-YYYY-NNNN`` number."""
        now = datetime.now(UTC)
        current = await self._session.scalar(
            select(func.max(CaseRow.sequence)).where(CaseRow.year == now.year)
        )
        sequence = 1 if current is None else int(current) + 1
        row = CaseRow(
            id=str(uuid4()),
            number=f"PS-{now.year}-{sequence:04d}",
            title=title,
            status="created",
            authorized_by=authorized_by,
            created_at=utc_timestamp(now),
            year=now.year,
            sequence=sequence,
        )
        self._session.add(row)
        await self._session.flush()
        return row

    async def get(self, case_id: str) -> CaseRow | None:
        """Return a case and its targets, or ``None`` when the id is unknown."""
        result = await self._session.execute(select(CaseRow).where(CaseRow.id == case_id))
        return result.scalar_one_or_none()

    async def list_newest(self) -> list[CaseRow]:
        """Return every case, newest ``created_at`` first."""
        result = await self._session.execute(
            select(CaseRow).order_by(CaseRow.created_at.desc(), CaseRow.sequence.desc())
        )
        return list(result.scalars().all())

    async def set_status(self, case_id: str, status: str) -> bool:
        """Update status. Return whether the case existed."""
        row = await self._session.get(CaseRow, case_id)
        if row is None:
            return False
        row.status = status
        return True


class TargetRepository:
    """Load and store accepted targets and their reports."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, case_id: str, targets: tuple[NewTarget, ...]) -> list[TargetRow]:
        """Append accepted targets in request order."""
        current = await self._session.scalar(
            select(func.max(TargetRow.position)).where(TargetRow.case_id == case_id)
        )
        start = 0 if current is None else int(current) + 1
        stored: list[TargetRow] = []
        for offset, target in enumerate(targets):
            row = TargetRow(
                case_id=case_id,
                target_id=target.target_id,
                url=target.url,
                host=target.host,
                accepted=True,
                reason=None,
                position=start + offset,
                report=None,
            )
            self._session.add(row)
            stored.append(row)
        await self._session.flush()
        return stored

    async def get(self, case_id: str, target_id: str) -> TargetRow | None:
        """Return the target when it belongs to ``case_id``."""
        result = await self._session.execute(
            select(TargetRow).where(
                TargetRow.case_id == case_id,
                TargetRow.target_id == target_id,
            )
        )
        return result.scalar_one_or_none()

    async def list_for_case(self, case_id: str) -> list[TargetRow]:
        """Return targets in insertion order."""
        result = await self._session.execute(
            select(TargetRow).where(TargetRow.case_id == case_id).order_by(TargetRow.position)
        )
        return list(result.scalars().all())

    async def save_reports(self, case_id: str, entries: list[LedgerEntry]) -> None:
        """Copy ``TargetCompleted`` reports onto the matching target rows."""
        for entry in entries:
            if entry.event_type != "TargetCompleted":
                continue
            report = entry.payload.get("report")
            target_id = entry.payload.get("target_id")
            if not isinstance(report, dict) or not isinstance(target_id, str):
                continue
            validated = TargetReport.model_validate(report)
            result = await self._session.execute(
                select(TargetRow).where(
                    TargetRow.case_id == case_id,
                    TargetRow.target_id == target_id,
                )
            )
            row = result.scalar_one_or_none()
            if row is None:
                continue
            row.report = validated.model_dump(mode="json")


class IndicatorRepository:
    """Replace the indicator rows that a graph snapshot implies."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def replace_from_graph(self, case_id: str, graph: GraphSnapshot) -> None:
        """Store one row per graph edge. ``weight`` is the confidence."""
        await self._session.execute(delete(IndicatorRow).where(IndicatorRow.case_id == case_id))
        nodes = {node.id: node for node in graph.nodes}
        for edge in graph.edges:
            origin = nodes.get(edge.a)
            destination = nodes.get(edge.b)
            if origin is None or destination is None or origin.target_id is None:
                continue
            self._session.add(
                IndicatorRow(
                    case_id=case_id,
                    target_id=origin.target_id,
                    kind=edge.kind,
                    value=destination.label,
                    confidence=edge.weight,
                    source=_indicator_source(edge.kind),
                )
            )


class EvidenceRepository:
    """Replace evidence rows from completed target reports."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def replace_from_entries(self, case_id: str, entries: list[LedgerEntry]) -> None:
        """Store the eight evidence cells carried on each ``TargetCompleted`` event."""
        await self._session.execute(delete(EvidenceRow).where(EvidenceRow.case_id == case_id))
        for entry in entries:
            if entry.event_type != "TargetCompleted":
                continue
            report = entry.payload.get("report")
            target_id = entry.payload.get("target_id")
            if not isinstance(report, dict) or not isinstance(target_id, str):
                continue
            evidence = report.get("evidence")
            if not isinstance(evidence, list):
                continue
            for position, item in enumerate(evidence):
                if not isinstance(item, dict):
                    continue
                self._session.add(
                    EvidenceRow(
                        case_id=case_id,
                        target_id=target_id,
                        position=position,
                        field=_text(item.get("field")),
                        label=_text(item.get("label")),
                        value=_text(item.get("value")),
                        severity=_choice(
                            item.get("severity"),
                            frozenset({"safe", "medium", "high"}),
                            "safe",
                        ),
                        source=_choice(
                            item.get("source"),
                            frozenset({"agent", "infra", "derived"}),
                            "derived",
                        ),
                    )
                )


class GraphRepository:
    """Store the latest graph for a case."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, case_id: str) -> GraphRow | None:
        """Return the stored graph, or ``None`` before the first run."""
        return await self._session.get(GraphRow, case_id)

    async def replace(self, case_id: str, graph: GraphSnapshot) -> None:
        """Insert or overwrite the snapshot produced by an investigation."""
        dumped: dict[str, Any] = graph.model_dump(mode="json")
        row = await self._session.get(GraphRow, case_id)
        nodes = _object_list(dumped.get("nodes"))
        edges = _object_list(dumped.get("edges"))
        clusters = _object_list(dumped.get("clusters"))
        if row is None:
            self._session.add(
                GraphRow(
                    case_id=case_id,
                    version=graph.version,
                    nodes=nodes,
                    edges=edges,
                    clusters=clusters,
                    insight=graph.insight,
                )
            )
            return
        row.version = graph.version
        row.nodes = nodes
        row.edges = edges
        row.clusters = clusters
        row.insight = graph.insight


class LedgerRepository:
    """Persist ledger rows and re-check the hash chain from storage."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def replace(
        self,
        case_id: str,
        entries: list[LedgerEntry],
        signature: str,
        head_hash: str,
    ) -> None:
        """Replace the stored chain and its signed head."""
        await self._session.execute(delete(LedgerEntryRow).where(LedgerEntryRow.case_id == case_id))
        await self._session.execute(delete(LedgerHeadRow).where(LedgerHeadRow.case_id == case_id))
        for entry in entries:
            self._session.add(
                LedgerEntryRow(
                    case_id=case_id,
                    seq=entry.seq,
                    ts=entry.ts,
                    event_type=entry.event_type,
                    payload=dict(entry.payload),
                    prev_hash=entry.prev_hash,
                    entry_hash=entry.entry_hash,
                )
            )
        self._session.add(
            LedgerHeadRow(
                case_id=case_id,
                signature=signature,
                head_hash=head_hash,
                entry_count=len(entries),
            )
        )

    async def head(self, case_id: str) -> StoredHead | None:
        """Return the signed head, or ``None`` when the case has no entries."""
        row = await self._session.get(LedgerHeadRow, case_id)
        if row is None:
            return None
        return StoredHead(
            signature=row.signature,
            head_hash=row.head_hash,
            entry_count=row.entry_count,
        )

    async def latest_payload_report(
        self,
        case_id: str,
        target_id: str,
    ) -> dict[str, Any] | None:
        """Return the newest ``PayloadValidated`` report stored for ``target_id``."""
        result = await self._session.execute(
            select(LedgerEntryRow)
            .where(
                LedgerEntryRow.case_id == case_id,
                LedgerEntryRow.event_type == "PayloadValidated",
            )
            .order_by(LedgerEntryRow.seq.desc())
        )
        for row in result.scalars():
            payload = row.payload
            if not isinstance(payload, dict) or payload.get("target_id") != target_id:
                continue
            report = payload.get("report")
            if isinstance(report, dict):
                return {str(key): value for key, value in report.items()}
        return None

    async def page(self, case_id: str, after_seq: int) -> tuple[list[LedgerEntry], str | None]:
        """Return at most one page of entries with ``seq`` greater than ``after_seq``."""
        result = await self._session.execute(
            select(LedgerEntryRow)
            .where(LedgerEntryRow.case_id == case_id, LedgerEntryRow.seq > after_seq)
            .order_by(LedgerEntryRow.seq)
            .limit(_PAGE_SIZE + 1)
        )
        rows = [_as_entry(row) for row in result.scalars().all()]
        if len(rows) <= _PAGE_SIZE:
            return rows, None
        page = rows[:_PAGE_SIZE]
        return page, str(page[-1].seq)

    async def verify(self, case_id: str, secret: SecretStr) -> LedgerVerification:
        """Re-check the stored hash chain and the signed head."""
        result = await self._session.execute(
            select(LedgerEntryRow)
            .where(LedgerEntryRow.case_id == case_id)
            .order_by(LedgerEntryRow.seq)
        )
        entries = [_as_entry(row) for row in result.scalars().all()]
        stored = await self.head(case_id)
        memory = MemoryLedger()
        if stored is not None:
            for entry in entries:
                memory.append(
                    case_id,
                    entry,
                    stored.signature,
                    stored.head_hash,
                    stored.entry_count,
                )
        bus = EventBus(secret=secret, ledger=memory)
        try:
            return await bus.verify(case_id)
        finally:
            await bus.aclose()


class Repositories:
    """Repositories that share one async session."""

    def __init__(self, session: AsyncSession) -> None:
        self.cases = CaseRepository(session)
        self.targets = TargetRepository(session)
        self.indicators = IndicatorRepository(session)
        self.evidence = EvidenceRepository(session)
        self.graphs = GraphRepository(session)
        self.ledger = LedgerRepository(session)


def _indicator_source(kind: str) -> str:
    if kind in _INFRA_KINDS:
        return "infra"
    return "agent"


def _text(value: object) -> str:
    if isinstance(value, str):
        return value
    return ""


def _choice(value: object, allowed: frozenset[str], default: str) -> str:
    if isinstance(value, str) and value in allowed:
        return value
    return default


def _object_list(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    rows: list[dict[str, Any]] = []
    for item in value:
        if isinstance(item, dict):
            rows.append({str(key): entry for key, entry in item.items()})
    return rows


def _as_entry(row: LedgerEntryRow) -> LedgerEntry:
    payload = row.payload
    if not isinstance(payload, dict):
        raise EvidenceIntegrityError("ledger payload must be an object")
    return LedgerEntry(
        seq=row.seq,
        ts=row.ts,
        event_type=row.event_type,
        payload={str(key): value for key, value in payload.items()},
        prev_hash=row.prev_hash,
        entry_hash=row.entry_hash,
    )
