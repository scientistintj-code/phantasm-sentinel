"""Application factory, health, and problem responses."""

import pytest
from httpx import ASGITransport, AsyncClient

from sentinel import __version__
from sentinel.api.app import create_app
from sentinel.api.deps import SettingsDep
from sentinel.core.config import Settings
from sentinel.core.errors import (
    EvidenceIntegrityError,
    InvalidTargetError,
    KeyPoolExhaustedError,
    TinyFishError,
)


@pytest.mark.asyncio
async def test_health_reports_status_and_version(settings: Settings) -> None:
    app = create_app(settings)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__}
    assert response.headers["x-request-id"]


@pytest.mark.asyncio
async def test_request_id_is_echoed_when_valid(settings: Settings) -> None:
    app = create_app(settings)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        echoed = await client.get("/health", headers={"X-Request-ID": "req-123"})
        replaced = await client.get("/health", headers={"X-Request-ID": "bad id"})

    assert echoed.headers["x-request-id"] == "req-123"
    assert replaced.headers["x-request-id"] != "bad id"
    assert replaced.headers["x-request-id"]


@pytest.mark.asyncio
async def test_cors_allows_configured_origin_only(settings: Settings) -> None:
    app = create_app(settings)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        allowed = await client.get("/health", headers={"Origin": "http://localhost:3000"})
        blocked = await client.get("/health", headers={"Origin": "http://evil.example"})

    assert allowed.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "access-control-allow-origin" not in blocked.headers


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("kind", "status_code", "code"),
    [
        ("target", 400, "invalid_target"),
        ("keys", 503, "key_pool_exhausted"),
        ("tinyfish", 502, "tinyfish_error"),
        ("evidence", 500, "evidence_integrity"),
    ],
)
async def test_domain_errors_are_problem_responses(
    settings: Settings,
    kind: str,
    status_code: int,
    code: str,
) -> None:
    app = create_app(settings)

    @app.get("/boom/{kind}")
    async def boom(kind: str) -> None:
        if kind == "target":
            raise InvalidTargetError("bad target", reason="host")
        if kind == "keys":
            raise KeyPoolExhaustedError("pool exhausted")
        if kind == "tinyfish":
            raise TinyFishError("upstream failed")
        raise EvidenceIntegrityError("digest mismatch")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(f"/boom/{kind}", headers={"X-Request-ID": "err-1"})

    assert response.status_code == status_code
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.headers["x-request-id"] == "err-1"
    body = response.json()
    assert body["status"] == status_code
    assert body["code"] == code
    assert body["request_id"] == "err-1"
    assert body["instance"] == f"/boom/{kind}"
    assert body["title"]
    assert body["detail"]


@pytest.mark.asyncio
async def test_settings_dependency_uses_app_state(settings: Settings) -> None:
    app = create_app(settings)

    @app.get("/probe")
    async def probe(resolved: SettingsDep) -> dict[str, bool]:
        return {"same": resolved is settings}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/probe")

    assert response.status_code == 200
    assert response.json() == {"same": True}
