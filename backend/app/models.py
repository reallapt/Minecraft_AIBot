from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BotStatus(StrEnum):
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    ERROR = "error"
    STUCK = "stuck"
    OFFLINE = "offline"


class CommandType(StrEnum):
    RUN_TASK = "run_task"
    PAUSE = "pause"
    RESUME = "resume"
    STOP = "stop"
    SCREENSHOT = "screenshot"
    INVENTORY = "inventory"
    ADD_BOT = "add_bot"
    REMOVE_BOT = "remove_bot"


class BotRegistration(StrictModel):
    bot_id: str = Field(min_length=1, max_length=128)
    display_name: str | None = Field(default=None, max_length=128)
    game_server: str | None = Field(default=None, max_length=128)
    status: BotStatus = BotStatus.IDLE
    metadata: dict[str, Any] = Field(default_factory=dict)


class BotRecord(BotRegistration):
    agent_id: str | None = Field(default=None, max_length=128)
    current_task_id: str | None = Field(default=None, max_length=128)
    current_step: int | None = Field(default=None, ge=0)
    hp: float | None = Field(default=None, ge=0)
    position: str | None = Field(default=None, max_length=512)
    error: str | None = Field(default=None, max_length=2000)
    updated_at: datetime = Field(default_factory=utc_now)


class ManualBotCreate(StrictModel):
    bot_id: str = Field(min_length=1, max_length=128)
    display_name: str | None = Field(default=None, max_length=128)
    game_server: str | None = Field(default=None, max_length=128)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentRegistration(StrictModel):
    type: Literal["register"]
    agent_id: str = Field(min_length=1, max_length=128)
    node_name: str = Field(min_length=1, max_length=128)
    version: str = Field(min_length=1, max_length=64)
    capabilities: list[str] = Field(default_factory=list)
    bots: list[BotRegistration] = Field(default_factory=list)


class AgentHeartbeat(StrictModel):
    type: Literal["heartbeat"]
    agent_id: str = Field(min_length=1, max_length=128)


class AgentStatusUpdate(StrictModel):
    type: Literal["status"]
    bot_id: str = Field(min_length=1, max_length=128)
    status: BotStatus
    current_task_id: str | None = Field(default=None, max_length=128)
    current_step: int | None = Field(default=None, ge=0)
    hp: float | None = Field(default=None, ge=0)
    position: str | None = Field(default=None, max_length=512)
    error: str | None = Field(default=None, max_length=2000)


class AgentTaskResult(StrictModel):
    type: Literal["task_result"]
    bot_id: str = Field(min_length=1, max_length=128)
    task_id: str = Field(min_length=1, max_length=128)
    success: bool
    error: str | None = Field(default=None, max_length=2000)


class InventoryItem(StrictModel):
    slot: int = Field(default=-1, ge=-1)
    name: str
    display_name: str | None = Field(default=None, max_length=128)
    count: int = Field(default=1, ge=0)


class AgentInventoryReport(StrictModel):
    type: Literal["inventory_report"]
    bot_id: str = Field(min_length=1, max_length=128)
    items: list[InventoryItem] = Field(default_factory=list)
    armor: list[InventoryItem] = Field(default_factory=list)
    offhand: InventoryItem | None = None
    held_item: InventoryItem | None = None


class CommandRequest(StrictModel):
    type: CommandType = CommandType.RUN_TASK
    task: str | None = Field(default=None, min_length=1, max_length=128)
    params: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def require_task_for_run_task(self) -> "CommandRequest":
        if self.type is CommandType.RUN_TASK and self.task is None:
            raise ValueError("task is required when type is run_task")
        return self


class CommandEnvelope(StrictModel):
    id: str
    type: CommandType
    bot_id: str
    task: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    issued_at: datetime = Field(default_factory=utc_now)


class EventEnvelope(StrictModel):
    id: str
    type: str
    occurred_at: datetime = Field(default_factory=utc_now)
    payload: dict[str, Any] = Field(default_factory=dict)


class HealthResponse(StrictModel):
    status: Literal["ok"] = "ok"
    connected_agents: int
    known_bots: int


class DashboardSnapshot(StrictModel):
    bots: list[BotRecord]
    connected_agents: int
