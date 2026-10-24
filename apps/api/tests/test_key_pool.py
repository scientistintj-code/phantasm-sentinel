"""Key pool rotation, cooldown, and secret redaction."""

import asyncio
import contextlib
import time

import pytest
from pydantic import SecretStr

from sentinel.core.errors import KeyLeaseError, KeyPoolExhaustedError
from sentinel.core.logging import configure_logging
from sentinel.tinyfish import KeyLease, KeyPool, KeyState

_SECRET_ALPHA = "sk-live-DoNotLeakAlpha7f3a2c"
_SECRET_BETA = "sk-live-DoNotLeakBeta8e4b1d"


class _FakeClock:
    """Cooldown clock that moves only when a test advances it."""

    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def _pool(
    *secrets: str,
    concurrency_per_key: int = 2,
    acquire_timeout_seconds: float = 30,
    clock: _FakeClock | None = None,
) -> KeyPool:
    return KeyPool(
        tuple(SecretStr(secret) for secret in secrets),
        concurrency_per_key=concurrency_per_key,
        acquire_timeout_seconds=acquire_timeout_seconds,
        clock=clock,
    )


async def _cancel(task: asyncio.Task[KeyLease]) -> None:
    if task.done():
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


@pytest.mark.asyncio
async def test_acquire_rotates_least_recently_used() -> None:
    pool = _pool("alpha-secret", "beta-secret", "gamma-secret", concurrency_per_key=1)
    seen: list[str] = []

    for _ in range(4):
        lease = await pool.acquire()
        seen.append(lease.label)
        await lease.release()

    assert seen == ["key-1", "key-2", "key-3", "key-1"]


@pytest.mark.asyncio
async def test_concurrency_cap_spreads_parallel_leases() -> None:
    pool = _pool("alpha-secret", "beta-secret", concurrency_per_key=1)
    first = await pool.acquire()
    second = await pool.acquire()
    blocked = asyncio.create_task(pool.acquire())
    third: KeyLease | None = None
    try:
        assert {first.label, second.label} == {"key-1", "key-2"}
        held = await pool.snapshot()
        assert [row.in_flight for row in held] == [1, 1]
        await asyncio.sleep(0.05)
        assert not blocked.done()
        await first.release()
        third = await blocked
        assert third.label == "key-1"
    finally:
        await first.release()
        await second.release()
        if third is not None:
            await third.release()
        await _cancel(blocked)

    wide = _pool("alpha-secret", "beta-secret", concurrency_per_key=2)
    leases = [await wide.acquire() for _ in range(4)]
    extra = asyncio.create_task(wide.acquire())
    fifth: KeyLease | None = None
    try:
        assert [lease.label for lease in leases].count("key-1") == 2
        assert [lease.label for lease in leases].count("key-2") == 2
        await asyncio.sleep(0.05)
        assert not extra.done()
        await leases[0].release()
        fifth = await extra
        assert fifth.label == "key-1"
    finally:
        for lease in leases:
            await lease.release()
        if fifth is not None:
            await fifth.release()
        await _cancel(extra)


@pytest.mark.asyncio
async def test_rate_limited_key_returns_after_cooldown() -> None:
    clock = _FakeClock()
    pool = _pool(
        "alpha-secret",
        "beta-secret",
        concurrency_per_key=1,
        clock=clock,
    )
    first = await pool.acquire()
    try:
        assert first.label == "key-1"
        with pytest.raises(ValueError, match="retry_after_seconds"):
            await first.mark_rate_limited(-1)
        await first.mark_rate_limited(30)
    finally:
        await first.release()

    cooling = await pool.snapshot()
    assert cooling[0].state is KeyState.COOLING_DOWN
    assert cooling[1].state is KeyState.HEALTHY

    second = await pool.acquire()
    try:
        assert second.label == "key-2"
    finally:
        await second.release()

    clock.advance(30)
    restored = await pool.snapshot()
    assert restored[0].state is KeyState.HEALTHY
    assert restored[0].label == "key-1"

    third = await pool.acquire()
    try:
        assert third.label == "key-1"
    finally:
        await third.release()


@pytest.mark.asyncio
async def test_exhausted_and_invalid_keys_stay_out_of_rotation() -> None:
    pool = _pool("alpha-secret", "beta-secret", concurrency_per_key=1)
    first = await pool.acquire()
    try:
        assert first.label == "key-1"
        await first.mark_exhausted()
        await first.mark_success()
        await first.mark_rate_limited(5)
    finally:
        await first.release()

    second = await pool.acquire()
    try:
        assert second.label == "key-2"
        await second.mark_invalid()
    finally:
        await second.release()

    rows = await pool.snapshot()
    assert [(row.label, row.state, row.in_flight, row.runs_served) for row in rows] == [
        ("key-1", KeyState.EXHAUSTED, 0, 1),
        ("key-2", KeyState.INVALID, 0, 1),
    ]

    started = time.monotonic()
    with pytest.raises(KeyPoolExhaustedError, match="no TinyFish API keys are available"):
        await pool.acquire(timeout=5)
    assert time.monotonic() - started < 0.5

    with pytest.raises(KeyLeaseError, match="closed"):
        await first.mark_success()


@pytest.mark.asyncio
async def test_acquire_times_out_when_no_key_is_free() -> None:
    pool = _pool("alpha-secret", concurrency_per_key=1)
    lease = await pool.acquire()
    try:
        with pytest.raises(KeyPoolExhaustedError, match="timed out"):
            await pool.acquire(timeout=0.1)
    finally:
        await lease.release()

    started = time.monotonic()
    with pytest.raises(KeyPoolExhaustedError, match="no TinyFish API keys are available"):
        await _pool().acquire(timeout=5)
    assert time.monotonic() - started < 0.5


@pytest.mark.asyncio
async def test_repr_str_and_snapshot_omit_secrets(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging()
    pool = _pool(_SECRET_ALPHA, _SECRET_BETA)
    async with await pool.acquire() as lease:
        await lease.mark_success()
        lease_text = " ".join([repr(lease), str(lease), repr(lease.api_key), str(lease.api_key)])
        assert lease.label == "key-1"

    rows = await pool.snapshot()
    captured = capsys.readouterr()
    blob = "\n".join(
        [
            repr(pool),
            str(pool),
            lease_text,
            "\n".join(row.model_dump_json() for row in rows),
            captured.out,
            captured.err,
        ]
    )

    assert _SECRET_ALPHA not in blob
    assert _SECRET_BETA not in blob
    assert "key-1" in blob
    assert "key-1" in captured.out
    assert rows[0].runs_served == 1
    assert rows[0].state is KeyState.HEALTHY
