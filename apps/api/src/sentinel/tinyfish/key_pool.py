"""Lease configured TinyFish API keys without calling the network."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol, Self

import structlog
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from sentinel.core.errors import KeyLeaseError, KeyPoolExhaustedError

log = structlog.get_logger(__name__)

# VERIFY: Step 1.2 maps TinyFish HTTP statuses and error codes onto KeyOutcome.
# This module does not inspect status codes. Candidates in docs/TINYFISH_FACTS.md
# section 8: 402 INSUFFICIENT_CREDITS, 402 FREE_ALLOWANCE_EXHAUSTED, legacy 403
# FORBIDDEN when credits or the subscription are gone, and HTTP 200 BILLING_REJECTED.


class KeyOutcome(StrEnum):
    """Caller-reported result for one leased key."""

    SUCCESS = "success"
    RATE_LIMITED = "rate_limited"
    EXHAUSTED = "exhausted"
    INVALID = "invalid"


class KeyState(StrEnum):
    """Rotation state exposed to health checks and the UI."""

    HEALTHY = "healthy"
    COOLING_DOWN = "cooling_down"
    EXHAUSTED = "exhausted"
    INVALID = "invalid"


class KeySnapshot(BaseModel):
    """One key as shown on a health panel. Contains no secret material."""

    model_config = ConfigDict(frozen=True)

    label: str
    state: KeyState
    in_flight: int = Field(ge=0)
    runs_served: int = Field(ge=0)


class Clock(Protocol):
    """Monotonic time source used only for cooldown deadlines."""

    def __call__(self) -> float:
        """Return the current cooldown time in seconds."""


_TERMINAL = frozenset({KeyState.EXHAUSTED, KeyState.INVALID})


@dataclass
class _Slot:
    index: int
    label: str
    secret: SecretStr
    state: KeyState = KeyState.HEALTHY
    cooldown_until: float | None = None
    in_flight: int = 0
    runs_served: int = 0
    last_used: float = 0.0


class KeyPool:
    """Hands out least-recently-used healthy keys under one asyncio condition."""

    def __init__(
        self,
        keys: Sequence[SecretStr],
        *,
        concurrency_per_key: int = 2,
        acquire_timeout_seconds: float = 30,
        clock: Clock | None = None,
    ) -> None:
        if concurrency_per_key < 1:
            raise ValueError("concurrency_per_key must be >= 1")
        if acquire_timeout_seconds < 0:
            raise ValueError("acquire_timeout_seconds must be >= 0")
        self._concurrency_per_key = concurrency_per_key
        self._acquire_timeout_seconds = acquire_timeout_seconds
        self._clock: Clock = time.monotonic if clock is None else clock
        self._slots = tuple(
            _Slot(index=index, label=f"key-{index}", secret=key)
            for index, key in enumerate(keys, start=1)
        )
        self._labels = tuple(slot.label for slot in self._slots)
        self._condition = asyncio.Condition()

    def __repr__(self) -> str:
        return f"KeyPool(labels={list(self._labels)!r})"

    def __str__(self) -> str:
        return repr(self)

    # Deadline is shared with cooldown wakes and raises KeyPoolExhaustedError.
    async def acquire(self, *, timeout: float | None = None) -> KeyLease:  # noqa: ASYNC109
        """Reserve the least-recently-used eligible key.

        Waits until a lease is released or a cooldown ends. Raises
        KeyPoolExhaustedError immediately when every key is gone, or after
        the timeout when every remaining key is busy or cooling down.
        """
        limit = self._acquire_timeout_seconds if timeout is None else timeout
        if limit < 0:
            raise ValueError("timeout must be >= 0")
        deadline = time.monotonic() + limit
        async with self._condition:
            while True:
                slot = self._pick()
                if slot is not None:
                    slot.in_flight += 1
                    slot.runs_served += 1
                    # LRU follows real time so a frozen cooldown clock still
                    # remembers which key was reserved earlier.
                    slot.last_used = time.monotonic()
                    log.info(
                        "key_acquired",
                        key_label=slot.label,
                        in_flight=slot.in_flight,
                    )
                    return KeyLease(self, slot)
                if not self._can_become_available():
                    raise KeyPoolExhaustedError("no TinyFish API keys are available")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise KeyPoolExhaustedError("timed out waiting for a TinyFish API key")
                timed_out = False
                try:
                    async with asyncio.timeout(self._wake_delay(remaining)):
                        await self._condition.wait()
                except TimeoutError:
                    timed_out = True
                if timed_out:
                    continue

    async def snapshot(self) -> list[KeySnapshot]:
        """Return label, state, in-flight count, and runs served for every key."""
        async with self._condition:
            rows: list[KeySnapshot] = []
            for slot in self._slots:
                self._refresh(slot)
                rows.append(
                    KeySnapshot(
                        label=slot.label,
                        state=slot.state,
                        in_flight=slot.in_flight,
                        runs_served=slot.runs_served,
                    )
                )
            return rows

    async def _apply(
        self,
        lease: KeyLease,
        outcome: KeyOutcome,
        retry_after_seconds: float | None,
    ) -> None:
        async with self._condition:
            if lease._released:
                raise KeyLeaseError(f"{lease.label} lease is closed")
            slot = lease._slot
            if slot.state in _TERMINAL:
                return
            if outcome is KeyOutcome.SUCCESS:
                return
            if outcome is KeyOutcome.RATE_LIMITED:
                retry_after = 0.0 if retry_after_seconds is None else retry_after_seconds
                slot.state = KeyState.COOLING_DOWN
                slot.cooldown_until = self._clock() + retry_after
                log.info(
                    "key_rate_limited",
                    key_label=slot.label,
                    retry_after_seconds=retry_after,
                )
            elif outcome is KeyOutcome.EXHAUSTED:
                slot.state = KeyState.EXHAUSTED
                slot.cooldown_until = None
                log.info("key_exhausted", key_label=slot.label)
            elif outcome is KeyOutcome.INVALID:
                slot.state = KeyState.INVALID
                slot.cooldown_until = None
                log.info("key_invalid", key_label=slot.label)
            self._condition.notify_all()

    async def _release(self, lease: KeyLease) -> None:
        async with self._condition:
            if lease._released:
                return
            lease._released = True
            slot = lease._slot
            slot.in_flight -= 1
            log.info("key_released", key_label=slot.label, in_flight=slot.in_flight)
            self._condition.notify_all()

    def _pick(self) -> _Slot | None:
        eligible: list[_Slot] = []
        for slot in self._slots:
            self._refresh(slot)
            if slot.state is KeyState.HEALTHY and slot.in_flight < self._concurrency_per_key:
                eligible.append(slot)
        if not eligible:
            return None
        return min(eligible, key=lambda slot: (slot.last_used, slot.index))

    def _refresh(self, slot: _Slot) -> None:
        until = slot.cooldown_until
        if slot.state is not KeyState.COOLING_DOWN or until is None:
            return
        if self._clock() >= until:
            slot.state = KeyState.HEALTHY
            slot.cooldown_until = None

    def _can_become_available(self) -> bool:
        for slot in self._slots:
            self._refresh(slot)
            if slot.state in {KeyState.HEALTHY, KeyState.COOLING_DOWN}:
                return True
        return False

    def _wake_delay(self, remaining: float) -> float:
        now = self._clock()
        delay = remaining
        for slot in self._slots:
            until = slot.cooldown_until
            if slot.state is not KeyState.COOLING_DOWN or until is None:
                continue
            remaining_cooldown = until - now
            if 0 < remaining_cooldown < delay:
                delay = remaining_cooldown
        return delay


class KeyLease:
    """One reserved key. Release it by leaving the async context manager."""

    def __init__(self, pool: KeyPool, slot: _Slot) -> None:
        self._pool = pool
        self._slot = slot
        self._released = False
        self.label = slot.label

    def __repr__(self) -> str:
        return f"KeyLease(label={self.label!r})"

    def __str__(self) -> str:
        return self.label

    @property
    def api_key(self) -> SecretStr:
        """Wrapped credential. Callers must not log get_secret_value()."""
        return self._slot.secret

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: object,
    ) -> None:
        await self.release()

    async def mark_success(self) -> None:
        """Record a successful call. Does not change rotation state."""
        await self._pool._apply(self, KeyOutcome.SUCCESS, None)

    async def mark_rate_limited(self, retry_after_seconds: float) -> None:
        """Cool this key down, then let it return when the clock passes."""
        if retry_after_seconds < 0:
            raise ValueError("retry_after_seconds must be >= 0")
        await self._pool._apply(self, KeyOutcome.RATE_LIMITED, retry_after_seconds)

    async def mark_exhausted(self) -> None:
        """Remove this key until the process builds a new pool.

        The caller reports payment-required and insufficient-credit responses
        with this method. Status-code mapping belongs to the TinyFish client.
        """
        await self._pool._apply(self, KeyOutcome.EXHAUSTED, None)

    async def mark_invalid(self) -> None:
        """Remove this key after an authentication failure."""
        await self._pool._apply(self, KeyOutcome.INVALID, None)

    async def release(self) -> None:
        """Return the concurrency slot. Further outcome marks fail."""
        await self._pool._release(self)
