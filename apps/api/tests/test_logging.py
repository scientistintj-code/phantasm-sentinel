"""Structured logging redacts credential-like keys."""

import json

import pytest
import structlog

from sentinel.core.logging import configure_logging, redact_sensitive


def test_redacts_sensitive_keys() -> None:
    event = {
        "event": "boot",
        "api_key": "k-api",
        "api-key": "k-dashed",
        "APIKEY": "k-compact",
        "Authorization": "Bearer abc",
        "x-api-key": "k-header",
        "X_API_KEY": "k-underscore",
        "evidence_signing_secret": "k-signing",
        "nested": {"secret": "k-nested", "case_id": "case-1"},
        "items": [{"api_key": "k-list", "step": 1}],
        "status": "ok",
    }

    redacted = redact_sensitive(None, "info", event)  # type: ignore[arg-type]

    rendered = json.dumps(redacted)
    for secret in (
        "k-api",
        "k-dashed",
        "k-compact",
        "Bearer abc",
        "k-header",
        "k-underscore",
        "k-signing",
        "k-nested",
        "k-list",
    ):
        assert secret not in rendered
    assert redacted["status"] == "ok"
    assert redacted["nested"]["case_id"] == "case-1"
    assert redacted["items"][0]["step"] == 1
    assert redacted["api_key"] == "[REDACTED]"
    assert redacted["Authorization"] == "[REDACTED]"
    assert redacted["x-api-key"] == "[REDACTED]"


def test_redacts_tuple_values_and_keeps_blank_keys() -> None:
    event = {
        "pair": ({"secret": "k-tuple", "case_id": "c"},),
        "***": "keep",
    }

    redacted = redact_sensitive(None, "info", event)  # type: ignore[arg-type]

    pair = redacted["pair"]
    assert isinstance(pair, tuple)
    nested = pair[0]
    assert isinstance(nested, dict)
    assert nested["secret"] == "[REDACTED]"
    assert nested["case_id"] == "c"
    assert redacted["***"] == "keep"


def test_configure_logging_is_idempotent_and_emits_json(
    capsys: pytest.CaptureFixture[str],
) -> None:
    configure_logging()
    processors = structlog.get_config()["processors"]
    configure_logging()

    assert structlog.get_config()["processors"] is processors
    assert redact_sensitive in processors

    structlog.get_logger("sentinel.test").info(
        "ready",
        api_key="top-secret",
        nested={"secret": "nested-secret", "case_id": "case-9"},
        status="ok",
    )
    line = capsys.readouterr().out.strip().splitlines()[-1]
    payload = json.loads(line)

    assert payload["event"] == "ready"
    assert payload["status"] == "ok"
    assert payload["api_key"] == "[REDACTED]"
    assert payload["nested"]["secret"] == "[REDACTED]"
    assert payload["nested"]["case_id"] == "case-9"
    assert "top-secret" not in line
    assert "nested-secret" not in line
