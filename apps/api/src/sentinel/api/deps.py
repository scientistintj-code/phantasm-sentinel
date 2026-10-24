"""FastAPI dependencies."""

from typing import Annotated

from fastapi import Depends, Request

from sentinel.core.config import Settings, get_settings


def get_request_settings(request: Request) -> Settings:
    """Return the settings bound to this application."""
    configured = getattr(request.app.state, "settings", None)
    if isinstance(configured, Settings):
        return configured
    return get_settings()


SettingsDep = Annotated[Settings, Depends(get_request_settings)]
