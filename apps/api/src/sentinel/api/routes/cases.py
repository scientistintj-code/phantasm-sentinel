"""Case, target, event stream, graph, and ledger routes."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Annotated
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Body, Header, Query, Response
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from sentinel.api.deps import RuntimeDep, SessionDep, SettingsDep
from sentinel.api.errors import (
    BadRequestError,
    ConflictError,
    NotFoundError,
    NotImplementedRouteError,
)
from sentinel.api.schemas import (
    CaseCreated,
    CaseDetail,
    CaseStatus,
    CreateCaseRequest,
    GraphResponse,
    InvestigateRequest,
    LedgerEntryOut,
    LedgerPage,
    TargetDecision,
    TargetRequest,
    TargetView,
)
from sentinel.core.errors import EvidenceIntegrityError, InvalidTargetError
from sentinel.core.security import validate_target_url
from sentinel.db.models import CaseRow
from sentinel.db.repositories import NewTarget, Repositories
from sentinel.orchestrator.bus import LedgerVerification, TargetReport, genesis_hash, sign_head

router = APIRouter(prefix="/v1", tags=["cases"])


@router.post("/cases", response_model=CaseCreated, status_code=201)
async def create_case(payload: CreateCaseRequest, session: SessionDep) -> CaseCreated:
    """Create a case. ``authorization_ack`` is required to be true."""
    row = await Repositories(session).cases.create(
        title=payload.title,
        authorized_by=payload.authorized_by,
    )
    await session.commit()
    return _created(row)


@router.get("/cases", response_model=list[CaseCreated])
async def list_cases(session: SessionDep) -> list[CaseCreated]:
    """Return every case, newest first."""
    rows = await Repositories(session).cases.list_newest()
    return [_created(row) for row in rows]


@router.post(
    "/cases/{case_id}/targets",
    response_model=list[TargetDecision],
    response_model_exclude_none=True,
)
async def add_targets(
    case_id: str,
    payload: TargetRequest,
    session: SessionDep,
) -> list[TargetDecision]:
    """Validate up to ten URLs. A rejected URL is reported and not stored."""
    store = Repositories(session)
    case = await _require_case(store, case_id)
    if case.status != "created":
        raise ConflictError("Targets can only be added before investigation starts")
    decisions = [await _decide(url) for url in payload.urls]
    accepted = tuple(
        NewTarget(target_id=f"tgt_{uuid4().hex[:12]}", url=item.url, host=item.host)
        for item in decisions
        if item.accepted
    )
    if accepted:
        await store.targets.add(case_id, accepted)
        await session.commit()
    return decisions


@router.post("/cases/{case_id}/investigate", status_code=202)
async def investigate(
    case_id: str,
    session: SessionDep,
    runtime: RuntimeDep,
    background: BackgroundTasks,
    payload: Annotated[InvestigateRequest | None, Body()] = None,
) -> Response:
    """Start an investigation. Progress is observed on the event stream."""
    store = Repositories(session)
    case = await _require_case(store, case_id)
    if case.status == "running":
        raise ConflictError("Investigation is already running")
    targets = await store.targets.list_for_case(case_id)
    if not targets:
        raise BadRequestError("Case has no accepted targets")
    request = payload if payload is not None else InvestigateRequest()
    if not await store.cases.set_status(case_id, "running"):
        raise NotFoundError("Case not found")
    await session.commit()
    await session.close()
    background.add_task(
        runtime.run_case,
        case_id,
        request.max_parallel,
        request.focus,
        request.use_profiles,
    )
    return Response(status_code=202)


@router.post("/cases/{case_id}/cancel", response_model=CaseCreated)
async def cancel_case(case_id: str, session: SessionDep, runtime: RuntimeDep) -> CaseCreated:
    """Stop the case and return its stored summary."""
    store = Repositories(session)
    case = await _require_case(store, case_id)
    await runtime.orchestrator.cancel_case(case_id)
    if not await store.cases.set_status(case_id, "cancelled"):
        raise NotFoundError("Case not found")
    await session.commit()
    return _created(case)


@router.post("/cases/{case_id}/pivots/{pivot_id}/approve")
async def approve_pivot(case_id: str, pivot_id: str, session: SessionDep) -> None:
    """Pivot approval is not available. A missing case is still not found."""
    await _require_case(Repositories(session), case_id)
    raise NotImplementedRouteError(f"Pivot approval is not implemented for {pivot_id}")


@router.get("/cases/{case_id}/events", operation_id="case_events")
@router.get("/cases/{case_id}/stream", operation_id="case_stream")
async def stream_case(
    case_id: str,
    session: SessionDep,
    runtime: RuntimeDep,
    last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
) -> StreamingResponse:
    """Replay ledger events, then stream live ones. Heartbeats are comments.

    ``/events`` is the contract path. ``/stream`` calls this same handler.
    """
    await _require_case(Repositories(session), case_id)
    after = _sequence(last_event_id, name="Last-Event-ID")
    await session.rollback()
    await session.close()

    async def events() -> AsyncIterator[str]:
        async with runtime.bus.subscribe(case_id, after_seq=after) as subscription:
            while True:
                try:
                    event = await asyncio.wait_for(
                        subscription.queue.get(),
                        timeout=runtime.heartbeat_seconds,
                    )
                except TimeoutError:
                    yield ": heartbeat\n\n"
                    continue
                if event is None:
                    break
                yield f"id: {event.seq}\ndata: {event.model_dump_json()}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/cases/{case_id}", response_model=CaseDetail, response_model_exclude_none=True)
async def get_case(case_id: str, session: SessionDep) -> CaseDetail:
    """Return the case summary and each stored target report."""
    case = await _require_case(Repositories(session), case_id)
    return _detail(case)


@router.get(
    "/cases/{case_id}/targets/{target_id}/report",
    response_model=TargetReport,
    response_model_exclude_none=True,
)
async def get_target_report(
    case_id: str,
    target_id: str,
    session: SessionDep,
) -> TargetReport:
    """Return the ``PayloadValidated`` report stored for this target."""
    store = Repositories(session)
    await _require_case(store, case_id)
    target = await store.targets.get(case_id, target_id)
    if target is None:
        raise NotFoundError("Target not found")
    stored = await store.ledger.latest_payload_report(case_id, target_id)
    if stored is None:
        raise NotFoundError("Target report is not available")
    try:
        return TargetReport.model_validate(stored)
    except ValidationError as exc:
        raise NotFoundError("Target report is not available") from exc


@router.get(
    "/cases/{case_id}/graph",
    response_model=GraphResponse,
    response_model_exclude_none=True,
)
async def get_graph(case_id: str, session: SessionDep) -> GraphResponse:
    """Return the stored graph, or an empty graph before the first run."""
    store = Repositories(session)
    await _require_case(store, case_id)
    row = await store.graphs.get(case_id)
    if row is None:
        return GraphResponse(
            version=0,
            nodes=[],
            edges=[],
            clusters=[],
            insight="No shared infrastructure",
        )
    return GraphResponse.model_validate(
        {
            "version": row.version,
            "nodes": row.nodes,
            "edges": row.edges,
            "clusters": row.clusters,
            "insight": row.insight,
        }
    )


@router.get("/cases/{case_id}/ledger", response_model=LedgerPage)
async def get_ledger(
    case_id: str,
    session: SessionDep,
    settings: SettingsDep,
    cursor: Annotated[str | None, Query()] = None,
) -> LedgerPage:
    """Return ledger entries after ``cursor`` and the signed head of the full chain."""
    store = Repositories(session)
    await _require_case(store, case_id)
    after = _sequence(cursor, name="cursor")
    entries, next_cursor = await store.ledger.page(case_id, after)
    stored = await store.ledger.head(case_id)
    secret = settings.evidence_signing_secret.get_secret_value()
    if stored is None:
        head_hash = genesis_hash(case_id)
        signature = sign_head(secret, head_hash, 0)
    else:
        head_hash = stored.head_hash
        signature = stored.signature
    return LedgerPage(
        entries=[
            LedgerEntryOut(
                seq=entry.seq,
                ts=entry.ts,
                event_type=entry.event_type,
                payload=entry.payload,
                prev_hash=entry.prev_hash,
                entry_hash=entry.entry_hash,
            )
            for entry in entries
        ],
        next_cursor=next_cursor,
        head_hash=head_hash,
        signature=signature,
    )


@router.post(
    "/cases/{case_id}/ledger/verify",
    response_model=LedgerVerification,
    response_model_exclude_none=True,
)
async def verify_ledger(
    case_id: str,
    session: SessionDep,
    settings: SettingsDep,
) -> LedgerVerification:
    """Re-check the stored hash chain and the signed head."""
    store = Repositories(session)
    await _require_case(store, case_id)
    return await store.ledger.verify(case_id, settings.evidence_signing_secret)


async def _require_case(store: Repositories, case_id: str) -> CaseRow:
    case = await store.cases.get(case_id)
    if case is None:
        raise NotFoundError("Case not found")
    return case


async def _decide(url: str) -> TargetDecision:
    try:
        normalized = await asyncio.to_thread(validate_target_url, url)
    except InvalidTargetError as exc:
        return TargetDecision(url=url, host=_host(url), accepted=False, reason=exc.reason)
    return TargetDecision(url=normalized, host=_host(normalized), accepted=True)


def _host(url: str) -> str:
    try:
        hostname = urlsplit(url).hostname
    except ValueError:
        return ""
    if hostname is None:
        return ""
    return hostname.lower()


def _sequence(value: str | None, *, name: str) -> int:
    if value is None or value == "":
        return 0
    if not value.isdecimal():
        raise BadRequestError(f"{name} must be a decimal sequence")
    return int(value)


def _created(row: CaseRow) -> CaseCreated:
    return CaseCreated(
        id=row.id,
        number=row.number,
        title=row.title,
        status=_status(row.status),
        created_at=row.created_at,
    )


def _detail(row: CaseRow) -> CaseDetail:
    targets: list[TargetView] = []
    for target in row.targets:
        report = None if target.report is None else TargetReport.model_validate(target.report)
        targets.append(
            TargetView(
                target_id=target.target_id,
                url=target.url,
                host=target.host,
                accepted=target.accepted,
                reason=target.reason,
                report=report,
            )
        )
    return CaseDetail(
        id=row.id,
        number=row.number,
        title=row.title,
        status=_status(row.status),
        created_at=row.created_at,
        targets=targets,
    )


def _status(value: str) -> CaseStatus:
    if value == "created":
        return "created"
    if value == "running":
        return "running"
    if value == "completed":
        return "completed"
    if value == "cancelled":
        return "cancelled"
    raise EvidenceIntegrityError("case status is invalid")
