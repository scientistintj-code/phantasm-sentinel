"""FastAPI application factory."""

import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

import structlog
import uvicorn
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from sentinel import __version__
from sentinel.api.problems import problem_response, validation_detail
from sentinel.api.routes import cases, health
from sentinel.api.runtime import Runtime, build_runtime
from sentinel.core.config import Settings, get_settings
from sentinel.core.errors import InvalidTargetError, SentinelError
from sentinel.core.logging import configure_logging, request_id_var
from sentinel.orchestrator.engine import TargetEnricher, TinyFishNavigator

_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
log = structlog.get_logger(__name__)


class RequestIdMiddleware:
    """Assign a request id, bind it for logs, and return it on the response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = _request_id(scope)
        state = scope.setdefault("state", {})
        if isinstance(state, dict):
            state["request_id"] = request_id

        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)
        token = request_id_var.set(request_id)

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Request-ID"] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            request_id_var.reset(token)
            structlog.contextvars.clear_contextvars()


def _request_id(scope: Scope) -> str:
    raw_headers = scope.get("headers", [])
    if isinstance(raw_headers, list):
        for item in raw_headers:
            if not isinstance(item, tuple) or len(item) != 2:
                continue
            name, value = item
            if name != b"x-request-id" or not isinstance(value, bytes):
                continue
            candidate = value.decode("latin-1")
            if _REQUEST_ID_RE.fullmatch(candidate):
                return candidate
            break
    return str(uuid4())


async def sentinel_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Render a domain error as a problem-details JSON body."""
    if not isinstance(exc, SentinelError):
        raise exc
    if isinstance(exc, InvalidTargetError):
        log.info(
            "sentinel_error",
            error_code=exc.code,
            status_code=exc.status_code,
            reason=exc.reason,
        )
    else:
        log.info(
            "sentinel_error",
            error_code=exc.code,
            status_code=exc.status_code,
        )
    body: dict[str, object] = {
        "type": "about:blank",
        "title": exc.title,
        "status": exc.status_code,
        "detail": exc.message,
        "code": exc.code,
        "instance": request.url.path,
    }
    request_id = request_id_var.get()
    if request_id is not None:
        body["request_id"] = request_id
    return JSONResponse(
        status_code=exc.status_code,
        content=body,
        media_type="application/problem+json",
    )


class SentinelTokenMiddleware:
    """Require ``X-Sentinel-Token`` on ``/v1`` routes while live mode is on."""

    def __init__(self, app: ASGIApp, *, live: bool) -> None:
        self.app = app
        self._live = live

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self._live:
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        method = scope.get("method")
        if not isinstance(path, str) or not path.startswith("/v1") or method == "OPTIONS":
            await self.app(scope, receive, send)
            return
        token = _header(scope, b"x-sentinel-token")
        if token is None or token.strip() == "":
            response = problem_response(
                path,
                status=401,
                title="Unauthorized",
                detail="X-Sentinel-Token is required",
                code="missing_token",
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


def _header(scope: Scope, name: bytes) -> str | None:
    raw_headers = scope.get("headers", [])
    if not isinstance(raw_headers, list):
        return None
    for item in raw_headers:
        if not isinstance(item, tuple) or len(item) != 2:
            continue
        key, value = item
        if key == name and isinstance(value, bytes):
            return value.decode("latin-1")
    return None


async def validation_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Render a request-body error as problem details."""
    if not isinstance(exc, RequestValidationError):
        raise exc
    return problem_response(
        request.url.path,
        status=422,
        title="Unprocessable Entity",
        detail=validation_detail(list(exc.errors())),
        code="validation_error",
    )


def create_app(
    settings: Settings | None = None,
    *,
    database_url: str | None = None,
    navigator: TinyFishNavigator | None = None,
    enrich_target: TargetEnricher | None = None,
) -> FastAPI:
    """Build the API with CORS, live-mode token checks, and case routes."""
    resolved = settings if settings is not None else get_settings()
    configure_logging()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        yield
        running = getattr(app.state, "runtime", None)
        if isinstance(running, Runtime):
            await running.aclose()

    app = FastAPI(title="Phantasm Sentinel", version=__version__, lifespan=lifespan)
    app.state.settings = resolved
    app.state.runtime = build_runtime(
        resolved,
        database_url=database_url,
        navigator=navigator,
        enrich_target=enrich_target,
    )
    app.add_middleware(SentinelTokenMiddleware, live=not resolved.demo_replay)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Accept",
            "X-Request-ID",
            "X-Sentinel-Token",
            "Last-Event-ID",
        ],
        expose_headers=["X-Request-ID", "X-Sentinel-Token"],
    )
    app.add_middleware(RequestIdMiddleware)
    app.add_exception_handler(SentinelError, sentinel_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.include_router(health.router)
    app.include_router(cases.router)
    return app


def main() -> None:
    """Run the API on localhost."""
    uvicorn.run(
        "sentinel.api.app:create_app",
        factory=True,
        host="127.0.0.1",
        port=8000,
    )
