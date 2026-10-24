"""Live TinyFish smoke check for Search, Fetch, and one Agent stream.

Run from apps/api:

    uv run python scripts/smoke_tinyfish.py

Prints key labels, event types, timestamps, and the streaming URL.
Credentials from `.env` are never written to stdout or stderr.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import TypeVar

import structlog
from pydantic import ValidationError
from pydantic_settings import SettingsConfigDict
from structlog.exceptions import DropEvent
from structlog.typing import EventDict

from sentinel.core.config import Settings
from sentinel.core.errors import (
    SentinelError,
    TinyFishDeadlineError,
    TinyFishRunInterruptedError,
)
from sentinel.core.logging import redact_sensitive
from sentinel.tinyfish import (
    AgentRunRequest,
    CompleteEvent,
    KeyPool,
    StreamingUrlEvent,
    TinyFishClient,
)
from sentinel.tinyfish.models import (
    AgentConfig,
    AgentEvent,
    FetchResponse,
    RunStatus,
    SearchResponse,
)

_API_ROOT = Path(__file__).resolve().parent.parent
_SEARCH_QUERY = "hackathon"
_TARGET_URL = "https://example.com"
_GOAL = "Return the page title as JSON"
_RESULT_LIMIT = 240
_HEADER_SECRET = re.compile(
    r"(?i)(x-api-key|authorization|api[_-]?key)(\s*[:=]\s*)(\S+)",
)
_T = TypeVar("_T")


class SmokeFailure(Exception):
    """The smoke check could not finish. The message is safe to print."""


def _resolve_env_file() -> Path:
    """Prefer the API project `.env`, then the repository root `.env`."""
    candidates = (_API_ROOT / ".env", _API_ROOT.parent / ".env")
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(".env")


def _load_settings() -> Settings:
    env_file = _resolve_env_file()

    class EnvSettings(Settings):
        model_config = SettingsConfigDict(
            env_file=env_file,
            env_file_encoding="utf-8",
            extra="ignore",
            hide_input_in_errors=True,
            frozen=True,
        )

    # Settings reads a relative `.env` from the process cwd. Pin that directory
    # as well so a parent config and the cwd file cannot disagree.
    os.chdir(env_file.parent)
    return EnvSettings()


def _secret_values(settings: Settings) -> tuple[str, ...]:
    found = [key.get_secret_value() for key in settings.tinyfish_api_keys]
    found.append(settings.database_url.get_secret_value())
    found.append(settings.evidence_signing_secret.get_secret_value())
    hidden = {value for value in found if len(value) >= 8}
    return tuple(sorted(hidden, key=len, reverse=True))


def _scrub_text(text: str, secrets: tuple[str, ...]) -> str:
    redacted = " ".join(text.split())
    for secret in secrets:
        redacted = redacted.replace(secret, "[REDACTED]")
    return _HEADER_SECRET.sub(r"\1\2[REDACTED]", redacted)


def _scrub_value(value: object, secrets: tuple[str, ...]) -> object:
    if isinstance(value, str):
        return _scrub_text(value, secrets)
    if isinstance(value, dict):
        return {str(key): _scrub_value(item, secrets) for key, item in value.items()}
    if isinstance(value, list):
        return [_scrub_value(item, secrets) for item in value]
    if isinstance(value, tuple):
        return tuple(_scrub_value(item, secrets) for item in value)
    if isinstance(value, int | float | bool) or value is None:
        return value
    return _scrub_text(str(value), secrets)


def _short(text: str, secrets: tuple[str, ...], limit: int = _RESULT_LIMIT) -> str:
    scrubbed = _scrub_text(text, secrets)
    if len(scrubbed) <= limit:
        return scrubbed
    return scrubbed[: limit - 3] + "..."


def _emit(text: str, secrets: tuple[str, ...], *, error: bool = False) -> None:
    print(_scrub_text(text, secrets), file=sys.stderr if error else sys.stdout, flush=True)


def _validation_message(exc: ValidationError) -> str:
    parts: list[str] = []
    for error in exc.errors():
        location = ".".join(str(part) for part in error["loc"])
        parts.append(f"{location}: {error['msg']}")
    return "; ".join(parts) if parts else "invalid settings"


def _explain(exc: BaseException) -> str:
    if isinstance(exc, TinyFishDeadlineError | TinyFishRunInterruptedError):
        run_id = exc.run_id or "-"
        return f"{exc.code}: {exc.message} run_id={run_id}"
    if isinstance(exc, SentinelError):
        return f"{exc.code}: {exc.message}"
    return f"{type(exc).__name__}: {exc}"


class _UsedKeys:
    """Labels from TinyFish logs. A rotated key is not the one that served the call."""

    def __init__(self) -> None:
        self._success: list[str] = []
        self._attempted: list[str] = []

    def observe(self, method_name: str, event_dict: EventDict) -> EventDict:
        event = event_dict.get("event")
        label = event_dict.get("key_label")
        if isinstance(label, str):
            if event == "key_acquired":
                self._attempted.append(label)
            elif event in {"tinyfish_call", "tinyfish_event"}:
                self._success.append(label)
        if method_name in {"debug", "info"}:
            raise DropEvent
        return event_dict

    @property
    def success_count(self) -> int:
        return len(self._success)

    @property
    def attempt_count(self) -> int:
        return len(self._attempted)

    def label_since(self, success_at: int, attempt_at: int) -> str:
        succeeded = _join_labels(self._success[success_at:])
        if succeeded != "none":
            return succeeded
        return _join_labels(self._attempted[attempt_at:])


def _join_labels(labels: list[str]) -> str:
    unique: list[str] = []
    for label in labels:
        if label not in unique:
            unique.append(label)
    return ",".join(unique) if unique else "none"


def _configure_logging(secrets: tuple[str, ...]) -> _UsedKeys:
    """Keep library logs off stdout and strip credential values."""
    used = _UsedKeys()

    def scrub(_logger: object, _method_name: str, event_dict: EventDict) -> EventDict:
        for key, value in list(event_dict.items()):
            event_dict[key] = _scrub_value(value, secrets)
        return event_dict

    def observe(_logger: object, method_name: str, event_dict: EventDict) -> EventDict:
        return used.observe(method_name, event_dict)

    # httpx logs request headers, including X-API-Key, at DEBUG.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            observe,
            redact_sensitive,
            scrub,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
        cache_logger_on_first_use=False,
    )
    return used


def _stdio_utf8() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="replace")


def _observed_timestamp() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _event_timestamp(event: AgentEvent) -> str:
    if event.timestamp is not None and event.timestamp.strip() != "":
        return event.timestamp.strip()
    return _observed_timestamp()


async def _invoke(
    used: _UsedKeys,
    step: str,
    operation: Callable[[], Awaitable[_T]],
) -> tuple[str, _T]:
    success_at = used.success_count
    attempt_at = used.attempt_count
    try:
        result = await operation()
    except Exception as exc:
        label = used.label_since(success_at, attempt_at)
        # Drop the traceback. httpx frames can hold the API key header.
        raise SmokeFailure(f"{step} key_label={label}: {_explain(exc)}") from None
    label = used.label_since(success_at, attempt_at)
    if label == "none":
        raise SmokeFailure(f"{step} finished without a TinyFish key label")
    return label, result


def _failure_reason(event: CompleteEvent) -> str | None:
    if event.error is not None:
        code = event.error.code or "error"
        return f"status={event.status.value} error={code}"
    if event.status is not RunStatus.COMPLETED:
        return f"status={event.status.value}"
    if not event.result:
        return f"status={event.status.value} result=empty"
    if event.result.get("status") == "failure":
        return f"status={event.status.value} goal=failure"
    return None


async def _search(client: TinyFishClient, used: _UsedKeys, secrets: tuple[str, ...]) -> None:
    async def operation() -> SearchResponse:
        return await client.search(_SEARCH_QUERY)

    label, response = await _invoke(used, "search", operation)
    _emit(
        f"search key_label={label} query={response.query} results={response.total_results}",
        secrets,
    )


async def _fetch(client: TinyFishClient, used: _UsedKeys, secrets: tuple[str, ...]) -> None:
    async def operation() -> FetchResponse:
        return await client.fetch(_TARGET_URL)

    label, response = await _invoke(used, "fetch", operation)
    if response.errors:
        detail = response.errors[0].error
        raise SmokeFailure(f"fetch key_label={label} failed: {detail}")
    if not response.results:
        raise SmokeFailure(f"fetch key_label={label} returned no page")
    title = response.results[0].title or "-"
    _emit(f"fetch key_label={label} title={_short(title, secrets)}", secrets)


async def _stream(
    client: TinyFishClient,
    used: _UsedKeys,
    settings: Settings,
    secrets: tuple[str, ...],
) -> None:
    # max_steps is beta-only. Other accounts return 403 FORBIDDEN for that field.
    request = AgentRunRequest(
        url=_TARGET_URL,
        goal=_GOAL,
        agent_config=AgentConfig(max_duration_seconds=settings.max_seconds_per_run),
    )
    success_at = used.success_count
    attempt_at = used.attempt_count
    streaming_url = "-"
    completed: CompleteEvent | None = None
    try:
        async for event in client.stream_agent(request):
            if isinstance(event, StreamingUrlEvent):
                streaming_url = event.streaming_url
            timestamp = _event_timestamp(event)
            _emit(
                f"event type={event.type} timestamp={timestamp} streaming_url={streaming_url}",
                secrets,
            )
            if isinstance(event, CompleteEvent):
                completed = event
    except Exception as exc:
        label = used.label_since(success_at, attempt_at)
        raise SmokeFailure(f"agent key_label={label}: {_explain(exc)}") from None

    label = used.label_since(success_at, attempt_at)
    if completed is None:
        raise SmokeFailure(f"agent key_label={label}: stream ended without COMPLETE")
    reason = _failure_reason(completed)
    if reason is not None:
        raise SmokeFailure(f"agent key_label={label}: {reason}")
    rendered = json.dumps(
        completed.result,
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )
    _emit(f"agent key_label={label} status={completed.status.value}", secrets)
    _emit(f"result={_short(rendered, secrets)}", secrets)


async def _run(settings: Settings, secrets: tuple[str, ...], used: _UsedKeys) -> None:
    if not settings.tinyfish_api_keys:
        raise SmokeFailure("no TinyFish API keys are configured")
    pool = KeyPool(settings.tinyfish_api_keys)
    async with TinyFishClient(
        pool,
        agent_base_url=str(settings.tinyfish_agent_base_url).rstrip("/"),
        total_timeout_seconds=float(settings.max_seconds_per_run),
    ) as client:
        await _search(client, used, secrets)
        await _fetch(client, used, secrets)
        await _stream(client, used, settings, secrets)


def main() -> int:
    _stdio_utf8()
    try:
        settings = _load_settings()
    except FileNotFoundError:
        print("configuration failed: missing .env", file=sys.stderr)
        return 1
    except ValidationError as exc:
        print(f"configuration failed: {_validation_message(exc)}", file=sys.stderr)
        return 1

    secrets = _secret_values(settings)
    used = _configure_logging(secrets)
    try:
        asyncio.run(_run(settings, secrets, used))
    except SmokeFailure as exc:
        _emit(str(exc), secrets, error=True)
        return 1
    except Exception as exc:
        _emit(_explain(exc), secrets, error=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
