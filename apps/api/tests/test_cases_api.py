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
from sentinel.pipeline.enrichment import Indicator, InfraProfile
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


async def _read_sse(app: FastAPI, case_id: str, last_event_id: str | None) -> str:
    """Read the replay, then disconnect. The httpx ASGI transport buffers until close."""
    headers = [(b"x-sentinel-token", b"test-token")]
    if last_event_id is not None:
        headers.append((b"last-event-id", last_event_id.encode()))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": f"/v1/cases/{case_id}/stream",
        "raw_path": f"/v1/cases/{case_id}/stream".encode(),
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
