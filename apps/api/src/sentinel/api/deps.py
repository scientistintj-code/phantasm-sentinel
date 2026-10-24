"""FastAPI dependencies."""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from sentinel.api.runtime import Runtime
from sentinel.core.config import Settings, get_settings


def get_request_settings(request: Request) -> Settings:
    """Return the settings bound to this application."""
    configured = getattr(request.app.state, "settings", None)
    if isinstance(configured, Settings):
        return configured
    return get_settings()


def get_runtime(request: Request) -> Runtime:
    """Return the bus, pool, and database bound to this application."""
    configured = getattr(request.app.state, "runtime", None)
    if not isinstance(configured, Runtime):
        raise RuntimeError("API runtime is not configured")
    return configured


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Yield a session after the schema exists, then close it."""
    runtime = get_runtime(request)
    await runtime.ensure_schema()
    async with runtime.sessions() as session:
        yield session


SettingsDep = Annotated[Settings, Depends(get_request_settings)]
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
