from __future__ import annotations

import logging
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect, status
from pydantic import ValidationError

from .manager import (
    AgentOwnershipError,
    AgentUnavailableError,
    BotClaimedError,
    BotManager,
    BotNotFoundError,
)
from .models import (
    AgentHeartbeat,
    AgentInventoryReport,
    AgentRegistration,
    AgentStatusUpdate,
    AgentTaskResult,
)
from .security import authorize_websocket


logger = logging.getLogger(__name__)


async def agent_websocket(websocket: WebSocket) -> None:
    settings = websocket.app.state.settings
    if not await authorize_websocket(websocket, settings):
        return

    await websocket.accept()
    manager: BotManager = websocket.app.state.bot_manager
    agent_id: str | None = None
    try:
        registration = AgentRegistration.model_validate(await websocket.receive_json())
        agent_id = registration.agent_id
        await manager.register_agent(registration, websocket)
        await websocket.send_json(
            {
                "type": "registered",
                "agent_id": agent_id,
                "heartbeat_timeout_seconds": settings.heartbeat_timeout_seconds,
            }
        )

        while True:
            raw_message = await websocket.receive_json()
            await _handle_agent_message(manager, agent_id, websocket, raw_message)
    except WebSocketDisconnect:
        pass
    except ValidationError as error:
        await _send_protocol_error(websocket, error.errors())
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
    except (
        AgentOwnershipError,
        AgentUnavailableError,
        BotClaimedError,
        BotNotFoundError,
        ValueError,
    ) as error:
        logger.warning("Agent message rejected (%s): %s", type(error).__name__, error)
        await _send_protocol_error(websocket, {"message": str(error)})
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
    except Exception:
        logger.exception("Agent websocket failed")
        try:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        except RuntimeError:
            pass
    finally:
        if agent_id is not None:
            await manager.disconnect_agent(agent_id, websocket)


async def dashboard_websocket(websocket: WebSocket) -> None:
    settings = websocket.app.state.settings
    if not await authorize_websocket(websocket, settings):
        return

    await websocket.accept()
    manager: BotManager = websocket.app.state.bot_manager
    await manager.subscribe_dashboard(websocket)
    try:
        snapshot = await manager.dashboard_snapshot()
        await websocket.send_json(
            {
                "type": "dashboard.snapshot",
                "payload": snapshot.model_dump(mode="json"),
            }
        )
        while True:
            message = await websocket.receive_json()
            if isinstance(message, dict) and message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        await manager.unsubscribe_dashboard(websocket)


async def _handle_agent_message(
    manager: BotManager, agent_id: str, websocket: WebSocket, raw_message: Any
) -> None:
    if not isinstance(raw_message, dict):
        raise ValueError("Agent messages must be JSON objects")

    message_type = raw_message.get("type")
    if message_type == "heartbeat":
        heartbeat = AgentHeartbeat.model_validate(raw_message)
        if heartbeat.agent_id != agent_id:
            raise AgentOwnershipError("heartbeat agent_id does not match connection")
        await manager.record_heartbeat(agent_id, websocket)
        return
    if message_type == "status":
        await manager.update_bot_status(
            agent_id, websocket, AgentStatusUpdate.model_validate(raw_message)
        )
        return
    if message_type == "task_result":
        await manager.record_task_result(
            agent_id, websocket, AgentTaskResult.model_validate(raw_message)
        )
        return
    if message_type == "inventory_report":
        await manager.record_inventory(
            agent_id, websocket, AgentInventoryReport.model_validate(raw_message)
        )
        return

    raise ValueError("Unsupported agent message type")


async def _send_protocol_error(websocket: WebSocket, detail: Any) -> None:
    try:
        await websocket.send_json({"type": "protocol_error", "detail": detail})
    except RuntimeError:
        pass
