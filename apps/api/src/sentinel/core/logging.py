"""JSON logging with redaction of credential-like fields."""

import contextvars
import logging
import re
from collections.abc import Mapping, Sequence

import structlog
from structlog.typing import EventDict, WrappedLogger

_CONFIGURED = False
_REDACTED = "[REDACTED]"
_SENSITIVE_WORDS = frozenset({"authorization", "secret", "secrets"})
request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "request_id",
    default=None,
)


def _is_sensitive(key: object) -> bool:
    """Return whether a mapping key should be removed from logs."""
    words = re.findall(r"[a-z0-9]+", str(key).lower())
    if not words:
        return False
    if _SENSITIVE_WORDS.intersection(words):
        return True
    return "apikey" in "".join(words)


def _redact(value: object) -> object:
    if isinstance(value, Mapping):
        redacted: dict[str, object] = {}
        for key, item in value.items():
            if _is_sensitive(key):
                redacted[str(key)] = _REDACTED
            else:
                redacted[str(key)] = _redact(item)
        return redacted
    if isinstance(value, tuple):
        return tuple(_redact(item) for item in value)
    if isinstance(value, Sequence) and not isinstance(value, str | bytes):
        return [_redact(item) for item in value]
    return value


def redact_sensitive(
    _logger: WrappedLogger,
    _method_name: str,
    event_dict: EventDict,
) -> EventDict:
    """Replace values whose keys look like credentials."""
    for key in list(event_dict):
        if _is_sensitive(key):
            event_dict[key] = _REDACTED
        else:
            event_dict[key] = _redact(event_dict[key])
    return event_dict


def configure_logging() -> None:
    """Configure structlog JSON rendering once per process."""
    global _CONFIGURED
    if _CONFIGURED:
        return

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            redact_sensitive,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=False,
    )
    _CONFIGURED = True
