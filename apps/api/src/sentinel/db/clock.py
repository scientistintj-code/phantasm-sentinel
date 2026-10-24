"""UTC timestamps in the API contract format."""

from datetime import UTC, datetime


def utc_timestamp(moment: datetime | None = None) -> str:
    """Return an ISO-8601 UTC timestamp with millisecond precision."""
    current = (datetime.now(UTC) if moment is None else moment).astimezone(UTC)
    millis = current.microsecond // 1000
    return current.strftime("%Y-%m-%dT%H:%M:%S.") + f"{millis:03d}Z"
