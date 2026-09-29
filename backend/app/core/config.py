from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[2]
ENV_FILE = BACKEND_DIR / ".env"


class Settings(BaseSettings):
    # ========================================================
    # APPLICATION
    # ========================================================

    app_name: str = "Land Acquisition AI"
    app_env: str = "development"
    frontend_url: str = "http://localhost:5173"

    # ========================================================
    # DATABASE
    # ========================================================

    # Supabase Session Pooler URL.
    #
    # Example structure:
    #
    # postgresql+psycopg://user:password@host:5432/postgres?sslmode=require
    #
    database_url: str

    # ========================================================
    # AUTHENTICATION
    # ========================================================

    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    # ========================================================
    # ACQUITWIN COPILOT / AI AGENT
    # ========================================================

    # IMPORTANT:
    # Keep this key only in backend/.env.
    # Never expose it in React/frontend code.
    openai_api_key: str = ""

    # The model can be changed later without changing Python code.
    openai_model: str = "gpt-5.6-luna"

    # OpenAI API base URL.
    openai_base_url: str = "https://api.openai.com/v1"

    # Timeout for Copilot requests.
    openai_timeout_seconds: float = 45.0

    # ========================================================
    # PYDANTIC SETTINGS CONFIGURATION
    # ========================================================

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()