"""Liveness and key-pool routes."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from sentinel import __version__
from sentinel.api.deps import RuntimeDep
from sentinel.api.schemas import KeyStatus
from sentinel.tinyfish import KeyState

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    """Liveness payload."""

    model_config = ConfigDict(frozen=True)

    status: Literal["ok"]
    version: str


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Report that the process is up and which build is running."""
    return HealthResponse(status="ok", version=__version__)


@router.get("/v1/health/keys", response_model=list[KeyStatus])
async def key_pool(runtime: RuntimeDep) -> list[KeyStatus]:
    """Report each TinyFish key without returning secret material."""
    snapshots = await runtime.pool.snapshot()
    return [
        KeyStatus(
            label=item.label,
            state=_public_state(item.state),
            in_flight=item.in_flight,
            runs_served=item.runs_served,
        )
        for item in snapshots
    ]


def _public_state(state: KeyState) -> Literal["healthy", "cooling", "exhausted", "invalid"]:
    if state is KeyState.COOLING_DOWN:
        return "cooling"
    if state is KeyState.HEALTHY:
        return "healthy"
    if state is KeyState.EXHAUSTED:
        return "exhausted"
    return "invalid"
