"""Request and response bodies from the API contract."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from sentinel.orchestrator.bus import TargetReport

_FROZEN = ConfigDict(extra="forbid", frozen=True)
CaseStatus = Literal["created", "running", "completed", "cancelled"]
KeyStateName = Literal["healthy", "cooling", "exhausted", "invalid"]
NodeType = Literal["domain", "gateway", "merchant", "host", "bank", "contact"]


class CreateCaseRequest(BaseModel):
    """Body of ``POST /cases``. ``authorization_ack`` must be true."""

    model_config = _FROZEN

    title: str = Field(min_length=1)
    authorized_by: str = Field(min_length=1)
    authorization_ack: Literal[True]


class CaseCreated(BaseModel):
    """Case summary returned by create and list."""

    model_config = _FROZEN

    id: str
    number: str = Field(pattern=r"^PS-\d{4}-\d{4,}$")
    title: str
    status: CaseStatus
    created_at: str


class TargetRequest(BaseModel):
    """Body of ``POST /cases/{id}/targets``. At most ten URLs."""

    model_config = _FROZEN

    urls: list[str] = Field(min_length=1, max_length=10)


class TargetDecision(BaseModel):
    """One accepted or rejected URL. ``reason`` is set only when rejected."""

    model_config = _FROZEN

    url: str
    host: str
    accepted: bool
    reason: str | None = None


class InvestigateRequest(BaseModel):
    """Body of ``POST /cases/{id}/investigate``. All fields are optional."""

    model_config = _FROZEN

    max_parallel: int = Field(default=1, ge=1, le=5)
    focus: str | None = Field(default=None, max_length=300)
    use_profiles: bool = False


class TargetView(BaseModel):
    """A stored target, with its report after the run completes."""

    model_config = _FROZEN

    target_id: str
    url: str
    host: str
    accepted: bool
    reason: str | None = None
    report: TargetReport | None = None


class CaseDetail(CaseCreated):
    """Case summary plus the targets and any reports."""

    targets: list[TargetView]


class GraphNodeOut(BaseModel):
    """One graph node."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    id: str
    type: NodeType
    label: str
    target_id: str | None = None


class GraphEdgeOut(BaseModel):
    """One graph edge. ``weight`` is the indicator confidence."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    a: str
    b: str
    weight: float = Field(ge=0, le=1)
    kind: str


class GraphClusterOut(BaseModel):
    """Targets that share infrastructure."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    id: str
    members: list[str]
    confidence: float = Field(ge=0, le=1)
    explanation: str


class GraphResponse(BaseModel):
    """Case graph. ``version`` is 0 before the first investigation."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    version: int = Field(ge=0)
    nodes: list[GraphNodeOut]
    edges: list[GraphEdgeOut]
    clusters: list[GraphClusterOut]
    insight: str


class LedgerEntryOut(BaseModel):
    """One ledger entry in contract order."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    seq: int
    ts: str
    event_type: str
    payload: dict[str, Any]
    prev_hash: str
    entry_hash: str


class LedgerPage(BaseModel):
    """Ledger page, including the signed head over the full chain."""

    model_config = _FROZEN

    entries: list[LedgerEntryOut]
    next_cursor: str | None
    head_hash: str
    signature: str


class KeyStatus(BaseModel):
    """One TinyFish key as shown by ``GET /health/keys``."""

    model_config = _FROZEN

    label: str
    state: KeyStateName
    in_flight: int = Field(ge=0)
    runs_served: int = Field(ge=0)
