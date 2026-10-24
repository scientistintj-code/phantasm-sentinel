"""Liveness route."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from sentinel import __version__

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
