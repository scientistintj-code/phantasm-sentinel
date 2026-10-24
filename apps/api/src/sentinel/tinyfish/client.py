"""HTTP client for TinyFish Agent, Search, and Fetch.

Search and Fetch stay on their own hosts. They never open an Agent run.
"""

from __future__ import annotations

import asyncio
import codecs
import json
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, NoReturn, TypeVar
from urllib.parse import quote

import httpx
import structlog
from pydantic import BaseModel, TypeAdapter, ValidationError
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

from sentinel.core.errors import (
    TinyFishDeadlineError,
    TinyFishError,
    TinyFishRunInterruptedError,
)
from sentinel.core.security import validate_target_url
from sentinel.tinyfish.key_pool import KeyLease, KeyPool
from sentinel.tinyfish.models import (
    AgentEvent,
    AgentRunRequest,
    ApiErrorEnvelope,
    AsyncRunAccepted,
    CancelRunResponse,
    CompleteEvent,
    FetchResponse,
    HeartbeatEvent,
    RunRecord,
    SearchResponse,
    StartedEvent,
)

log = structlog.get_logger(__name__)

# VERIFY: the heartbeat interval is not documented. This is the maximum gap
# between SSE chunks, so a HEARTBEAT resets the read timeout.
_DEFAULT_READ_TIMEOUT_SECONDS = 60.0
# VERIFY: automation pending-run 429 omits Retry-After. Search and Fetch send
# the header. 60 seconds is the local fallback when it is missing or not a number.
_MISSING_RETRY_AFTER_SECONDS = 60.0
_AUTH_INVALID = frozenset({"MISSING_API_KEY", "INVALID_API_KEY", "UNAUTHORIZED"})
_KNOWN_EVENTS = frozenset({"STARTED", "STREAMING_URL", "PROGRESS", "HEARTBEAT", "COMPLETE"})
_EVENT_ADAPTER: TypeAdapter[AgentEvent] = TypeAdapter(AgentEvent)
_NETWORK_ERRORS = (
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.PoolTimeout,
    httpx.ReadError,
    httpx.WriteError,
    httpx.CloseError,
    httpx.RemoteProtocolError,
)
_T = TypeVar("_T")
_ModelT = TypeVar("_ModelT", bound=BaseModel)


class _KeyAction(StrEnum):
    """Pool outcome chosen from a TinyFish error response."""

    RATE_LIMITED = "rate_limited"
    EXHAUSTED = "exhausted"
    INVALID = "invalid"


class _RetryableTransport(Exception):
    """Connection failure or HTTP 5xx before STARTED. Tenacity retries the same key."""


class _RotateKey(Exception):
    """The leased key should be marked and the call tried with another key."""

    def __init__(self, action: _KeyAction, retry_after_seconds: float | None = None) -> None:
        self.action = action
        self.retry_after_seconds = retry_after_seconds
        super().__init__(action.value)


class _SseParser:
    """Reassemble `data:` frames that arrive split across TCP chunks."""

    def __init__(self) -> None:
        self._decoder = codecs.getincrementaldecoder("utf-8")()
        self._buffer = ""
        self._data: list[str] = []
        self._ready: list[AgentEvent] = []

    def feed(self, chunk: bytes) -> list[AgentEvent]:
        """Parse complete events from the next bytes. Unknown types are skipped."""
        self._buffer += self._decode(chunk, final=False)
        return self._drain()

    def finish(self) -> list[AgentEvent]:
        """Flush a final event that arrived without a trailing blank line."""
        self._buffer += self._decode(b"", final=True)
        if self._buffer != "":
            self._consume_line(self._buffer.removesuffix("\r"))
            self._buffer = ""
        event = self._dispatch()
        if event is not None:
            self._ready.append(event)
        return self._take_ready()

    def _drain(self) -> list[AgentEvent]:
        while True:
            line, rest = _next_line(self._buffer)
            if line is None:
                break
            self._buffer = rest
            event = self._consume_line(line)
            if event is not None:
                self._ready.append(event)
        return self._take_ready()

    def _take_ready(self) -> list[AgentEvent]:
        ready = self._ready
        self._ready = []
        return ready

    def _consume_line(self, line: str) -> AgentEvent | None:
        if line == "":
            return self._dispatch()
        if line.startswith(":"):
            return None
        field, separator, value = line.partition(":")
        if separator != ":":
            return None
        if value.startswith(" "):
            value = value[1:]
        if field == "data":
            self._data.append(value)
        return None

    def _dispatch(self) -> AgentEvent | None:
        if not self._data:
            return None
        payload = "\n".join(self._data)
        self._data = []
        return _parse_event_payload(payload)

    def _decode(self, chunk: bytes, *, final: bool) -> str:
        try:
            return self._decoder.decode(chunk, final)
        except UnicodeDecodeError as exc:
            raise TinyFishError("TinyFish event stream was not valid text") from exc


def _next_line(buffer: str) -> tuple[str | None, str]:
    """Split one SSE line, keeping a trailing CR until the next chunk arrives."""
    for index, char in enumerate(buffer):
        if char == "\n":
            line = buffer[:index]
            if line.endswith("\r"):
                line = line[:-1]
            return line, buffer[index + 1 :]
        if char == "\r":
            if index + 1 >= len(buffer):
                return None, buffer
            if buffer[index + 1] == "\n":
                return buffer[:index], buffer[index + 2 :]
            return buffer[:index], buffer[index + 1 :]
    return None, buffer


def _parse_event_payload(payload: str) -> AgentEvent | None:
    if payload == "":
        return None
    try:
        data: object = json.loads(payload)
    except json.JSONDecodeError:
        log.warning("tinyfish_unknown_event", event_type=None)
        return None
    if not isinstance(data, dict):
        log.warning("tinyfish_unknown_event", event_type=None)
        return None
    event_type = data.get("type")
    if not isinstance(event_type, str) or event_type not in _KNOWN_EVENTS:
        logged = event_type[:80] if isinstance(event_type, str) else None
        log.warning("tinyfish_unknown_event", event_type=logged)
        return None
    try:
        return _EVENT_ADAPTER.validate_python(data)
    except ValidationError as exc:
        raise TinyFishError("TinyFish sent a malformed event") from exc


def _parse_model(model: type[_ModelT], payload: bytes) -> _ModelT:
    try:
        return model.model_validate_json(payload)
    except ValidationError as exc:
        raise TinyFishError("TinyFish response was malformed") from exc


def _retry_after_seconds(raw: str | None) -> float:
    if raw is None:
        return _MISSING_RETRY_AFTER_SECONDS
    try:
        seconds = float(raw)
    except ValueError:
        return _MISSING_RETRY_AFTER_SECONDS
    if seconds < 0:
        return 0.0
    return seconds


def _api_key_header(lease: KeyLease) -> dict[str, str]:
    return {"X-API-Key": lease.api_key.get_secret_value()}


def _duration_ms(started: float) -> float:
    return round((time.monotonic() - started) * 1000, 1)


def _event_run_id(event: AgentEvent) -> str | None:
    if isinstance(event, HeartbeatEvent):
        return None
    return event.run_id


def _started_id(events: list[AgentEvent]) -> str | None:
    for event in events:
        if isinstance(event, StartedEvent):
            return event.run_id
    return None


def _is_billing_rejected(error_code: str | None) -> bool:
    return error_code == "BILLING_REJECTED"


@dataclass
class _LiveStream:
    """An SSE response kept open after STARTED, plus events already parsed."""

    response: httpx.Response | None
    parser: _SseParser
    prelude: list[AgentEvent]
    byte_stream: AsyncIterator[bytes] | None
    finished: bool


class TinyFishClient:
    """Calls TinyFish with a leased key and closes that lease when the call ends."""

    def __init__(
        self,
        pool: KeyPool,
        *,
        http_client: httpx.AsyncClient | None = None,
        agent_base_url: str = "https://agent.tinyfish.ai",
        search_base_url: str = "https://api.search.tinyfish.ai",
        fetch_base_url: str = "https://api.fetch.tinyfish.ai",
        connect_timeout_seconds: float = 10.0,
        read_timeout_seconds: float = _DEFAULT_READ_TIMEOUT_SECONDS,
        total_timeout_seconds: float = 240.0,
        max_attempts: int = 3,
    ) -> None:
        if connect_timeout_seconds <= 0 or read_timeout_seconds <= 0 or total_timeout_seconds <= 0:
            raise ValueError("timeouts must be positive")
        if max_attempts < 1:
            raise ValueError("max_attempts must be >= 1")
        self._pool = pool
        self._agent_base_url = agent_base_url.rstrip("/")
        self._search_base_url = search_base_url.rstrip("/")
        self._fetch_base_url = fetch_base_url.rstrip("/")
        self._total_timeout_seconds = total_timeout_seconds
        self._max_attempts = max_attempts
        self._timeout = httpx.Timeout(
            connect=connect_timeout_seconds,
            read=read_timeout_seconds,
            write=connect_timeout_seconds,
            pool=connect_timeout_seconds,
        )
        self._client = (
            http_client if http_client is not None else httpx.AsyncClient(trust_env=False)
        )
        self._owns_client = http_client is None
        self._pins: dict[str, str] = {}

    async def __aenter__(self) -> TinyFishClient:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: object,
    ) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        """Close the HTTP client when this object created it."""
        if self._owns_client:
            await self._client.aclose()

    async def stream_agent(self, request: AgentRunRequest) -> AsyncIterator[AgentEvent]:
        """POST `/v1/automation/run-sse` and yield each documented event.

        The lease is released when the generator finishes, raises, or is closed.
        A failure after STARTED includes `run_id` and is not retried.
        """
        payload = await self._agent_payload(request)
        deadline = time.monotonic() + self._total_timeout_seconds
        started = time.monotonic()
        while True:
            if time.monotonic() >= deadline:
                raise TinyFishDeadlineError("TinyFish run exceeded the deadline", run_id=None)
            lease = await self._pool.acquire()
            run_id: str | None = None
            billed = False
            try:
                async for event in self._events(lease, payload, deadline):
                    if isinstance(event, StartedEvent):
                        run_id = event.run_id
                        self._pins[run_id] = lease.label
                    log.info(
                        "tinyfish_event",
                        run_id=_event_run_id(event),
                        key_label=lease.label,
                        event_type=event.type,
                        duration_ms=_duration_ms(started),
                    )
                    yield event
                    if isinstance(event, CompleteEvent) and _is_billing_rejected(
                        None if event.error is None else event.error.code
                    ):
                        await lease.mark_exhausted()
                        billed = True
                if not billed:
                    await lease.mark_success()
                return
            except _RotateKey as rotate:
                if run_id is not None:
                    raise TinyFishRunInterruptedError(
                        "TinyFish rejected the key after the run started",
                        run_id=run_id,
                    ) from rotate
                await self._apply_rotation(lease, rotate)
            except (TinyFishDeadlineError, TinyFishRunInterruptedError):
                raise
            except Exception as exc:
                if run_id is not None:
                    raise TinyFishRunInterruptedError(
                        "TinyFish stream failed after the run started",
                        run_id=run_id,
                    ) from exc
                raise
            finally:
                await lease.release()

    async def queue_agent(self, request: AgentRunRequest) -> str:
        """POST `/v1/automation/run-async` and remember which key owns the run."""
        payload = await self._agent_payload(request)
        url = f"{self._agent_base_url}/v1/automation/run-async"

        async def operation(lease: KeyLease) -> str:
            started = time.monotonic()
            body = await self._read_json(lease, "POST", url, json_body=payload, params=None)
            accepted = _parse_model(AsyncRunAccepted, body)
            error_code = None if accepted.error is None else accepted.error.code
            if _is_billing_rejected(error_code):
                await lease.mark_exhausted()
            if accepted.run_id is None:
                raise TinyFishError("TinyFish did not return a run id")
            self._pins[accepted.run_id] = lease.label
            if not _is_billing_rejected(error_code):
                await lease.mark_success()
            log.info(
                "tinyfish_queued",
                run_id=accepted.run_id,
                key_label=lease.label,
                duration_ms=_duration_ms(started),
            )
            return accepted.run_id

        return await self._with_rotating_key(operation)

    async def get_run(self, run_id: str) -> RunRecord:
        """GET `/v1/runs/{id}` with the key that started the run when we have it."""
        self._require_run_id(run_id)
        lease = await self._lease_for_run(run_id)
        started = time.monotonic()
        try:
            body = await self._read_json(
                lease,
                "GET",
                self._run_url(run_id),
                json_body=None,
                params=None,
            )
            record = _parse_model(RunRecord, body)
            if _is_billing_rejected(None if record.error is None else record.error.code):
                await lease.mark_exhausted()
            else:
                await lease.mark_success()
            log.info(
                "tinyfish_get_run",
                run_id=run_id,
                key_label=lease.label,
                duration_ms=_duration_ms(started),
            )
            return record
        except _RotateKey as rotate:
            await self._apply_rotation(lease, rotate)
            raise TinyFishError("TinyFish rejected the key for this run") from rotate
        finally:
            await lease.release()

    async def cancel_run(self, run_id: str) -> CancelRunResponse:
        """POST `/v1/runs/{id}/cancel` with the key that started the run when we have it."""
        self._require_run_id(run_id)
        lease = await self._lease_for_run(run_id)
        started = time.monotonic()
        try:
            body = await self._read_json(
                lease,
                "POST",
                self._cancel_url(run_id),
                json_body=None,
                params=None,
            )
            cancelled = _parse_model(CancelRunResponse, body)
            await lease.mark_success()
            log.info(
                "tinyfish_cancel",
                run_id=run_id,
                key_label=lease.label,
                duration_ms=_duration_ms(started),
            )
            return cancelled
        except _RotateKey as rotate:
            await self._apply_rotation(lease, rotate)
            raise TinyFishError("TinyFish rejected the key for this run") from rotate
        finally:
            await lease.release()

    async def search(self, query: str) -> SearchResponse:
        """GET the Search API. This does not start an Agent run or spend agent steps."""
        if query == "":
            raise ValueError("query must not be empty")

        async def operation(lease: KeyLease) -> SearchResponse:
            started = time.monotonic()
            body = await self._read_json(
                lease,
                "GET",
                self._search_base_url,
                json_body=None,
                params={"query": query},
            )
            parsed = _parse_model(SearchResponse, body)
            await lease.mark_success()
            log.info(
                "tinyfish_call",
                key_label=lease.label,
                operation="search",
                duration_ms=_duration_ms(started),
            )
            return parsed

        return await self._with_rotating_key(operation)

    async def fetch(self, url: str) -> FetchResponse:
        """POST one URL to the Fetch API. This does not start an Agent run."""
        normalized = await self._normalize_target(url)

        async def operation(lease: KeyLease) -> FetchResponse:
            started = time.monotonic()
            body = await self._read_json(
                lease,
                "POST",
                self._fetch_base_url,
                json_body={"urls": [normalized]},
                params=None,
            )
            parsed = _parse_model(FetchResponse, body)
            await lease.mark_success()
            log.info(
                "tinyfish_call",
                key_label=lease.label,
                operation="fetch",
                duration_ms=_duration_ms(started),
            )
            return parsed

        return await self._with_rotating_key(operation)

    async def _events(
        self,
        lease: KeyLease,
        payload: dict[str, Any],
        deadline: float,
    ) -> AsyncIterator[AgentEvent]:
        try:
            live = await self._open_until_started(lease, payload, deadline)
        except _RetryableTransport as exc:
            raise TinyFishError("TinyFish connection failed") from exc
        except TimeoutError as exc:
            raise TinyFishDeadlineError(
                "TinyFish run exceeded the deadline",
                run_id=None,
            ) from exc
        except httpx.ReadTimeout as exc:
            raise TinyFishError("TinyFish stream stalled") from exc

        run_id = _started_id(live.prelude)
        try:
            for event in live.prelude:
                yield event
            if live.finished or live.byte_stream is None:
                return
            while True:
                chunk = await _pull(live.byte_stream, deadline)
                if chunk is None:
                    break
                for event in live.parser.feed(chunk):
                    yield event
            for event in live.parser.finish():
                yield event
        except TimeoutError as exc:
            if run_id is not None:
                await self._cancel_held(lease, run_id)
            raise TinyFishDeadlineError(
                "TinyFish run exceeded the deadline",
                run_id=run_id,
            ) from exc
        except httpx.ReadTimeout as exc:
            if run_id is not None:
                await self._cancel_held(lease, run_id)
                raise TinyFishRunInterruptedError(
                    "TinyFish stream stalled after the run started",
                    run_id=run_id,
                ) from exc
            raise TinyFishError("TinyFish stream stalled") from exc
        except _NETWORK_ERRORS as exc:
            if run_id is not None:
                raise TinyFishRunInterruptedError(
                    "TinyFish stream failed after the run started",
                    run_id=run_id,
                ) from exc
            raise TinyFishError("TinyFish connection failed") from exc
        finally:
            if live.response is not None:
                await live.response.aclose()

    async def _open_until_started(
        self,
        lease: KeyLease,
        payload: dict[str, Any],
        deadline: float,
    ) -> _LiveStream:
        url = f"{self._agent_base_url}/v1/automation/run-sse"

        async def once() -> _LiveStream:
            response = await self._transmit(
                lease,
                "POST",
                url,
                json_body=payload,
                params=None,
                stream=True,
            )
            parser = _SseParser()
            prelude: list[AgentEvent] = []
            # Pull with anext. Leaving an `async for` would close the byte stream
            # and the events after STARTED could not be read.
            byte_stream = response.aiter_bytes()
            release = True
            try:
                while True:
                    chunk = await _pull(byte_stream, deadline)
                    if chunk is None:
                        break
                    prelude.extend(parser.feed(chunk))
                    if _started_id(prelude) is not None:
                        release = False
                        return _LiveStream(response, parser, prelude, byte_stream, finished=False)
                prelude.extend(parser.finish())
                return _LiveStream(None, parser, prelude, None, finished=True)
            except _NETWORK_ERRORS as exc:
                raise _RetryableTransport() from exc
            finally:
                if release:
                    await response.aclose()

        return await self._retry(once)

    async def _with_rotating_key(self, operation: Callable[[KeyLease], Awaitable[_T]]) -> _T:
        while True:
            lease = await self._pool.acquire()
            try:
                return await operation(lease)
            except _RotateKey as rotate:
                await self._apply_rotation(lease, rotate)
            finally:
                await lease.release()

    async def _read_json(
        self,
        lease: KeyLease,
        method: str,
        url: str,
        *,
        json_body: dict[str, Any] | None,
        params: dict[str, str] | None,
    ) -> bytes:
        async def once() -> bytes:
            response = await self._transmit(
                lease,
                method,
                url,
                json_body=json_body,
                params=params,
                stream=False,
            )
            try:
                return await response.aread()
            finally:
                await response.aclose()

        return await self._retry(once)

    async def _retry(self, operation: Callable[[], Awaitable[_T]]) -> _T:
        held: list[_T] = []
        async for _attempt in AsyncRetrying(
            retry=retry_if_exception_type(_RetryableTransport),
            wait=wait_exponential_jitter(multiplier=0.2, max=2, jitter=0.2),
            stop=stop_after_attempt(self._max_attempts),
            reraise=True,
        ):
            with _attempt:
                held.append(await operation())
        if not held:
            raise TinyFishError("TinyFish connection failed")
        return held[0]

    async def _transmit(
        self,
        lease: KeyLease,
        method: str,
        url: str,
        *,
        json_body: dict[str, Any] | None,
        params: dict[str, str] | None,
        stream: bool,
    ) -> httpx.Response:
        try:
            request = self._client.build_request(
                method,
                url,
                headers=_api_key_header(lease),
                json=json_body,
                params=params,
                timeout=self._timeout,
            )
            response = await self._client.send(
                request,
                stream=stream,
                follow_redirects=False,
            )
        except _NETWORK_ERRORS as exc:
            raise _RetryableTransport() from exc
        if response.status_code >= 300:
            await self._reject(response)
        return response

    async def _reject(self, response: httpx.Response) -> NoReturn:
        status = response.status_code
        retry_after_raw = response.headers.get("Retry-After")
        try:
            body = await response.aread()
        finally:
            await response.aclose()
        if 300 <= status < 400:
            raise TinyFishError(f"TinyFish redirected the request with HTTP {status}")
        error = _api_error(body)
        code = None if error is None else error[0]
        message = None if error is None else error[1]
        if status == 429 or code == "RATE_LIMIT_EXCEEDED":
            raise _RotateKey(_KeyAction.RATE_LIMITED, _retry_after_seconds(retry_after_raw))
        if status == 402:
            # VERIFY: 402 INSUFFICIENT_CREDITS and FREE_ALLOWANCE_EXHAUSTED both
            # stop this key. The pool cannot revive a key at 00:00 UTC.
            raise _RotateKey(_KeyAction.EXHAUSTED)
        if status == 401 and code == "VAULT_RECONNECT_REQUIRED":
            # VERIFY: vault reconnect is a request failure, not an invalid key.
            raise TinyFishError("TinyFish vault reconnect required")
        if status == 401 or code in _AUTH_INVALID:
            raise _RotateKey(_KeyAction.INVALID)
        if status == 403 and message is not None and "insufficient credits" in message.casefold():
            # VERIFY: legacy credit exhaustion is also 403 FORBIDDEN. Other 403
            # responses are entitlement failures and leave the key in rotation.
            raise _RotateKey(_KeyAction.EXHAUSTED)
        if status >= 500:
            raise _RetryableTransport()
        label = code if code is not None else "unknown"
        raise TinyFishError(f"TinyFish request failed with HTTP {status} ({label})")

    async def _apply_rotation(self, lease: KeyLease, rotate: _RotateKey) -> None:
        if rotate.action is _KeyAction.RATE_LIMITED:
            retry_after = 0.0 if rotate.retry_after_seconds is None else rotate.retry_after_seconds
            await lease.mark_rate_limited(retry_after)
            return
        if rotate.action is _KeyAction.EXHAUSTED:
            await lease.mark_exhausted()
            return
        await lease.mark_invalid()

    async def _cancel_held(self, lease: KeyLease, run_id: str) -> None:
        started = time.monotonic()
        try:
            response = await self._client.post(
                self._cancel_url(run_id),
                headers=_api_key_header(lease),
                follow_redirects=False,
                timeout=httpx.Timeout(5.0),
            )
            status_code = response.status_code
            await response.aclose()
        except httpx.HTTPError:
            log.warning("tinyfish_cancel_failed", run_id=run_id, key_label=lease.label)
            return
        log.info(
            "tinyfish_cancel",
            run_id=run_id,
            key_label=lease.label,
            duration_ms=_duration_ms(started),
            status_code=status_code,
        )

    async def _lease_for_run(self, run_id: str) -> KeyLease:
        label = self._pins.get(run_id)
        if label is None:
            # VERIFY: the docs do not say a run is bound to the key that created it.
            log.info("tinyfish_unpinned_run", run_id=run_id)
            return await self._pool.acquire()
        return await self._pool.acquire_pinned(label)

    async def _agent_payload(self, request: AgentRunRequest) -> dict[str, Any]:
        normalized = await self._normalize_target(request.url)
        return request.model_copy(update={"url": normalized}).to_body()

    async def _normalize_target(self, url: str) -> str:
        return await asyncio.to_thread(validate_target_url, url)

    def _run_url(self, run_id: str) -> str:
        return f"{self._agent_base_url}/v1/runs/{quote(run_id, safe='')}"

    def _cancel_url(self, run_id: str) -> str:
        return f"{self._run_url(run_id)}/cancel"

    def _require_run_id(self, run_id: str) -> None:
        if run_id == "":
            raise ValueError("run_id must not be empty")


def _api_error(body: bytes) -> tuple[str | None, str | None] | None:
    if body == b"":
        return None
    try:
        envelope = ApiErrorEnvelope.model_validate_json(body)
    except ValidationError:
        return None
    if envelope.error is None:
        return None
    return envelope.error.code, envelope.error.message


async def _pull(chunks: AsyncIterator[bytes], deadline: float) -> bytes | None:
    """Read one chunk, or None at the end of the body. The total deadline is absolute."""
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError
    return await asyncio.wait_for(_next_chunk(chunks), timeout=remaining)


async def _next_chunk(chunks: AsyncIterator[bytes]) -> bytes | None:
    """Read one chunk. End of body is None so wait_for does not see StopAsyncIteration."""
    try:
        return await anext(chunks)
    except StopAsyncIteration:
        return None
