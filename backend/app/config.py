from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlsplit


DEFAULT_CORS_ORIGINS = ("http://localhost:5173", "http://localhost:3000")


def _parse_positive_int(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None or not raw_value.strip():
        return default

    value = int(raw_value)
    if value <= 0:
        raise ValueError(f"{name} must be greater than zero")
    return value


def _parse_positive_float(name: str, default: float) -> float:
    raw_value = os.getenv(name)
    if raw_value is None or not raw_value.strip():
        return default

    value = float(raw_value)
    if value <= 0:
        raise ValueError(f"{name} must be greater than zero")
    return value


def _parse_origins(value: str | None) -> tuple[str, ...]:
    if value is None or not value.strip():
        return DEFAULT_CORS_ORIGINS
    return tuple(origin.strip() for origin in value.split(",") if origin.strip())


def _parse_ollama_base_url(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None

    base_url = value.strip().rstrip("/")
    parsed = urlsplit(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(
            "MC_OLLAMA_BASE_URL must be an absolute http:// or https:// URL"
        )
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("MC_OLLAMA_BASE_URL must not contain credentials")
    if parsed.query or parsed.fragment:
        raise ValueError("MC_OLLAMA_BASE_URL must not contain a query or fragment")

    # Ollama's OpenAI-compatible API lives below /v1. Accept either the server
    # root or a URL that already includes /v1 so deployment config stays simple.
    if not parsed.path or parsed.path == "/":
        return f"{base_url}/v1"
    return base_url


@dataclass(frozen=True, slots=True)
class Settings:
    api_key: str | None = None
    cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS
    heartbeat_timeout_seconds: int = 45
    event_history_size: int = 300
    ollama_base_url: str | None = None
    ollama_model: str = "qwen3:8b"
    ollama_api_key: str | None = None
    ollama_timeout_seconds: float = 90.0
    ai_decision_history_size: int = 300
    ai_max_tool_rounds: int = 4

    @classmethod
    def from_environment(cls) -> "Settings":
        api_key = os.getenv("MC_API_KEY", "").strip() or None
        return cls(
            api_key=api_key,
            cors_origins=_parse_origins(os.getenv("MC_CORS_ORIGINS")),
            heartbeat_timeout_seconds=_parse_positive_int(
                "MC_HEARTBEAT_TIMEOUT_SECONDS", 45
            ),
            ollama_base_url=_parse_ollama_base_url(os.getenv("MC_OLLAMA_BASE_URL")),
            ollama_model=os.getenv("MC_OLLAMA_MODEL", "qwen3:8b").strip()
            or "qwen3:8b",
            ollama_api_key=os.getenv("MC_OLLAMA_API_KEY", "").strip() or None,
            ollama_timeout_seconds=_parse_positive_float(
                "MC_OLLAMA_TIMEOUT_SECONDS", 90.0
            ),
            ai_decision_history_size=_parse_positive_int(
                "MC_AI_DECISION_HISTORY_SIZE", 300
            ),
            ai_max_tool_rounds=_parse_positive_int("MC_AI_MAX_TOOL_ROUNDS", 4),
        )
