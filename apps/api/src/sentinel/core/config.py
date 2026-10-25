"""Process settings loaded from the environment."""

from functools import lru_cache
from typing import Annotated
from urllib.parse import urlsplit

from pydantic import AnyHttpUrl, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_DATABASE_SCHEMES = ("postgresql+asyncpg://", "sqlite+aiosqlite://")


def _parse_api_keys(value: object) -> tuple[SecretStr, ...]:
    """Parse a comma-separated key pool. A blank value means no keys are configured."""
    if value is None:
        return ()
    if isinstance(value, str):
        if value.strip() == "":
            return ()
        items: list[object] = list(value.split(","))
    elif isinstance(value, list | tuple):
        items = list(value)
    else:
        raise ValueError("must be a comma-separated string")

    keys: list[SecretStr] = []
    for item in items:
        if isinstance(item, SecretStr):
            text = item.get_secret_value().strip()
        elif isinstance(item, str):
            text = item.strip()
        else:
            raise ValueError("entries must be strings")
        if text == "":
            raise ValueError("must not contain an empty entry")
        keys.append(SecretStr(text))
    return tuple(keys)


def _normalize_origin(origin: str) -> str:
    parsed = urlsplit(origin.strip())
    if parsed.scheme.lower() not in {"http", "https"} or parsed.hostname in {None, "", "*"}:
        raise ValueError("must be an explicit http or https origin")
    if (
        parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("must not include credentials, a query, or a fragment")
    if parsed.path not in {"", "/"}:
        raise ValueError("must not include a path")
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("must include a valid port") from exc
    host = parsed.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    port_suffix = f":{port}" if port is not None else ""
    return f"{parsed.scheme.lower()}://{host}{port_suffix}"


def _parse_origins(value: object) -> tuple[str, ...]:
    if isinstance(value, str):
        items: list[object] = list(value.split(","))
    elif isinstance(value, list | tuple):
        items = list(value)
    else:
        raise ValueError("must be a comma-separated string")

    origins: list[str] = []
    for item in items:
        if not isinstance(item, str):
            raise ValueError("entries must be strings")
        text = item.strip()
        if text == "":
            raise ValueError("must not contain an empty entry")
        origins.append(_normalize_origin(text))
    return tuple(origins)


class Settings(BaseSettings):
    """Environment variables declared in the repository `.env.example`."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
        frozen=True,
    )

    tinyfish_api_keys: Annotated[tuple[SecretStr, ...], NoDecode] = Field(default=(), repr=False)
    tinyfish_agent_base_url: AnyHttpUrl = AnyHttpUrl("https://agent.tinyfish.ai")
    database_url: SecretStr = Field(repr=False)
    evidence_signing_secret: SecretStr = Field(repr=False)
    allowed_origins: Annotated[tuple[str, ...], NoDecode] = ("http://localhost:3000",)
    demo_replay: bool = False
    max_steps_per_run: int = Field(default=40, gt=0)
    max_seconds_per_run: int = Field(default=240, gt=0)

    @field_validator("tinyfish_api_keys", mode="before")
    @classmethod
    def parse_tinyfish_api_keys(cls, value: object) -> tuple[SecretStr, ...]:
        return _parse_api_keys(value)

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def parse_allowed_origins(cls, value: object) -> tuple[str, ...]:
        return _parse_origins(value)

    @field_validator("database_url")
    @classmethod
    def database_url_uses_async_driver(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value().startswith(_DATABASE_SCHEMES):
            raise ValueError("must use the postgresql+asyncpg or sqlite+aiosqlite scheme")
        return value

    @field_validator("evidence_signing_secret")
    @classmethod
    def signing_secret_is_present(cls, value: SecretStr) -> SecretStr:
        if value.get_secret_value().strip() == "":
            raise ValueError("must not be empty")
        return value

    @field_validator("tinyfish_agent_base_url")
    @classmethod
    def agent_base_url_has_no_userinfo(cls, value: AnyHttpUrl) -> AnyHttpUrl:
        if value.username is not None or value.password is not None:
            raise ValueError("must not include credentials")
        return value

    def __repr__(self) -> str:
        return (
            f"{self.__class__.__name__}("
            f"tinyfish_api_keys=<{len(self.tinyfish_api_keys)} secret(s)>, "
            f"tinyfish_agent_base_url={self.tinyfish_agent_base_url!s}, "
            "database_url='**********', "
            "evidence_signing_secret='**********', "
            f"allowed_origins={self.allowed_origins!r}, "
            f"demo_replay={self.demo_replay!r}, "
            f"max_steps_per_run={self.max_steps_per_run!r}, "
            f"max_seconds_per_run={self.max_seconds_per_run!r})"
        )

    def __str__(self) -> str:
        return repr(self)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings, loaded once."""
    return Settings()
