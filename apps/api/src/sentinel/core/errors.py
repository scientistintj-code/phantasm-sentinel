"""Typed domain errors raised by the sentinel service."""

from typing import ClassVar


class SentinelError(Exception):
    """Base class for sentinel domain failures."""

    code: ClassVar[str] = "sentinel_error"
    status_code: ClassVar[int] = 500
    title: ClassVar[str] = "Sentinel error"

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class InvalidTargetError(SentinelError):
    """The caller supplied a URL that sentinel will not fetch."""

    code: ClassVar[str] = "invalid_target"
    status_code: ClassVar[int] = 400
    title: ClassVar[str] = "Invalid target"

    def __init__(self, message: str, *, reason: str) -> None:
        self.reason = reason
        super().__init__(message)


class KeyPoolExhaustedError(SentinelError):
    """Every configured TinyFish API key is unavailable."""

    code: ClassVar[str] = "key_pool_exhausted"
    status_code: ClassVar[int] = 503
    title: ClassVar[str] = "Key pool exhausted"


class KeyLeaseError(SentinelError):
    """A key lease was used after it was released."""

    code: ClassVar[str] = "key_lease_closed"
    status_code: ClassVar[int] = 500
    title: ClassVar[str] = "Key lease closed"


class TinyFishError(SentinelError):
    """A TinyFish API call failed."""

    code: ClassVar[str] = "tinyfish_error"
    status_code: ClassVar[int] = 502
    title: ClassVar[str] = "TinyFish request failed"


class TinyFishRunInterruptedError(TinyFishError):
    """The stream failed after STARTED. Poll the run instead of starting another."""

    code: ClassVar[str] = "tinyfish_run_interrupted"
    status_code: ClassVar[int] = 502
    title: ClassVar[str] = "TinyFish run interrupted"

    def __init__(self, message: str, *, run_id: str) -> None:
        self.run_id = run_id
        super().__init__(message)


class TinyFishDeadlineError(TinyFishError):
    """The client deadline elapsed. A known run is cancelled before this is raised."""

    code: ClassVar[str] = "tinyfish_deadline"
    status_code: ClassVar[int] = 504
    title: ClassVar[str] = "TinyFish deadline exceeded"

    def __init__(self, message: str, *, run_id: str | None) -> None:
        self.run_id = run_id
        super().__init__(message)


class EvidenceIntegrityError(SentinelError):
    """Stored evidence failed an integrity check."""

    code: ClassVar[str] = "evidence_integrity"
    status_code: ClassVar[int] = 500
    title: ClassVar[str] = "Evidence integrity failure"
