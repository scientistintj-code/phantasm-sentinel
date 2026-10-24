"""Declarative base for sentinel tables."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Shared metadata for the case store."""
