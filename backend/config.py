from __future__ import annotations

import os

from pydantic_settings import BaseSettings, SettingsConfigDict

_INSECURE_JWT_SECRET = "change-this-secret-key"


class Settings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8080
    claude_command: str = "claude"
    kilo_command: str = "kilo"
    opencode_command: str = "opencode"
    password: str = "changeme"
    jwt_secret: str = _INSECURE_JWT_SECRET
    jwt_expire_hours: int = 72
    db_path: str = "sessions.db"
    allowed_origins: str = "*"

    model_config = SettingsConfigDict(
        env_prefix="CCR_",
        env_file=os.environ.get("CCR_ENV_FILE"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
