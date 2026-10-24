"""TinyFish client streaming, key pinning, and log redaction."""

import asyncio
import json
from collections.abc import AsyncIterator

import httpx
import pytest
import respx
from pydantic import SecretStr, ValidationError

from sentinel.core.errors import TinyFishDeadlineError, TinyFishRunInterruptedError
from sentinel.core.logging import configure_logging
from sentinel.tinyfish import (
    AgentRunRequest,
    CompleteEvent,
    HeartbeatEvent,
    KeyPool,
    KeyState,
    ProgressEvent,
    StartedEvent,
    StreamingUrlEvent,
    TinyFishClient,
)
from sentinel.tinyfish.models import AgentConfig, CaptureConfig

_SECRET_A = "sk-live-DoNotLeakAlpha7f3a2c"
_SECRET_B = "sk-live-DoNotLeakBeta8e4b1d"
_PAGE = "FULL-PAGE-BODY-do-not-log-99"
_UNKNOWN = "LEAKED-UNKNOWN-BODY"
_AGENT = "https://agent.tinyfish.ai"
_SSE = f"{_AGENT}/v1/automation/run-sse"
_FETCH = "https://api.fetch.tinyfish.ai"


class ScriptedStream(httpx.AsyncByteStream):
    """Yield scripted chunks, optionally disconnecting or hanging."""

    def __init__(
        self,
        chunks: list[bytes],
        *,
        disconnect_after: int | None = None,
        hang_after: int | None = None,
    ) -> None:
        self._chunks = chunks
        self._disconnect_after = disconnect_after
        self._hang_after = hang_after

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for index, chunk in enumerate(self._chunks):
            if self._hang_after is not None and index >= self._hang_after:
                await asyncio.sleep(5)
            yield chunk
            if self._disconnect_after is not None and index + 1 >= self._disconnect_after:
                raise httpx.RemoteProtocolError("disconnected")

    async def aclose(self) -> None:
        return None


def _pool(*secrets: str) -> KeyPool:
    return KeyPool(tuple(SecretStr(secret) for secret in secrets), concurrency_per_key=2)


def _frame(payload: dict[str, object]) -> bytes:
    encoded = json.dumps(payload, separators=(",", ":"))
    return f"data: {encoded}\n\n".encode()


def _sse(
    chunks: list[bytes],
    *,
    disconnect_after: int | None = None,
    hang_after: int | None = None,
) -> httpx.Response:
    return httpx.Response(
        200,
        headers={"content-type": "text/event-stream"},
        stream=ScriptedStream(
            chunks,
            disconnect_after=disconnect_after,
            hang_after=hang_after,
        ),
    )


def _started() -> dict[str, object]:
    return {"type": "STARTED", "run_id": "run_123"}


def _complete(result: dict[str, object] | None = None) -> dict[str, object]:
    payload: dict[str, object] = {
        "type": "COMPLETE",
        "run_id": "run_123",
        "status": "COMPLETED",
        "timestamp": "2025-01-01T00:00:04Z",
        "run_url": "https://agent.tinyfish.ai/runs/run_123",
    }
    if result is not None:
        payload["result"] = result
    return payload


@pytest.fixture
def public_url(monkeypatch: pytest.MonkeyPatch) -> None:
    """Skip DNS. Client tests assert request bytes, not name resolution."""
    monkeypatch.setattr("sentinel.tinyfish.client.validate_target_url", lambda url: url)


def test_profile_id_requires_use_profile() -> None:
    with pytest.raises(ValidationError):
        AgentRunRequest(
            url="https://example.com/shop",
            goal="Extract the first product",
            profile_id="prof_abc",
        )


@pytest.mark.asyncio
async def test_stream_agent_parses_documented_events(public_url: None) -> None:
    frames = [
        _frame(_started()),
        _frame(
            {
                "type": "STREAMING_URL",
                "run_id": "run_123",
                "streaming_url": "https://stream.example/live",
                "timestamp": "2025-01-01T00:00:01Z",
            }
        ),
        _frame(
            {
                "type": "PROGRESS",
                "run_id": "run_123",
                "purpose": "Clicking submit button",
                "timestamp": "2025-01-01T00:00:02Z",
            }
        ),
        _frame({"type": "HEARTBEAT", "timestamp": "2025-01-01T00:00:03Z"}),
        _frame(_complete({"products": [{"name": "Bulbasaur"}]})),
    ]
    request = AgentRunRequest(
        url="https://example.com/shop",
        goal="Extract the first product",
        agent_config=AgentConfig(max_steps=40, max_duration_seconds=240),
        capture_config=CaptureConfig(html=True),
        use_profile=True,
        profile_id="prof_abc",
        output_schema={"type": "object", "properties": {"name": {"type": "string"}}},
    )

    async with respx.mock() as router:
        route = router.post(_SSE).mock(side_effect=lambda request: _sse(frames))
        async with TinyFishClient(_pool(_SECRET_A)) as client:
            events = [event async for event in client.stream_agent(request)]

    assert [type(event) for event in events] == [
        StartedEvent,
        StreamingUrlEvent,
        ProgressEvent,
        HeartbeatEvent,
        CompleteEvent,
    ]
    started = events[0]
    assert isinstance(started, StartedEvent)
    assert started.run_id == "run_123"
    assert started.timestamp is None
    progress = events[2]
    assert isinstance(progress, ProgressEvent)
    assert progress.purpose == "Clicking submit button"
    complete = events[4]
    assert isinstance(complete, CompleteEvent)
    assert complete.result == {"products": [{"name": "Bulbasaur"}]}
    sent = json.loads(route.calls[0].request.content)
    assert sent == {
        "url": "https://example.com/shop",
        "goal": "Extract the first product",
        "agent_config": {"max_steps": 40, "max_duration_seconds": 240},
        "capture_config": {"html": True},
        "use_profile": True,
        "profile_id": "prof_abc",
        "output_schema": {"type": "object", "properties": {"name": {"type": "string"}}},
    }
    assert "browser_profile" not in sent


@pytest.mark.asyncio
async def test_sse_frames_split_across_chunks(public_url: None) -> None:
    raw = _frame(_started()) + _frame({"type": "HEARTBEAT"})
    separator = raw.index(b"\n\n")
    chunks = [raw[:8], raw[8 : separator + 1], raw[separator + 1 :]]

    async with respx.mock() as router:
        router.post(_SSE).mock(side_effect=lambda request: _sse(chunks))
        async with TinyFishClient(_pool(_SECRET_A)) as client:
            events = [
                event
                async for event in client.stream_agent(
                    AgentRunRequest(url="https://example.com/shop", goal="Extract the title")
                )
            ]

    assert [type(event) for event in events] == [StartedEvent, HeartbeatEvent]
    assert isinstance(events[0], StartedEvent)
    assert events[0].run_id == "run_123"


@pytest.mark.asyncio
async def test_unknown_event_is_skipped_and_not_logged_in_full(
    public_url: None,
    capsys: pytest.CaptureFixture[str],
) -> None:
    configure_logging()
    unknown = f'data: {{"type":"TOOL_CALL","page":"{_UNKNOWN}"}}\n\n'.encode()
    chunks = [_frame(_started()), unknown, _frame(_complete())]

    async with respx.mock() as router:
        router.post(_SSE).mock(side_effect=lambda request: _sse(chunks))
        async with TinyFishClient(_pool(_SECRET_A)) as client:
            events = [
                event
                async for event in client.stream_agent(
                    AgentRunRequest(url="https://example.com/shop", goal="Extract the title")
                )
            ]

    captured = capsys.readouterr()
    assert [type(event) for event in events] == [StartedEvent, CompleteEvent]
    logged = [
        json.loads(line) for line in captured.out.splitlines() if "tinyfish_unknown_event" in line
    ]
    assert len(logged) == 1
    assert logged[0]["event_type"] == "TOOL_CALL"
    assert _UNKNOWN not in captured.out
    assert _SECRET_A not in captured.out


@pytest.mark.asyncio
async def test_disconnect_after_started_is_not_retried(public_url: None) -> None:
    chunks = [_frame(_started()), _frame({"type": "HEARTBEAT"})]

    async with respx.mock() as router:
        route = router.post(_SSE).mock(side_effect=lambda request: _sse(chunks, disconnect_after=1))
        async with TinyFishClient(_pool(_SECRET_A)) as client:
            with pytest.raises(TinyFishRunInterruptedError) as caught:
                async for _event in client.stream_agent(
                    AgentRunRequest(url="https://example.com/shop", goal="Extract the title")
                ):
                    pass

    assert route.call_count == 1
    assert caught.value.run_id == "run_123"
    sent = json.loads(route.calls[0].request.content)
    assert sent == {"url": "https://example.com/shop", "goal": "Extract the title"}


@pytest.mark.asyncio
async def test_rate_limit_rotates_to_the_next_key(public_url: None) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        if request.headers["X-API-Key"] == _SECRET_A:
            return httpx.Response(
                429,
                headers={"Retry-After": "30"},
                json={"error": {"code": "RATE_LIMIT_EXCEEDED", "message": "slow down"}},
            )
        return _sse([_frame(_started()), _frame(_complete())])

    async with respx.mock() as router:
        route = router.post(_SSE).mock(side_effect=respond)
        pool = _pool(_SECRET_A, _SECRET_B)
        async with TinyFishClient(pool) as client:
            events = [
                event
                async for event in client.stream_agent(
                    AgentRunRequest(url="https://example.com/shop", goal="Extract the title")
                )
            ]
        rows = await pool.snapshot()

    assert isinstance(events[-1], CompleteEvent)
    assert route.call_count == 2
    assert route.calls[0].request.headers["X-API-Key"] == _SECRET_A
    assert route.calls[1].request.headers["X-API-Key"] == _SECRET_B
    assert rows[0].state is KeyState.COOLING_DOWN
    assert rows[1].state is KeyState.HEALTHY


@pytest.mark.asyncio
async def test_deadline_cancels_the_run_with_the_same_key(public_url: None) -> None:
    chunks = [_frame(_started()), b" "]

    async with respx.mock() as router:
        opened = router.post(_SSE).mock(side_effect=lambda request: _sse(chunks, hang_after=1))
        cancel = router.post(f"{_AGENT}/v1/runs/run_123/cancel").mock(
            return_value=httpx.Response(
                200,
                json={
                    "run_id": "run_123",
                    "status": "CANCELLED",
                    "cancelled_at": "2025-01-01T00:00:05Z",
                    "message": None,
                },
            )
        )
        async with TinyFishClient(_pool(_SECRET_A), total_timeout_seconds=0.5) as client:
            with pytest.raises(TinyFishDeadlineError) as caught:
                async for _event in client.stream_agent(
                    AgentRunRequest(url="https://example.com/shop", goal="Extract the title")
                ):
                    pass

    assert caught.value.run_id == "run_123"
    assert opened.call_count == 1
    assert cancel.call_count == 1
    assert opened.calls[0].request.headers["X-API-Key"] == _SECRET_A
    assert cancel.calls[0].request.headers["X-API-Key"] == _SECRET_A


@pytest.mark.asyncio
async def test_logs_omit_keys_headers_and_page_bodies(
    public_url: None,
    capsys: pytest.CaptureFixture[str],
) -> None:
    configure_logging()

    async with respx.mock() as router:
        frames = [_frame(_started()), _frame(_complete({"page": _PAGE}))]
        router.post(_SSE).mock(side_effect=lambda request: _sse(frames))
        fetch = router.post(_FETCH).mock(
            return_value=httpx.Response(
                200,
                json={
                    "results": [{"url": "https://example.com/shop", "text": _PAGE}],
                    "errors": [],
                },
            )
        )
        async with TinyFishClient(_pool(_SECRET_A)) as client:
            events = [
                event
                async for event in client.stream_agent(
                    AgentRunRequest(url="https://example.com/shop", goal="Extract the title")
                )
            ]
            fetched = await client.fetch("https://example.com/shop")

    captured = capsys.readouterr()
    blob = captured.out + captured.err
    assert fetch.called
    assert fetch.calls[0].request.url.host == "api.fetch.tinyfish.ai"
    assert isinstance(events[-1], CompleteEvent)
    assert fetched.results[0].text == _PAGE
    assert "run_123" in blob
    assert "event_type" in blob
    assert _SECRET_A not in blob
    assert _PAGE not in blob
    assert "X-API-Key" not in blob


@pytest.mark.asyncio
async def test_get_run_uses_the_key_that_queued_the_run(public_url: None) -> None:
    record = {
        "run_id": "run_123",
        "status": "COMPLETED",
        "goal": "Extract the first product",
        "created_at": "2025-01-01T00:00:00Z",
        "steps": [],
    }

    async with respx.mock() as router:
        queued = router.post(f"{_AGENT}/v1/automation/run-async").mock(
            return_value=httpx.Response(200, json={"run_id": "run_123", "error": None})
        )
        fetched = router.get(f"{_AGENT}/v1/runs/run_123").mock(
            return_value=httpx.Response(200, json=record)
        )
        async with TinyFishClient(_pool(_SECRET_A, _SECRET_B)) as client:
            run_id = await client.queue_agent(
                AgentRunRequest(url="https://example.com/shop", goal="Extract the first product")
            )
            loaded = await client.get_run(run_id)

    assert run_id == "run_123"
    assert loaded.status.value == "COMPLETED"
    assert queued.calls[0].request.headers["X-API-Key"] == _SECRET_A
    assert fetched.calls[0].request.headers["X-API-Key"] == _SECRET_A


@pytest.mark.asyncio
async def test_search_stays_on_the_search_host(public_url: None) -> None:
    async with respx.mock() as router:
        search = router.get("https://api.search.tinyfish.ai").mock(
            return_value=httpx.Response(
                200,
                json={
                    "query": "widgets",
                    "results": [
                        {
                            "position": 1,
                            "site_name": "Example",
                            "title": "Widgets",
                            "snippet": "A widget",
                            "url": "https://example.com/widgets",
                        }
                    ],
                    "total_results": 1,
                    "page": 0,
                },
            )
        )
        async with TinyFishClient(_pool(_SECRET_A)) as client:
            found = await client.search("widgets")

    assert search.calls[0].request.url.host == "api.search.tinyfish.ai"
    assert search.calls[0].request.url.params["query"] == "widgets"
    assert found.results[0].title == "Widgets"
