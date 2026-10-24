"""Shared fixtures for API unit tests."""

from collections.abc import Iterator
from pathlib import Path

import pytest

from sentinel.core.config import Settings, get_settings
from tests.support import apply_minimum_env


@pytest.fixture(autouse=True)
def isolated_settings(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[None]:
    """Drop inherited settings and avoid reading a developer .env file."""
    monkeypatch.chdir(tmp_path)
    for key in (
        "TINYFISH_API_KEYS",
        "TINYFISH_AGENT_BASE_URL",
        "DATABASE_URL",
        "EVIDENCE_SIGNING_SECRET",
        "ALLOWED_ORIGINS",
        "DEMO_REPLAY",
        "MAX_STEPS_PER_RUN",
        "MAX_SECONDS_PER_RUN",
    ):
        monkeypatch.delenv(key, raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def settings(monkeypatch: pytest.MonkeyPatch, isolated_settings: None) -> Settings:
    apply_minimum_env(monkeypatch)
    monkeypatch.setenv("TINYFISH_API_KEYS", "test-api-key")
    return Settings()
