from pydantic_settings import BaseSettings

_INSECURE_JWT_SECRET = "change-this-secret-key"


class Settings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8080
    claude_command: str = "claude"
    password: str = "changeme"
    jwt_secret: str = _INSECURE_JWT_SECRET
    jwt_expire_hours: int = 72
    db_path: str = "sessions.db"
    allowed_origins: str = "*"

    model_config = {"env_prefix": "CCR_"}


settings = Settings()
