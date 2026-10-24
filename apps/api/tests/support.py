"""Helpers shared by API unit tests."""

import pytest


def apply_minimum_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Set the required non-default settings to inert test values."""
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+asyncpg://sentinel:hidden-db-password@localhost:5432/sentinel",
    )
    monkeypatch.setenv("EVIDENCE_SIGNING_SECRET", "hidden-signing-secret")
