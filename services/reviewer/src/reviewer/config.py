"""Environment configuration, validated once at startup."""

from typing import Literal

from pydantic import Field, RedisDsn, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

LogLevel = Literal["fatal", "error", "warn", "info", "debug", "verbose"]


class Settings(BaseSettings):
    """Reviewer settings read from environment variables (names are upper-case)."""

    model_config = SettingsConfigDict(extra="ignore", frozen=True)

    redis_url: RedisDsn
    reviewer_port: int = Field(default=8000, ge=1, le=65535)
    log_level: LogLevel = "info"


class ConfigError(Exception):
    """Invalid configuration. The message names variables, never their values."""

    def __init__(self, problems: list[str]) -> None:
        self.problems = problems
        super().__init__("Invalid configuration:\n" + "\n".join(f"  - {p}" for p in problems))


def load_settings() -> Settings:
    """Read and validate settings from the environment.

    Pydantic's default error text echoes the input value, which for REDIS_URL can
    contain a password, so errors are rebuilt from the location and message only.
    """
    try:
        return Settings()
    except ValidationError as exc:
        problems = [
            f"{'.'.join(str(part) for part in err['loc']).upper()}: {err['msg']}"
            for err in exc.errors(include_input=False, include_url=False, include_context=False)
        ]
        raise ConfigError(problems) from None
