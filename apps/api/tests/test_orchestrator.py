"""Orchestrator concurrency, key rotation, event order, and ledger HMAC."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

from pydantic import SecretStr

from sentinel.core.errors import TinyFishError
from sentinel.orchestrator.bus import EventBus, SqliteLedger, sign_head
from sentinel.orchestrator.engine import (
    InvestigationOrchestrator,
    InvestigationTarget,
    KeyRotationRequired,
    TinyFishNavigator,
)
from sentinel.pipeline.enrichment import Indicator, InfraProfile
from sentinel.pipeline.goals import SAFETY_CLAUSE
from sentinel.tinyfish import (
    AgentRunRequest,
    CompleteEvent,
    KeyLease,
    KeyOutcome,
    KeyPool,
    KeyState,
    ProgressEvent,
)
from sentinel.tinyfish.models import ErrorCategory, RunError, RunStatus

_SECRET = "sentinel-test-secret"
_RESULT: dict[str, object] = {
    "merchant_identities": {"merchant_identifiers": ["m_1"]},
    "processing": {
        "payment_processors": ["stripe"],
        "reached_checkout": False,
        "stopped_reason": "safety clause",
    },
    "evidence": [
        {
            "field": "suspicious_scripts",
            "value": "checkout.js",
            "severity": "high",
            "source": "agent",
        }
    ],
    "indicators": [{"kind": "merchant_id", "value": "m_1", "confidence": 0.9, "source": "agent"}],
}


def _bus() -> EventBus:
    return EventBus(secret=SecretStr(_SECRET))


def _pool(*secrets: str, concurrency: int = 4) -> KeyPool:
    return KeyPool(
        tuple(SecretStr(item) for item in secrets),
        concurrency_per_key=concurrency,
        acquire_timeout_seconds=1,
    )


def _target(suffix: str) -> InvestigationTarget:
    return InvestigationTarget(
        target_id=f"tgt_{suffix}",
        url=f"https://shop-{suffix}.example/",
        host=f"shop-{suffix}.example",
    )


async def _enrich(_url: str) -> InfraProfile:
    return InfraProfile(
        a=("203.0.113.10",),
        issuer="CN=Example CA",
        created=datetime(2020, 1, 1, tzinfo=UTC),
        redirect_hosts=("shop.example",),
        indicators=(
            Indicator(kind="ip", value="203.0.113.10"),
            Indicator(kind="domain", value="shop.example"),
        ),
    )


def _complete(run_id: str, *, error: RunError | None = None) -> CompleteEvent:
    status = RunStatus.COMPLETED if error is None else RunStatus.CANCELLED
    result = None if error is not None else _RESULT
    return CompleteEvent(
        type="COMPLETE",
        run_id=run_id,
        status=status,
        result=result,
        error=error,
    )


class RecordingNavigator:
    """Yields one progress step and a completed run."""

    def __init__(self) -> None:
        self.goals: list[str] = []

    async def stream(
        self,
        request: AgentRunRequest,
        lease: KeyLease,
    ) -> AsyncIterator[ProgressEvent | CompleteEvent]:
        self.goals.append(request.goal)
        yield ProgressEvent(type="PROGRESS", run_id=lease.label, purpose="Open the storefront")
        yield _complete(lease.label)


class GatedNavigator:
    """Holds each run open so the test can observe the parallelism cap."""

    def __init__(self) -> None:
        self.in_flight = 0
        self.peak = 0
        self._lock = asyncio.Lock()
        self.entered = asyncio.Event()
        self.release = asyncio.Event()

    async def stream(
        self,
        request: AgentRunRequest,
        lease: KeyLease,
    ) -> AsyncIterator[ProgressEvent | CompleteEvent]:
        del request
        async with self._lock:
            self.in_flight += 1
            self.peak = max(self.peak, self.in_flight)
            if self.in_flight >= 2:
                self.entered.set()
        await asyncio.sleep(0)
        await self.release.wait()
        try:
            yield ProgressEvent(type="PROGRESS", run_id=lease.label, purpose="Open the storefront")
            yield _complete(lease.label)
        finally:
            async with self._lock:
                self.in_flight -= 1


class RateLimitNavigator:
    def __init__(self) -> None:
        self.labels: list[str] = []

    async def stream(
        self,
        request: AgentRunRequest,
        lease: KeyLease,
    ) -> AsyncIterator[ProgressEvent | CompleteEvent]:
        del request
        self.labels.append(lease.label)
        if lease.label == "key-1":
            raise KeyRotationRequired(
                KeyOutcome.RATE_LIMITED,
                "rate limited",
                retry_after_seconds=120,
            )
        yield ProgressEvent(type="PROGRESS", run_id="run-2", purpose="Open the storefront")
        yield _complete("run-2")


class BillingNavigator:
    def __init__(self) -> None:
        self.labels: list[str] = []

    async def stream(
        self,
        request: AgentRunRequest,
        lease: KeyLease,
    ) -> AsyncIterator[CompleteEvent | ProgressEvent]:
        del request
        self.labels.append(lease.label)
        if lease.label == "key-1":
            yield _complete(
                "run-bill",
                error=RunError(
                    code="BILLING_REJECTED",
                    message="insufficient credits",
                    category=ErrorCategory.BILLING_FAILURE,
                ),
            )
            return
        yield ProgressEvent(type="PROGRESS", run_id="run-2", purpose="Open the storefront")
        yield _complete("run-2")


class FatalNavigator:
    def __init__(self) -> None:
        self.calls = 0

    async def stream(
        self,
        request: AgentRunRequest,
        lease: KeyLease,
    ) -> AsyncIterator[CompleteEvent]:
        del request, lease
        self.calls += 1
        if self.calls > 0:
            raise TinyFishError("TinyFish rejected the target")
        yield _complete("unused")


def _orchestrator(
    bus: EventBus,
    pool: KeyPool,
    client: TinyFishNavigator,
) -> InvestigationOrchestrator:
    return InvestigationOrchestrator(
        bus,
        pool,
        client,
        enrich_target=_enrich,
        key_acquire_timeout=0.2,
    )


async def test_sequence_order_and_ledger_hmac() -> None:
    bus = _bus()
    client = RecordingNavigator()
    orchestrator = _orchestrator(bus, _pool("key-a"), client)
    case_id = "case-sequence"
    async with bus.subscribe(case_id) as subscription:
        task = asyncio.create_task(
            orchestrator.run(
                case_id,
                (_target("a"), _target("b")),
                max_parallel=1,
                focus="card descriptor",
            )
        )
        events: list[object] = []
        while True:
            event = await asyncio.wait_for(subscription.queue.get(), timeout=2)
            assert event is not None
            events.append(event)
            if event.type == "CaseCompleted":
                break
        result = await task

    assert [event.type for event in events] == [
        "CaseStarted",
        "TargetStarted",
        "StepUpdated",
        "TargetCompleted",
        "TargetStarted",
        "StepUpdated",
        "TargetCompleted",
        "GraphUpdated",
        "CaseCompleted",
    ]
    assert [event.seq for event in events] == list(range(1, 10))
    assert events[0].target_id is None
    assert events[1].host == "shop-a.example"
    assert events[2].purpose == "Open the storefront"
    assert events[2].index == 1
    report = events[3].report
    assert report.risk.evidence_coverage == "7/8"
    assert report.risk.score == 25
    assert report.risk.label == "LOW"
    assert len(report.evidence) == 8
    assert events[8].targets == 2
    assert events[8].failed == 0
    assert events[8].clusters == 1
    assert result.graph.version == 1
    assert result.graph.clusters[0].members == ["tgt_a", "tgt_b"]
    assert SAFETY_CLAUSE in client.goals[0]
    assert "Focus: card descriptor" in client.goals[0]

    rows = await bus.entries(case_id)
    assert [row.seq for row in rows] == list(range(1, 10))
    assert "target_id" not in rows[0].payload
    assert (
        rows[0].prev_hash
        == hashlib.sha256(f"phantasm-sentinel:genesis:{case_id}".encode()).hexdigest()
    )
    verification = await bus.verify(case_id)
    assert verification.ok
    assert verification.signature_ok
    assert verification.entries_checked == 9
    assert verification.first_broken_seq is None
    assert verification.head_hash == rows[-1].entry_hash
    head = bus.ledger.head(case_id)
    assert head is not None
    assert head.signature == sign_head(_SECRET, rows[-1].entry_hash, len(rows))
    assert (
        head.signature
        == hmac.new(
            _SECRET.encode(),
            f"{rows[-1].entry_hash} {len(rows)}".encode(),
            hashlib.sha256,
        ).hexdigest()
    )

    async with bus.subscribe(case_id, after_seq=7) as replay:
        replayed: list[int] = []
        while True:
            try:
                item = replay.queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            assert item is not None
            replayed.append(item.seq)
    assert replayed == [8, 9]


async def test_ledger_tamper_breaks_chain_and_signature() -> None:
    bus = _bus()
    orchestrator = _orchestrator(bus, _pool("key-a"), RecordingNavigator())
    case_id = "case-tamper"
    await orchestrator.run(case_id, (_target("a"),), max_parallel=1)

    rows = await bus.entries(case_id)
    original = rows[0].payload["target_count"]
    rows[0].payload["target_count"] = 99
    broken = await bus.verify(case_id)
    assert not broken.ok
    assert broken.first_broken_seq == 1
    assert broken.reason == "entry_hash does not match the payload"
    assert broken.signature_ok

    rows[0].payload["target_count"] = original
    head = bus.ledger.head(case_id)
    assert head is not None
    head.signature = "ab" * 32
    mismatched = await bus.verify(case_id)
    assert not mismatched.ok
    assert mismatched.signature_ok is False
    assert mismatched.first_broken_seq is None
    assert mismatched.reason == "signature mismatch"


async def test_max_parallel_limits_concurrency() -> None:
    bus = _bus()
    client = GatedNavigator()
    orchestrator = _orchestrator(bus, _pool("key-a", concurrency=4), client)
    case_id = "case-parallel"
    task = asyncio.create_task(
        orchestrator.run(
            case_id,
            (_target("a"), _target("b"), _target("c")),
            max_parallel=2,
        )
    )
    await asyncio.wait_for(client.entered.wait(), timeout=2)
    await asyncio.sleep(0.05)
    assert client.in_flight == 2
    assert client.peak == 2
    client.release.set()
    result = await asyncio.wait_for(task, timeout=2)
    assert client.peak == 2
    assert result.completed == ("tgt_a", "tgt_b", "tgt_c")
    rows = await bus.entries(case_id)
    assert [row.seq for row in rows] == list(range(1, len(rows) + 1))
    verification = await bus.verify(case_id)
    assert verification.ok
    assert verification.signature_ok


async def test_key_rotation_on_rate_limit() -> None:
    bus = _bus()
    pool = _pool("one", "two", concurrency=1)
    client = RateLimitNavigator()
    orchestrator = _orchestrator(bus, pool, client)
    result = await orchestrator.run("case-rotate", (_target("a"),), max_parallel=1)
    assert client.labels == ["key-1", "key-2"]
    assert result.failed == ()
    assert result.completed == ("tgt_a",)
    states = {item.label: item for item in await pool.snapshot()}
    assert states["key-1"].state is KeyState.COOLING_DOWN
    assert states["key-1"].runs_served == 1
    assert states["key-2"].state is KeyState.HEALTHY
    assert states["key-2"].runs_served == 1
    rows = await bus.entries("case-rotate")
    assert [row.event_type for row in rows] == [
        "CaseStarted",
        "TargetStarted",
        "StepUpdated",
        "TargetCompleted",
        "GraphUpdated",
        "CaseCompleted",
    ]


async def test_billing_rejection_rotates_key() -> None:
    bus = _bus()
    pool = _pool("one", "two", concurrency=1)
    client = BillingNavigator()
    orchestrator = _orchestrator(bus, pool, client)
    result = await orchestrator.run("case-billing", (_target("a"),), max_parallel=1)
    assert client.labels == ["key-1", "key-2"]
    assert result.completed == ("tgt_a",)
    states = {item.label: item.state for item in await pool.snapshot()}
    assert states["key-1"] is KeyState.EXHAUSTED
    assert states["key-2"] is KeyState.HEALTHY


async def test_non_retryable_error_marks_target_failed() -> None:
    bus = _bus()
    pool = _pool("one", "two", concurrency=1)
    client = FatalNavigator()
    orchestrator = _orchestrator(bus, pool, client)
    result = await orchestrator.run("case-fatal", (_target("a"),), max_parallel=1)
    assert client.calls == 1
    assert result.completed == ()
    assert result.failed == ("tgt_a",)
    states = {item.label: item for item in await pool.snapshot()}
    assert states["key-1"].state is KeyState.HEALTHY
    assert states["key-1"].runs_served == 1
    assert states["key-2"].runs_served == 0
    rows = await bus.entries("case-fatal")
    failed = next(row for row in rows if row.event_type == "TargetFailed")
    assert failed.payload["error_code"] == "tinyfish_error"
    assert failed.payload["message"] == "TinyFish rejected the target"
    completed = next(row for row in rows if row.event_type == "CaseCompleted")
    assert completed.payload["targets"] == 0
    assert completed.payload["failed"] == 1


async def test_sqlite_ledger_reopens_and_verifies(tmp_path: Path) -> None:
    path = tmp_path / "ledger.sqlite"
    secret = SecretStr(_SECRET)
    bus = EventBus(secret=secret, ledger=SqliteLedger(path))
    orchestrator = _orchestrator(bus, _pool("key-a"), RecordingNavigator())
    await orchestrator.run("case-sqlite", (_target("a"),), max_parallel=1)
    first = await bus.verify("case-sqlite")
    await bus.aclose()

    reopened = EventBus(secret=secret, ledger=SqliteLedger(path))
    second = await reopened.verify("case-sqlite")
    assert first.ok
    assert second.ok
    assert first.head_hash == second.head_hash
    assert second.signature_ok
    assert second.entries_checked == first.entries_checked
    await reopened.aclose()
