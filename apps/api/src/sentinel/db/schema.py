"""Create the case schema. Usage: python -m sentinel.db.schema <sqlalchemy-url>."""

from __future__ import annotations

import asyncio
import sys

from sentinel.db.session import build_engine, init_schema


async def run(url: str) -> None:
    """Create tables for ``url`` and dispose the engine."""
    engine = build_engine(url)
    try:
        await init_schema(engine)
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> None:
    """Create tables for the SQLAlchemy URL passed as the only argument."""
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        raise SystemExit("usage: python -m sentinel.db.schema <sqlalchemy-url>")
    asyncio.run(run(args[0]))


if __name__ == "__main__":
    main()
