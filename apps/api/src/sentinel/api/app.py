"""FastAPI application factory."""

import re
from uuid import uuid4

import structlog
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from sentinel import __version__
from sentinel.api.routes import health
from sentinel.core.config import Settings, get_settings
from sentinel.core.errors import InvalidTargetError, SentinelError
from sentinel.core.logging import configure_logging, request_id_var

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


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the API with CORS, request ids, and domain error responses."""
    resolved = settings if settings is not None else get_settings()
    configure_logging()
    app = FastAPI(title="Phantasm Sentinel", version=__version__)
    app.state.settings = resolved
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )
    app.add_middleware(RequestIdMiddleware)
    app.add_exception_handler(SentinelError, sentinel_error_handler)
    app.include_router(health.router)
    return app


def main() -> None:
    """Run the API on localhost."""
    uvicorn.run(
        "sentinel.api.app:create_app",
        factory=True,
        host="127.0.0.1",
        port=8000,
    )
