"""Settings parsing, defaults, and secret redaction in repr."""

import pytest
from pydantic import ValidationError

from sentinel.core.config import Settings, get_settings
from tests.support import apply_minimum_env


def test_parses_comma_separated_api_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_minimum_env(monkeypatch)
    monkeypatch.setenv("TINYFISH_API_KEYS", " alpha , beta ")

    settings = Settings()

    assert tuple(key.get_secret_value() for key in settings.tinyfish_api_keys) == ("alpha", "beta")
    assert str(settings.tinyfish_api_keys[0]) == "**********"


def test_blank_api_key_pool_is_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_minimum_env(monkeypatch)
    monkeypatch.setenv("TINYFISH_API_KEYS", "   ")

    assert Settings().tinyfish_api_keys == ()


def test_rejects_empty_api_key_entries(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_minimum_env(monkeypatch)
    monkeypatch.setenv("TINYFISH_API_KEYS", "alpha-secret,,beta-secret")

    with pytest.raises(ValidationError) as caught:
        Settings()

    message = str(caught.value)
    assert "alpha-secret" not in message
    assert "beta-secret" not in message


@pytest.mark.parametrize("raw", ["alpha,", ",alpha", "alpha, ,beta"])
def test_rejects_blank_segments(monkeypatch: pytest.MonkeyPatch, raw: str) -> None:
    apply_minimum_env(monkeypatch)
    monkeypatch.setenv("TINYFISH_API_KEYS", raw)

    with pytest.raises(ValidationError):
        Settings()


def test_repr_hides_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_minimum_env(monkeypatch)
    monkeypatch.setenv("TINYFISH_API_KEYS", "hidden-api-key,second-hidden-key")

    settings = Settings()
    rendered = repr(settings)

    assert "hidden-api-key" not in rendered
    assert "second-hidden-key" not in rendered
    assert "hidden-db-password" not in rendered
    assert "hidden-signing-secret" not in rendered
    assert "hidden-api-key" not in repr(settings.tinyfish_api_keys)
    assert "hidden-api-key" not in str(settings)
    assert "<2 secret(s)>" in rendered


def test_defaults_match_env_example(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_minimum_env(monkeypatch)

    settings = Settings()

    assert str(settings.tinyfish_agent_base_url).rstrip("/") == "https://agent.tinyfish.ai"
    assert settings.allowed_origins == ("http://localhost:3000",)
    assert settings.demo_replay is False
    assert settings.max_steps_per_run == 40
    assert settings.max_seconds_per_run == 240
    assert settings.tinyfish_api_keys == ()


def test_parses_origins_limits_and_replay(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_minimum_env(monkeypatch)
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://localhost:3000, http://127.0.0.1:3001/")
    monkeypatch.setenv("DEMO_REPLAY", "true")
    monkeypatch.setenv("MAX_STEPS_PER_RUN", "12")
    monkeypatch.setenv("MAX_SECONDS_PER_RUN", "90")

    settings = Settings()

    assert settings.allowed_origins == ("http://localhost:3000", "http://127.0.0.1:3001")
    assert settings.demo_replay is True
    assert settings.max_steps_per_run == 12
    assert settings.max_seconds_per_run == 90


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "http://localhost:3000/app",
        "http://user:pass@localhost:3000",
        "http://localhost:99999",
        "http://localhost:3000,,http://localhost:3001",
    ],
)
def test_rejects_bad_origins(monkeypatch: pytest.MonkeyPatch, origin: str) -> None:
    apply_minimum_env(monkeypatch)
    monkeypatch.setenv("ALLOWED_ORIGINS", origin)

    with pytest.raises(ValidationError):
        Settings()


def test_rejects_empty_signing_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+asyncpg://sentinel:hidden-db-password@localhost:5432/sentinel",
    )
    monkeypatch.setenv("EVIDENCE_SIGNING_SECRET", "   ")

    with pytest.raises(ValidationError):
        Settings()


def test_database_url_accepts_asyncpg_or_aiosqlite(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EVIDENCE_SIGNING_SECRET", "hidden-signing-secret")
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///sentinel.db")

    assert Settings().database_url.get_secret_value() == "sqlite+aiosqlite:///sentinel.db"

    monkeypatch.setenv("DATABASE_URL", "sqlite:///sentinel.db")

    with pytest.raises(ValidationError, match="postgresql\\+asyncpg or sqlite\\+aiosqlite"):
        Settings()


def test_rejects_credentials_in_agent_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_minimum_env(monkeypatch)
    monkeypatch.setenv("TINYFISH_AGENT_BASE_URL", "https://user:pass@agent.tinyfish.ai")

    with pytest.raises(ValidationError):
        Settings()


@pytest.mark.parametrize(
    ("name", "value"), [("MAX_STEPS_PER_RUN", "0"), ("MAX_SECONDS_PER_RUN", "-1")]
)
def test_rejects_non_positive_limits(
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    value: str,
) -> None:
    apply_minimum_env(monkeypatch)
    monkeypatch.setenv(name, value)

    with pytest.raises(ValidationError):
        Settings()


def test_get_settings_is_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_minimum_env(monkeypatch)
    monkeypatch.setenv("TINYFISH_API_KEYS", "alpha")
    get_settings.cache_clear()

    first = get_settings()
    monkeypatch.setenv("TINYFISH_API_KEYS", "beta")
    second = get_settings()

    assert first is second
    assert first.tinyfish_api_keys[0].get_secret_value() == "alpha"

    get_settings.cache_clear()
    refreshed = get_settings()
    assert refreshed is not first
    assert refreshed.tinyfish_api_keys[0].get_secret_value() == "beta"
