"""Async SQLAlchemy engines and sessions."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from sentinel.db.base import Base


def build_engine(url: str) -> AsyncEngine:
    """Build an async engine. SQLite connections do not cross requests."""
    if url.startswith("sqlite"):
        engine = create_async_engine(
            url,
            poolclass=NullPool,
            connect_args={"check_same_thread": False},
        )
        _enable_sqlite_pragmas(engine)
        return engine
    return create_async_engine(url, pool_pre_ping=True)


def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Return a session maker that does not expire attributes on commit."""
    return async_sessionmaker(engine, expire_on_commit=False)


async def init_schema(engine: AsyncEngine) -> None:
    """Create any missing tables. Existing tables are left in place."""
    from sentinel.db.models import CaseRow

    if CaseRow.__tablename__ != "cases":
        raise RuntimeError("case table is not registered")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


@asynccontextmanager
async def session_scope(factory: async_sessionmaker[AsyncSession]) -> AsyncIterator[AsyncSession]:
    """Yield a session and close it when the caller returns."""
    async with factory() as session:
        yield session


def _enable_sqlite_pragmas(engine: AsyncEngine) -> None:
    @event.listens_for(engine.sync_engine, "connect")
    def _pragmas(dbapi_connection: Any, _connection_record: Any) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()
