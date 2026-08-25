from __future__ import annotations

from hmac import compare_digest

from fastapi import HTTPException, Request, WebSocket, status

from .config import Settings


def require_api_key(request: Request) -> None:
    settings: Settings = request.app.state.settings
    if settings.api_key is None:
        return

    supplied_key = request.headers.get("X-API-Key", "")
    if not compare_digest(supplied_key, settings.api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid X-API-Key header is required",
        )


async def authorize_websocket(websocket: WebSocket, settings: Settings) -> bool:
    if settings.api_key is None:
        return True

    supplied_key = websocket.query_params.get("token") or websocket.headers.get(
        "X-API-Key", ""
    )
    if compare_digest(supplied_key, settings.api_key):
        return True

    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
    return False
