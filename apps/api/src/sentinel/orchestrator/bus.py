"""Per-connection event bus and the append-only case ledger.

Sequence numbers start at 1 and increase by one for each case. Every event is
appended before it is broadcast. The ledger head is HMAC-SHA256 of
``head_hash + " " + entry_count``, keyed with ``SENTINEL_SECRET_KEY``.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import sqlite3
import threading
from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

from sentinel.pipeline.schemas import EvidenceField, EvidenceItem

_FROZEN = ConfigDict(frozen=True, extra="forbid")
EVIDENCE_FIELDS: tuple[EvidenceField, ...] = (
    "merchant_id",
    "gateway",
    "payment_endpoint",
    "host_ip",
    "domain_age",
    "ssl_issuer",
    "suspicious_scripts",
    "redirect_chain",
)
RiskLabel = Literal["LOW", "MEDIUM", "HIGH"]


def canonical_json(payload: Mapping[str, Any]) -> str:
    """Contract canonical JSON: sorted keys, no whitespace, UTF-8 text."""
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def genesis_hash(case_id: str) -> str:
    """Hash that the first ledger entry uses as ``prev_hash``."""
    return hashlib.sha256(f"phantasm-sentinel:genesis:{case_id}".encode()).hexdigest()


def entry_digest(prev_hash: str, seq: int, ts: str, canonical_payload: str) -> str:
    """Lowercase SHA-256 of the contract entry preimage."""
    preimage = f"{prev_hash} {seq} {ts} {canonical_payload}"
    return hashlib.sha256(preimage.encode()).hexdigest()


def sign_head(secret: str, head_hash: str, entry_count: int) -> str:
    """Lowercase HMAC-SHA256 over ``head_hash + " " + entry_count``."""
    message = f"{head_hash} {entry_count}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _timestamp(moment: datetime) -> str:
    current = moment.astimezone(UTC)
    millis = current.microsecond // 1000
    return current.strftime("%Y-%m-%dT%H:%M:%S.") + f"{millis:03d}Z"


def _same(left: str, right: str) -> bool:
    if len(left) != len(right):
        return False
    return hmac.compare_digest(left, right)


def _load_secret(secret: SecretStr | None) -> SecretStr:
    if secret is not None:
        value = secret.get_secret_value()
    else:
        value = os.environ.get("SENTINEL_SECRET_KEY", "")
    if value.strip() == "":
        raise ValueError("SENTINEL_SECRET_KEY is required")
    if secret is not None:
        return secret
    return SecretStr(value)


class Risk(BaseModel):
    """Risk block on a ``TargetReport``."""

    model_config = _FROZEN

    score: int = Field(ge=0, le=100)
    label: RiskLabel
    evidence_coverage: str = Field(pattern=r"^[0-8]/8$")
    verdict: str = Field(min_length=1)


class TargetReport(BaseModel):
    """Eight evidence rows in contract order."""

    model_config = _FROZEN

    target_id: str = Field(min_length=1)
    host: str = Field(min_length=1)
    risk: Risk
    evidence: tuple[EvidenceItem, ...]

    @model_validator(mode="after")
    def evidence_matches_contract(self) -> TargetReport:
        fields = tuple(item.field for item in self.evidence)
        if fields != EVIDENCE_FIELDS:
            raise ValueError("evidence must list the eight contract fields in order")
        return self


class SentinelEvent(BaseModel):
    """Envelope shared by case and target events. The bus assigns ``seq`` and ``ts``."""

    model_config = _FROZEN

    case_id: str = Field(min_length=1)
    seq: int = 0
    ts: str = ""
    type: str
    target_id: str | None = None


class CaseStarted(SentinelEvent):
    """A multi-target run has started."""

    type: Literal["CaseStarted"] = "CaseStarted"
    target_count: int = Field(ge=0)
    max_parallel: int = Field(ge=1, le=5)


class TargetStarted(SentinelEvent):
    """Passive enrichment and active navigation are about to run for one target."""

    type: Literal["TargetStarted"] = "TargetStarted"
    target_id: str = Field(min_length=1)
    url: str = Field(min_length=1)
    host: str = Field(min_length=1)


class StepUpdated(SentinelEvent):
    """One Agent step. ``index`` is Sentinel's count for the target."""

    type: Literal["StepUpdated"] = "StepUpdated"
    target_id: str = Field(min_length=1)
    index: int = Field(ge=1)
    purpose: str = Field(min_length=1)
    run_id: str | None = None


class TargetCompleted(SentinelEvent):
    """Payload validation finished and a report was built."""

    type: Literal["TargetCompleted"] = "TargetCompleted"
    target_id: str = Field(min_length=1)
    report: TargetReport


class TargetFailed(SentinelEvent):
    """The target stopped on a non-retryable error."""

    type: Literal["TargetFailed"] = "TargetFailed"
    target_id: str = Field(min_length=1)
    error_code: str = Field(min_length=1)
    message: str = Field(min_length=1)


class GraphUpdated(SentinelEvent):
    """The case graph version advanced."""

    type: Literal["GraphUpdated"] = "GraphUpdated"
    version: int = Field(ge=1)


class CaseCompleted(SentinelEvent):
    """Every target has completed or failed."""

    type: Literal["CaseCompleted"] = "CaseCompleted"
    targets: int = Field(ge=0)
    failed: int = Field(ge=0)
    clusters: int = Field(ge=0)


ContractEvent = (
    CaseStarted
    | TargetStarted
    | StepUpdated
    | TargetCompleted
    | TargetFailed
    | GraphUpdated
    | CaseCompleted
)

_EVENT_MODELS: dict[str, type[SentinelEvent]] = {
    "CaseStarted": CaseStarted,
    "TargetStarted": TargetStarted,
    "StepUpdated": StepUpdated,
    "TargetCompleted": TargetCompleted,
    "TargetFailed": TargetFailed,
    "GraphUpdated": GraphUpdated,
    "CaseCompleted": CaseCompleted,
}


def rehydrate(payload: Mapping[str, Any]) -> ContractEvent:
    """Build the typed event stored in a ledger payload."""
    event_type = payload.get("type")
    model = _EVENT_MODELS.get(event_type) if isinstance(event_type, str) else None
    if model is None:
        raise ValueError("ledger payload has an unknown event type")
    loaded = model.model_validate(payload)
    if not isinstance(loaded, _EVENT_TYPES):
        raise ValueError("ledger payload has an unknown event type")
    return loaded


_EVENT_TYPES = (
    CaseStarted,
    TargetStarted,
    StepUpdated,
    TargetCompleted,
    TargetFailed,
    GraphUpdated,
    CaseCompleted,
)


class LedgerVerification(BaseModel):
    """Result of ``POST /cases/{id}/ledger/verify`` for one in-process ledger."""

    model_config = _FROZEN

    ok: bool
    entries_checked: int = Field(ge=0)
    first_broken_seq: int | None = None
    reason: str | None = None
    head_hash: str
    signature_ok: bool


@dataclass
class LedgerEntry:
    """One append-only ledger row. ``payload`` is the event object."""

    seq: int
    ts: str
    event_type: str
    payload: dict[str, Any]
    prev_hash: str
    entry_hash: str


@dataclass
class LedgerHead:
    """Signed head stored beside the entries."""

    signature: str
    head_hash: str
    entry_count: int


class Ledger:
    """Append-only store. Implementations must keep insertion order per case."""

    def append(
        self,
        case_id: str,
        entry: LedgerEntry,
        signature: str,
        head_hash: str,
        entry_count: int,
    ) -> None:
        raise NotImplementedError

    def entries(self, case_id: str) -> list[LedgerEntry]:
        raise NotImplementedError

    def head(self, case_id: str) -> LedgerHead | None:
        raise NotImplementedError

    def close(self) -> None:
        return None


class MemoryLedger(Ledger):
    """Process-local ledger. Returned entries are the stored objects."""

    def __init__(self) -> None:
        self._entries: dict[str, list[LedgerEntry]] = {}
        self._heads: dict[str, LedgerHead] = {}

    def append(
        self,
        case_id: str,
        entry: LedgerEntry,
        signature: str,
        head_hash: str,
        entry_count: int,
    ) -> None:
        self._entries.setdefault(case_id, []).append(entry)
        self._heads[case_id] = LedgerHead(
            signature=signature,
            head_hash=head_hash,
            entry_count=entry_count,
        )

    def entries(self, case_id: str) -> list[LedgerEntry]:
        return self._entries.get(case_id, [])

    def head(self, case_id: str) -> LedgerHead | None:
        return self._heads.get(case_id)


class SqliteLedger(Ledger):
    """SQLite ledger. Writes are serialized with a thread lock."""

    def __init__(self, path: str | Path) -> None:
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(os.fspath(path), check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ledger_entries (
                case_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                ts TEXT NOT NULL,
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                prev_hash TEXT NOT NULL,
                entry_hash TEXT NOT NULL,
                PRIMARY KEY (case_id, seq)
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ledger_heads (
                case_id TEXT PRIMARY KEY,
                signature TEXT NOT NULL,
                head_hash TEXT NOT NULL,
                entry_count INTEGER NOT NULL
            )
            """
        )
        self._conn.commit()

    def append(
        self,
        case_id: str,
        entry: LedgerEntry,
        signature: str,
        head_hash: str,
        entry_count: int,
    ) -> None:
        payload = canonical_json(entry.payload)
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO ledger_entries (
                    case_id, seq, ts, event_type, payload, prev_hash, entry_hash
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    case_id,
                    entry.seq,
                    entry.ts,
                    entry.event_type,
                    payload,
                    entry.prev_hash,
                    entry.entry_hash,
                ),
            )
            self._conn.execute(
                """
                INSERT INTO ledger_heads (case_id, signature, head_hash, entry_count)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(case_id) DO UPDATE SET
                    signature = excluded.signature,
                    head_hash = excluded.head_hash,
                    entry_count = excluded.entry_count
                """,
                (case_id, signature, head_hash, entry_count),
            )
            self._conn.commit()

    def entries(self, case_id: str) -> list[LedgerEntry]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT seq, ts, event_type, payload, prev_hash, entry_hash
                FROM ledger_entries
                WHERE case_id = ?
                ORDER BY seq
                """,
                (case_id,),
            ).fetchall()
        loaded: list[LedgerEntry] = []
        for seq, ts, event_type, payload, prev_hash, entry_hash in rows:
            parsed = _payload_object(payload)
            loaded.append(
                LedgerEntry(
                    seq=int(seq),
                    ts=str(ts),
                    event_type=str(event_type),
                    payload=parsed,
                    prev_hash=str(prev_hash),
                    entry_hash=str(entry_hash),
                )
            )
        return loaded

    def head(self, case_id: str) -> LedgerHead | None:
        with self._lock:
            row = self._conn.execute(
                """
                SELECT signature, head_hash, entry_count
                FROM ledger_heads
                WHERE case_id = ?
                """,
                (case_id,),
            ).fetchone()
        if row is None:
            return None
        return LedgerHead(signature=str(row[0]), head_hash=str(row[1]), entry_count=int(row[2]))

    def close(self) -> None:
        with self._lock:
            self._conn.close()


def _payload_object(payload: object) -> dict[str, Any]:
    if not isinstance(payload, str):
        raise ValueError("ledger payload must be JSON text")
    loaded: object = json.loads(payload)
    if not isinstance(loaded, dict):
        raise ValueError("ledger payload must be an object")
    return {str(key): value for key, value in loaded.items()}


class Subscription:
    """One client connection. ``None`` on the queue means the subscription closed."""

    def __init__(self, case_id: str, queue: asyncio.Queue[ContractEvent | None]) -> None:
        self.case_id = case_id
        self.queue = queue


class EventBus:
    """Broadcasts typed events to one asyncio queue per client connection."""

    def __init__(
        self,
        secret: SecretStr | None = None,
        ledger: Ledger | None = None,
        *,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._secret = _load_secret(secret)
        self.ledger = MemoryLedger() if ledger is None else ledger
        self._now: Callable[[], datetime] = _utc_now if now is None else now
        self._lock = asyncio.Lock()
        self._subscribers: dict[str, list[Subscription]] = {}
        self._tails: dict[str, tuple[int, str]] = {}

    def __repr__(self) -> str:
        return "EventBus(secret='**********')"

    async def publish(self, event: ContractEvent) -> ContractEvent:
        """Assign ``seq`` and ``ts``, append the ledger, then broadcast."""
        async with self._lock:
            case_id = event.case_id
            seq, prev_hash = await self._tail(case_id)
            payload = event.model_dump(mode="json", exclude_none=True)
            payload["seq"] = seq
            payload["ts"] = _timestamp(self._now())
            stamped = rehydrate(payload)
            canonical = canonical_json(payload)
            digest = entry_digest(prev_hash, seq, stamped.ts, canonical)
            row = LedgerEntry(
                seq=seq,
                ts=stamped.ts,
                event_type=stamped.type,
                payload=payload,
                prev_hash=prev_hash,
                entry_hash=digest,
            )
            signature = sign_head(self._secret.get_secret_value(), digest, seq)
            await asyncio.to_thread(self.ledger.append, case_id, row, signature, digest, seq)
            self._tails[case_id] = (seq, digest)
            for subscription in self._subscribers.get(case_id, []):
                subscription.queue.put_nowait(stamped)
            if not isinstance(stamped, _EVENT_TYPES):
                raise ValueError("published event lost its type")
            return stamped

    @asynccontextmanager
    async def subscribe(
        self,
        case_id: str,
        *,
        after_seq: int = 0,
    ) -> AsyncIterator[Subscription]:
        """Replay events with ``seq`` greater than ``after_seq``, then stream live ones."""
        subscription = await self._attach(case_id, after_seq)
        try:
            yield subscription
        finally:
            await self._detach(subscription)

    async def entries(self, case_id: str) -> list[LedgerEntry]:
        """Return the stored ledger rows for ``case_id``."""
        async with self._lock:
            return await asyncio.to_thread(self.ledger.entries, case_id)

    async def verify(self, case_id: str) -> LedgerVerification:
        """Check the hash chain and the signed head. The two results are independent."""
        async with self._lock:
            rows = await asyncio.to_thread(self.ledger.entries, case_id)
            head = await asyncio.to_thread(self.ledger.head, case_id)
        return _verify(case_id, rows, head, self._secret.get_secret_value())

    async def aclose(self) -> None:
        """Close the ledger if it holds a file."""
        await asyncio.to_thread(self.ledger.close)

    async def _tail(self, case_id: str) -> tuple[int, str]:
        cached = self._tails.get(case_id)
        if cached is None:
            rows = await asyncio.to_thread(self.ledger.entries, case_id)
            cached = (rows[-1].seq, rows[-1].entry_hash) if rows else (0, genesis_hash(case_id))
            self._tails[case_id] = cached
        return cached[0] + 1, cached[1]

    async def _attach(self, case_id: str, after_seq: int) -> Subscription:
        async with self._lock:
            rows = await asyncio.to_thread(self.ledger.entries, case_id)
            subscription = Subscription(case_id, asyncio.Queue())
            self._subscribers.setdefault(case_id, []).append(subscription)
            for row in rows:
                if row.seq > after_seq:
                    subscription.queue.put_nowait(rehydrate(row.payload))
            return subscription

    async def _detach(self, subscription: Subscription) -> None:
        async with self._lock:
            subscribers = self._subscribers.get(subscription.case_id, [])
            if subscription in subscribers:
                subscribers.remove(subscription)
        await subscription.queue.put(None)


def _verify(
    case_id: str,
    rows: list[LedgerEntry],
    head: LedgerHead | None,
    secret: str,
) -> LedgerVerification:
    chain_head = rows[-1].entry_hash if rows else genesis_hash(case_id)
    if head is None:
        signature_ok = not rows
    else:
        signature_ok = _same(
            head.signature,
            sign_head(secret, head.head_hash, head.entry_count),
        )
        if rows and (head.head_hash != chain_head or head.entry_count != len(rows)):
            signature_ok = False

    previous = genesis_hash(case_id)
    for index, row in enumerate(rows):
        expected_seq = index + 1
        if row.seq != expected_seq:
            return _broken(
                rows_checked=index + 1,
                seq=row.seq,
                reason="sequence is not contiguous",
                head_hash=chain_head,
                signature_ok=signature_ok,
            )
        if not _same(row.prev_hash, previous):
            return _broken(
                rows_checked=index + 1,
                seq=row.seq,
                reason="prev_hash does not match the previous entry",
                head_hash=chain_head,
                signature_ok=signature_ok,
            )
        digest = entry_digest(previous, row.seq, row.ts, canonical_json(row.payload))
        if not _same(row.entry_hash, digest):
            return _broken(
                rows_checked=index + 1,
                seq=row.seq,
                reason="entry_hash does not match the payload",
                head_hash=chain_head,
                signature_ok=signature_ok,
            )
        previous = row.entry_hash

    if signature_ok:
        return LedgerVerification(
            ok=True,
            entries_checked=len(rows),
            head_hash=chain_head,
            signature_ok=True,
        )
    return LedgerVerification(
        ok=False,
        entries_checked=len(rows),
        reason="signature mismatch",
        head_hash=chain_head,
        signature_ok=False,
    )


def _broken(
    *,
    rows_checked: int,
    seq: int,
    reason: str,
    head_hash: str,
    signature_ok: bool,
) -> LedgerVerification:
    return LedgerVerification(
        ok=False,
        entries_checked=rows_checked,
        first_broken_seq=seq,
        reason=reason,
        head_hash=head_hash,
        signature_ok=signature_ok,
    )
