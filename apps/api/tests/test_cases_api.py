"""Case API: creation, targets, the event stream, graph, and ledger."""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, update

from sentinel.api.app import create_app
from sentinel.api.runtime import Runtime
from sentinel.core.config import Settings
from sentinel.db.models import EvidenceRow, IndicatorRow, LedgerEntryRow
from sentinel.db.schema import main, run
from sentinel.orchestrator.bus import EVIDENCE_FIELDS, Risk, TargetReport
from sentinel.pipeline.enrichment import Indicator, InfraProfile
from sentinel.pipeline.schemas import EvidenceItem
from sentinel.tinyfish import (
    AgentEvent,
    AgentRunRequest,
    CompleteEvent,
    KeyLease,
    ProgressEvent,
    StartedEvent,
)
from sentinel.tinyfish.models import RunStatus

TOKEN = {"X-Sentinel-Token": "test-token"}
_CASE = {
    "title": "Lab storefronts",
    "authorized_by": "case-owner",
    "authorization_ack": True,
}


@pytest.fixture(autouse=True)
def _public_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    mapping = {"example.com": ["1.1.1.1"], "example.org": ["1.0.0.1"]}

    def _resolve(
        host: str,
        _port: object = None,
        *_args: object,
        **_kwargs: object,
    ) -> list[tuple[int, int, int, str, tuple[str, int]]]:
        ips = mapping.get(host)
        if ips is None:
            raise socket.gaierror(socket.EAI_NONAME, "not found")
        results: list[tuple[int, int, int, str, tuple[str, int]]] = []
        for ip in ips:
            family = (
                socket.AF_INET6
                if isinstance(ipaddress.ip_address(ip), ipaddress.IPv6Address)
                else socket.AF_INET
            )
            results.append((family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (ip, 0)))
        return results

    monkeypatch.setattr("sentinel.core.security.socket.getaddrinfo", _resolve)


class _Navigator:
    async def stream(
        self,
        request: AgentRunRequest,
        lease: KeyLease,
    ) -> AsyncIterator[AgentEvent]:
        assert request.url
        assert lease.label
        yield StartedEvent(type="STARTED", run_id="run-1")
        yield ProgressEvent(type="PROGRESS", run_id="run-1", purpose="Open the storefront")
        yield CompleteEvent(
            type="COMPLETE",
            run_id="run-1",
            status=RunStatus.COMPLETED,
            result={
                "merchant_identities": {"merchant_identifiers": ["acct_123"]},
                "processing": {
                    "payment_processors": ["stripe"],
                    "reached_checkout": True,
                    "stopped_reason": "safety stop",
                },
                "indicators": [
                    {
                        "kind": "merchant_id",
                        "value": "acct_123",
                        "confidence": 0.9,
                        "source": "agent",
                    }
                ],
                "evidence": [
                    {
                        "field": "merchant_id",
                        "value": "acct_123",
                        "severity": "medium",
                        "source": "agent",
                    }
                ],
            },
        )


async def _enrich(_url: str) -> InfraProfile:
    return InfraProfile(
        a=("203.0.113.10",),
        issuer="Test CA",
        indicators=(Indicator(kind="ip", value="203.0.113.10"),),
    )


@pytest.fixture
def app(settings: Settings, tmp_path: Path) -> FastAPI:
    database = (tmp_path / "sentinel.db").as_posix()
    return create_app(
        settings,
        database_url=f"sqlite+aiosqlite:///{database}",
        navigator=_Navigator(),
        enrich_target=_enrich,
    )


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


def test_schema_script_rejects_a_missing_url() -> None:
    with pytest.raises(SystemExit):
        main([])


async def test_schema_script_is_idempotent(tmp_path: Path) -> None:
    url = f"sqlite+aiosqlite:///{(tmp_path / 'schema.db').as_posix()}"
    await run(url)
    await run(url)


async def test_missing_token_and_invalid_payloads_are_problems(client: AsyncClient) -> None:
    missing = await client.post("/v1/cases", json=_CASE)
    assert missing.status_code == 401
    assert missing.headers["content-type"].startswith("application/problem+json")
    assert missing.json()["detail"] == "X-Sentinel-Token is required"

    rejected = await client.post(
        "/v1/cases",
        headers=TOKEN,
        json={"title": "Lab", "authorized_by": "Ada", "authorization_ack": False},
    )
    assert rejected.status_code == 422
    assert rejected.headers["content-type"].startswith("application/problem+json")
    assert rejected.json()["title"] == "Unprocessable Entity"

    too_many = ["https://example.com"] * 11
    overflow = await client.post(
        "/v1/cases/missing/targets",
        headers=TOKEN,
        json={"urls": too_many},
    )
    assert overflow.status_code == 422


async def test_missing_case_is_not_found(client: AsyncClient) -> None:
    response = await client.get("/v1/cases/missing", headers=TOKEN)
    assert response.status_code == 404
    body = response.json()
    assert response.headers["content-type"].startswith("application/problem+json")
    assert body["title"] == "Not Found"
    assert body["detail"] == "Case not found"
    assert body["instance"] == "/v1/cases/missing"


async def test_case_targets_stream_graph_and_ledger(client: AsyncClient, app: FastAPI) -> None:
    created = await client.post("/v1/cases", headers=TOKEN, json=_CASE)
    assert created.status_code == 201
    case = created.json()
    assert case["number"].startswith("PS-")
    assert case["status"] == "created"
    assert case["created_at"].endswith("Z")
    case_id = case["id"]

    targets = await client.post(
        f"/v1/cases/{case_id}/targets",
        headers=TOKEN,
        json={
            "urls": [
                "https://example.com/shop",
                "https://example.org/pay",
                "http://127.0.0.1/local",
            ]
        },
    )
    assert targets.status_code == 200
    decisions = targets.json()
    assert decisions[0]["accepted"] is True
    assert decisions[0]["host"] == "example.com"
    assert "reason" not in decisions[0]
    assert decisions[1]["host"] == "example.org"
    assert decisions[2]["accepted"] is False
    assert decisions[2]["reason"] == "loopback"

    started = await client.post(
        f"/v1/cases/{case_id}/investigate",
        headers=TOKEN,
        json={"max_parallel": 1, "focus": "checkout", "use_profiles": False},
    )
    assert started.status_code == 202
    assert started.content == b""

    detail: dict[str, object] = {}
    for _ in range(50):
        fetched = await client.get(f"/v1/cases/{case_id}", headers=TOKEN)
        detail = fetched.json()
        if detail["status"] == "completed":
            break
        await asyncio.sleep(0.02)
    assert detail["status"] == "completed"
    stored_targets = detail["targets"]
    assert isinstance(stored_targets, list)
    assert len(stored_targets) == 2
    report = stored_targets[0]["report"]
    assert isinstance(report, dict)
    assert report["host"] == "example.com"
    assert report["risk"]["label"] in {"LOW", "MEDIUM", "HIGH"}
    assert len(report["evidence"]) == 8

    graph = (await client.get(f"/v1/cases/{case_id}/graph", headers=TOKEN)).json()
    kinds = {node["type"] for node in graph["nodes"]}
    assert graph["version"] == 1
    assert {"domain", "merchant"} <= kinds
    assert len(graph["clusters"]) == 1
    assert len(graph["clusters"][0]["members"]) == 2

    ledger = (await client.get(f"/v1/cases/{case_id}/ledger", headers=TOKEN)).json()
    assert ledger["next_cursor"] is None
    assert ledger["entries"]
    assert ledger["head_hash"] == ledger["entries"][-1]["entry_hash"]
    assert len(ledger["signature"]) == 64
    first_seq = ledger["entries"][0]["seq"]
    page = (
        await client.get(
            f"/v1/cases/{case_id}/ledger",
            headers=TOKEN,
            params={"cursor": str(first_seq)},
        )
    ).json()
    assert page["entries"]
    assert all(item["seq"] > first_seq for item in page["entries"])

    verified = (await client.post(f"/v1/cases/{case_id}/ledger/verify", headers=TOKEN)).json()
    assert verified["ok"] is True
    assert verified["signature_ok"] is True
    assert verified["entries_checked"] == len(ledger["entries"])
    assert verified["head_hash"] == ledger["head_hash"]

    stream = await _read_sse(app, case_id, None)
    assert "id: 1\n" in stream
    assert "CaseCompleted" in stream
    resumed = await _read_sse(app, case_id, "1")
    assert "id: 1\n" not in resumed
    assert "CaseCompleted" in resumed

    runtime = app.state.runtime
    assert isinstance(runtime, Runtime)
    async with runtime.sessions() as session:
        evidence = await session.scalar(
            select(func.count()).select_from(EvidenceRow).where(EvidenceRow.case_id == case_id)
        )
        indicators = await session.scalar(
            select(func.count()).select_from(IndicatorRow).where(IndicatorRow.case_id == case_id)
        )
        await session.execute(
            update(LedgerEntryRow)
            .where(LedgerEntryRow.case_id == case_id, LedgerEntryRow.seq == 1)
            .values(entry_hash="0" * 64)
        )
        await session.commit()
    assert evidence == 16
    assert indicators is not None and indicators >= 2

    broken = (await client.post(f"/v1/cases/{case_id}/ledger/verify", headers=TOKEN)).json()
    assert broken["ok"] is False
    assert broken["first_broken_seq"] == 1

    keys = await client.get(
        "/v1/health/keys",
        headers={**TOKEN, "Origin": "http://localhost:3000"},
    )
    assert keys.status_code == 200
    assert keys.json() == [{"label": "key-1", "state": "healthy", "in_flight": 0, "runs_served": 2}]
    expose = keys.headers.get("access-control-expose-headers", "")
    assert "x-sentinel-token" in expose.lower()

    preflight = await client.options(
        "/v1/health/keys",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "X-Sentinel-Token",
        },
    )
    assert preflight.status_code == 200
    allow = preflight.headers.get("access-control-allow-headers", "")
    assert "x-sentinel-token" in allow.lower()


async def test_list_cases_requires_auth_and_returns_newest_first(client: AsyncClient) -> None:
    denied = await client.get("/v1/cases")
    assert denied.status_code == 401
    assert denied.headers["content-type"].startswith("application/problem+json")
    assert denied.json()["detail"] == "X-Sentinel-Token is required"

    first = await client.post("/v1/cases", headers=TOKEN, json=_CASE)
    second = await client.post(
        "/v1/cases",
        headers=TOKEN,
        json={**_CASE, "title": "Newer storefronts"},
    )
    assert first.status_code == 201
    assert second.status_code == 201
    older = first.json()
    newer = second.json()

    listed = await client.get("/v1/cases", headers=TOKEN)
    assert listed.status_code == 200
    rows = listed.json()
    assert [row["id"] for row in rows] == [newer["id"], older["id"]]
    assert rows[0]["title"] == "Newer storefronts"
    assert rows[0]["status"] == "created"
    assert rows[0]["number"].startswith("PS-")
    assert rows[0]["created_at"].endswith("Z")
    assert set(rows[0]) == {"id", "number", "title", "status", "created_at"}


async def test_events_route_requires_auth_and_replays(client: AsyncClient, app: FastAPI) -> None:
    denied = await client.get("/v1/cases/missing/events")
    assert denied.status_code == 401
    assert denied.headers["content-type"].startswith("application/problem+json")

    missing = await client.get("/v1/cases/missing/events", headers=TOKEN)
    assert missing.status_code == 404
    assert missing.headers["content-type"].startswith("application/problem+json")
    assert missing.json()["title"] == "Not Found"
    assert missing.json()["detail"] == "Case not found"
    assert missing.json()["instance"] == "/v1/cases/missing/events"

    created = await client.post("/v1/cases", headers=TOKEN, json=_CASE)
    case_id = created.json()["id"]
    added = await client.post(
        f"/v1/cases/{case_id}/targets",
        headers=TOKEN,
        json={"urls": ["https://example.com/shop"]},
    )
    assert added.status_code == 200
    started = await client.post(f"/v1/cases/{case_id}/investigate", headers=TOKEN)
    assert started.status_code == 202
    stream = await _read_sse(app, case_id, None, suffix="events")
    assert "id: 1\n" in stream
    assert "CaseCompleted" in stream


async def test_cancel_case_requires_auth_and_returns_status(
    client: AsyncClient,
    app: FastAPI,
) -> None:
    denied = await client.post("/v1/cases/missing/cancel")
    assert denied.status_code == 401
    assert denied.json()["detail"] == "X-Sentinel-Token is required"

    missing = await client.post("/v1/cases/missing/cancel", headers=TOKEN)
    assert missing.status_code == 404
    assert missing.headers["content-type"].startswith("application/problem+json")
    assert missing.json()["detail"] == "Case not found"
    assert missing.json()["instance"] == "/v1/cases/missing/cancel"

    created = await client.post("/v1/cases", headers=TOKEN, json=_CASE)
    case = created.json()
    case_id = case["id"]
    runtime = app.state.runtime
    assert isinstance(runtime, Runtime)
    seen: list[str] = []
    original = runtime.orchestrator.cancel_case

    async def _spy(requested: str) -> None:
        seen.append(requested)
        await original(requested)

    runtime.orchestrator.cancel_case = _spy  # type: ignore[method-assign]
    cancelled = await client.post(f"/v1/cases/{case_id}/cancel", headers=TOKEN)
    assert cancelled.status_code == 200
    body = cancelled.json()
    assert seen == [case_id]
    assert body["id"] == case_id
    assert body["number"] == case["number"]
    assert body["title"] == case["title"]
    assert body["created_at"] == case["created_at"]
    assert body["status"] == "cancelled"
    stored = await client.get(f"/v1/cases/{case_id}", headers=TOKEN)
    assert stored.json()["status"] == "cancelled"


async def test_target_report_requires_auth_and_reads_payload_validated(
    client: AsyncClient,
    app: FastAPI,
) -> None:
    denied = await client.get("/v1/cases/missing/targets/tgt_missing/report")
    assert denied.status_code == 401
    assert denied.headers["content-type"].startswith("application/problem+json")

    missing = await client.get("/v1/cases/missing/targets/tgt_missing/report", headers=TOKEN)
    assert missing.status_code == 404
    assert missing.json()["title"] == "Not Found"
    assert missing.json()["detail"] == "Case not found"
    assert missing.json()["instance"] == "/v1/cases/missing/targets/tgt_missing/report"

    created = await client.post("/v1/cases", headers=TOKEN, json=_CASE)
    case_id = created.json()["id"]
    other = await client.post(
        "/v1/cases",
        headers=TOKEN,
        json={**_CASE, "title": "Other case"},
    )
    other_id = other.json()["id"]
    added = await client.post(
        f"/v1/cases/{case_id}/targets",
        headers=TOKEN,
        json={"urls": ["https://example.com/shop"]},
    )
    assert added.status_code == 200
    detail = (await client.get(f"/v1/cases/{case_id}", headers=TOKEN)).json()
    target_id = detail["targets"][0]["target_id"]
    report_path = f"/v1/cases/{case_id}/targets/{target_id}/report"

    waiting = await client.get(report_path, headers=TOKEN)
    assert waiting.status_code == 404
    assert waiting.headers["content-type"].startswith("application/problem+json")
    assert waiting.json()["detail"] == "Target report is not available"

    foreign = await client.get(
        f"/v1/cases/{case_id}/targets/tgt_other/report",
        headers=TOKEN,
    )
    assert foreign.status_code == 404
    assert foreign.json()["detail"] == "Target not found"

    cross = await client.get(
        f"/v1/cases/{other_id}/targets/{target_id}/report",
        headers=TOKEN,
    )
    assert cross.status_code == 404
    assert cross.json()["detail"] == "Target not found"

    report = TargetReport(
        target_id=target_id,
        host="example.com",
        risk=Risk(score=25, label="LOW", evidence_coverage="8/8", verdict="Lab verdict"),
        evidence=tuple(EvidenceItem(field=field, value="example.com") for field in EVIDENCE_FIELDS),
    )
    runtime = app.state.runtime
    assert isinstance(runtime, Runtime)
    async with runtime.sessions() as session:
        session.add(
            LedgerEntryRow(
                case_id=case_id,
                seq=1,
                ts="2026-10-24T12:00:00.000Z",
                event_type="PayloadValidated",
                payload={
                    "case_id": case_id,
                    "seq": 1,
                    "ts": "2026-10-24T12:00:00.000Z",
                    "type": "PayloadValidated",
                    "target_id": target_id,
                    "report": report.model_dump(mode="json"),
                },
                prev_hash="a" * 64,
                entry_hash="b" * 64,
            )
        )
        await session.commit()

    found = await client.get(report_path, headers=TOKEN)
    assert found.status_code == 200
    body = found.json()
    assert body["target_id"] == target_id
    assert body["host"] == "example.com"
    assert body["risk"]["verdict"] == "Lab verdict"
    assert len(body["evidence"]) == 8


async def test_approve_pivot_requires_auth_and_returns_not_implemented(
    client: AsyncClient,
) -> None:
    denied = await client.post("/v1/cases/missing/pivots/piv_1/approve")
    assert denied.status_code == 401
    assert denied.headers["content-type"].startswith("application/problem+json")
    assert denied.json()["detail"] == "X-Sentinel-Token is required"

    missing = await client.post("/v1/cases/missing/pivots/piv_1/approve", headers=TOKEN)
    assert missing.status_code == 404
    assert missing.json()["title"] == "Not Found"
    assert missing.json()["detail"] == "Case not found"
    assert missing.json()["instance"] == "/v1/cases/missing/pivots/piv_1/approve"

    created = await client.post("/v1/cases", headers=TOKEN, json=_CASE)
    case_id = created.json()["id"]
    response = await client.post(
        f"/v1/cases/{case_id}/pivots/piv_1/approve",
        headers=TOKEN,
    )
    assert response.status_code == 501
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["type"] == "about:blank"
    assert body["title"] == "Not Implemented"
    assert body["status"] == 501
    assert body["detail"] == "Pivot approval is not implemented for piv_1"
    assert body["code"] == "not_implemented"
    assert body["instance"] == f"/v1/cases/{case_id}/pivots/piv_1/approve"


async def _read_sse(
    app: FastAPI,
    case_id: str,
    last_event_id: str | None,
    *,
    suffix: str = "stream",
) -> str:
    """Read the replay, then disconnect. The httpx ASGI transport buffers until close."""
    headers = [(b"x-sentinel-token", b"test-token")]
    if last_event_id is not None:
        headers.append((b"last-event-id", last_event_id.encode()))
    path = f"/v1/cases/{case_id}/{suffix}"
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": headers,
        "client": ("127.0.0.1", 123),
        "server": ("test", 80),
    }
    chunks: list[bytes] = []
    status = 0
    content_type = ""
    ready = asyncio.Event()

    async def receive() -> dict[str, str]:
        await ready.wait()
        return {"type": "http.disconnect"}

    async def send(message: dict[str, object]) -> None:
        nonlocal status, content_type
        kind = message.get("type")
        if kind == "http.response.start":
            raw_status = message.get("status")
            if isinstance(raw_status, int):
                status = raw_status
            raw_headers = message.get("headers")
            if isinstance(raw_headers, list):
                for item in raw_headers:
                    if not isinstance(item, tuple) or len(item) != 2:
                        continue
                    key, value = item
                    if key == b"content-type" and isinstance(value, bytes):
                        content_type = value.decode()
        elif kind == "http.response.body":
            body = message.get("body")
            if isinstance(body, bytes) and body:
                chunks.append(body)
            if b"CaseCompleted" in b"".join(chunks):
                ready.set()

    await asyncio.wait_for(app(scope, receive, send), timeout=5)
    assert status == 200
    assert content_type.startswith("text/event-stream")
    return b"".join(chunks).decode()
