"""Pydantic models for TinyFish Agent, Search, and Fetch boundaries.

Field names follow docs/TINYFISH_FACTS.md. Undocumented extra fields are ignored
so a new SSE property does not fail a run.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

_FROZEN = ConfigDict(frozen=True, extra="ignore")


class RunStatus(StrEnum):
    """Run lifecycle status from the Runs reference."""

    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class ErrorCategory(StrEnum):
    """Documented category on a run error object."""

    SYSTEM_FAILURE = "SYSTEM_FAILURE"
    AGENT_FAILURE = "AGENT_FAILURE"
    BILLING_FAILURE = "BILLING_FAILURE"
    UNKNOWN = "UNKNOWN"


class RunError(BaseModel):
    """Error object carried on a run, a COMPLETE event, or an async accept."""

    model_config = _FROZEN

    code: str | None = None
    message: str | None = None
    category: ErrorCategory | None = None
    retry_after: float | None = None
    help_url: str | None = None
    help_message: str | None = None


class ApiErrorBody(BaseModel):
    """`error` object on a non-2xx TinyFish response. `details` shape varies."""

    model_config = _FROZEN

    code: str | None = None
    message: str | None = None
    details: Any | None = None


class ApiErrorEnvelope(BaseModel):
    """API-level error body. `request_id` echoes `X-Request-ID` when present."""

    model_config = _FROZEN

    error: ApiErrorBody | None = None
    request_id: str | None = None


class AgentConfig(BaseModel):
    """Optional step and wall-clock caps. Both fields are omitted when unset."""

    model_config = _FROZEN

    max_steps: int | None = Field(default=None, ge=1, le=500)
    max_duration_seconds: int | None = Field(default=None, gt=0)


class CaptureConfig(BaseModel):
    """Opt-in run artifacts.

    `html` is documented as boolean `true`.
    VERIFY: types of screenshots, recording, snapshots, and elements are not
    documented. The CLI exposes them as boolean flags, so these fields are bools.
    """

    model_config = _FROZEN

    html: bool | None = None
    screenshots: bool | None = None
    recording: bool | None = None
    snapshots: bool | None = None
    elements: bool | None = None


class AgentRunRequest(BaseModel):
    """Body shared by `/run`, `/run-async`, and `/run-sse` for the fields sentinel sends."""

    model_config = _FROZEN

    url: str = Field(min_length=1)
    goal: str = Field(min_length=1)
    agent_config: AgentConfig | None = None
    capture_config: CaptureConfig | None = None
    use_profile: bool | None = None
    profile_id: str | None = None
    output_schema: dict[str, Any] | None = None

    @model_validator(mode="after")
    def profile_reference_is_explicit(self) -> AgentRunRequest:
        """`profile_id` selects a Browser Context Profile only with `use_profile`."""
        if self.profile_id is not None and self.use_profile is not True:
            raise ValueError("profile_id requires use_profile true")
        return self

    def to_body(self) -> dict[str, Any]:
        """JSON object with empty optional configs removed."""
        body = self.model_dump(mode="json", exclude_none=True)
        if body.get("agent_config") == {}:
            body.pop("agent_config")
        if body.get("capture_config") == {}:
            body.pop("capture_config")
        return body


class StartedEvent(BaseModel):
    """SSE `STARTED`. `timestamp` is optional.

    VERIFY: the reference table lists `timestamp`. The success sample omits it.
    """

    model_config = _FROZEN

    type: Literal["STARTED"]
    run_id: str
    timestamp: str | None = None


class StreamingUrlEvent(BaseModel):
    """SSE `STREAMING_URL`. The live browser URL is valid for 24 hours."""

    model_config = _FROZEN

    type: Literal["STREAMING_URL"]
    run_id: str
    streaming_url: str
    timestamp: str | None = None


class ProgressEvent(BaseModel):
    """SSE `PROGRESS`. Documented fields are `purpose` and `timestamp` plus `run_id`."""

    model_config = _FROZEN

    type: Literal["PROGRESS"]
    run_id: str
    purpose: str
    timestamp: str | None = None


class HeartbeatEvent(BaseModel):
    """SSE `HEARTBEAT` keep-alive. The reference table has no `run_id`."""

    model_config = _FROZEN

    type: Literal["HEARTBEAT"]
    timestamp: str | None = None


class CompleteEvent(BaseModel):
    """SSE `COMPLETE`. `result` is a JSON object when the agent returns one."""

    model_config = _FROZEN

    type: Literal["COMPLETE"]
    run_id: str
    status: RunStatus
    result: dict[str, Any] | None = None
    error: RunError | None = None
    timestamp: str | None = None


AgentEvent = Annotated[
    StartedEvent | StreamingUrlEvent | ProgressEvent | HeartbeatEvent | CompleteEvent,
    Field(discriminator="type"),
]


class AsyncRunAccepted(BaseModel):
    """Immediate `/run-async` response."""

    model_config = _FROZEN

    run_id: str | None = None
    error: RunError | None = None


class BrowserConfig(BaseModel):
    """Proxy settings echoed on a run. Only the documented keys are modeled."""

    model_config = _FROZEN

    proxy_enabled: bool | None = None
    proxy_country_code: str | None = None


class RunStep(BaseModel):
    """One recorded step. A formal schema beyond the example is not documented.

    VERIFY: `screenshot` and `html` are URLs or null in the runs examples. The
    field type is not a formal schema, so the values stay untyped.
    """

    model_config = _FROZEN

    id: str | None = None
    timestamp: str | None = None
    status: str | None = None
    action: str | None = None
    screenshot: Any | None = None
    html: Any | None = None
    duration: float | None = None


class RunRecord(BaseModel):
    """`GET /v1/runs/{id}` payload."""

    model_config = _FROZEN

    run_id: str
    status: RunStatus
    goal: str
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    num_of_steps: int | None = None
    result: dict[str, Any] | None = None
    error: RunError | None = None
    profile_attached: bool | None = None
    profile_id: str | None = None
    streaming_url: str | None = None
    browser_config: BrowserConfig | None = None
    video_url: str | None = None
    output_schema: dict[str, Any] | None = None
    steps: list[RunStep] = Field(default_factory=list)


class CancelRunResponse(BaseModel):
    """`POST /v1/runs/{id}/cancel` payload."""

    model_config = _FROZEN

    run_id: str
    status: Literal["CANCELLED", "COMPLETED", "FAILED"]
    cancelled_at: str | None = None
    message: str | None = None


class SearchResult(BaseModel):
    """One ranked search hit. News and academic fields are optional."""

    model_config = _FROZEN

    position: int
    site_name: str
    title: str
    snippet: str
    url: str
    date: str | None = None
    publisher: str | None = None
    authors: list[str] | None = None
    venue: str | None = None
    year: int | None = None
    cited_by_count: int | None = None
    pdf_url: str | None = None


class SearchResponse(BaseModel):
    """`GET https://api.search.tinyfish.ai` payload."""

    model_config = _FROZEN

    query: str
    results: list[SearchResult]
    total_results: int
    page: int


class FetchHighlight(BaseModel):
    """One highlight snippet. `rank` starts at 1."""

    model_config = _FROZEN

    text: str
    rank: int


class FetchResult(BaseModel):
    """One fetched URL. `text` is markdown, HTML, or a JSON tree."""

    model_config = _FROZEN

    url: str
    final_url: str | None = None
    title: str | None = None
    description: str | None = None
    language: str | None = None
    author: str | None = None
    published_date: str | None = None
    text: str | dict[str, Any] | None = None
    links: list[str] | None = None
    image_links: list[str] | None = None
    iframe_links: list[str] | None = None
    not_modified: bool | None = None
    etag: str | None = None
    last_modified: str | None = None
    unmatched_selectors: list[str] | None = None
    highlights: list[FetchHighlight] | None = None
    latency_ms: float | None = None
    format: str | None = None


class FetchUrlError(BaseModel):
    """Per-URL failure returned on HTTP 200 inside `errors`."""

    model_config = _FROZEN

    url: str
    error: str
    status: int | None = None
    unmatched_selectors: list[str] | None = None
    candidate_selectors: list[str] | None = None


class FetchResponse(BaseModel):
    """`POST https://api.fetch.tinyfish.ai` payload."""

    model_config = _FROZEN

    results: list[FetchResult]
    errors: list[FetchUrlError] = Field(default_factory=list)
