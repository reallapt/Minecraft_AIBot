from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import WebSocket

from .config import Settings
from .models import (
    AgentInventoryReport,
    AgentRegistration,
    AgentStatusUpdate,
    AgentTaskResult,
    BotRecord,
    BotStatus,
    CommandEnvelope,
    CommandRequest,
    CommandType,
    DashboardSnapshot,
    EventEnvelope,
    ManualBotCreate,
    utc_now,
)


class BotNotFoundError(Exception):
    pass


class BotAlreadyExistsError(Exception):
    pass


class AgentUnavailableError(Exception):
    pass


class AgentOwnershipError(Exception):
    pass


class InventoryTimeoutError(Exception):
    pass


class BotClaimedError(Exception):
    pass


@dataclass
class AgentSession:
    agent_id: str
    node_name: str
    version: str
    capabilities: list[str]
    websocket: WebSocket
    connected_at: datetime = field(default_factory=utc_now)
    last_seen_at: datetime = field(default_factory=utc_now)
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


@dataclass
class DashboardSession:
    websocket: WebSocket
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class BotManager:
    """In-memory registry and command broker for currently connected agents."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._agents: dict[str, AgentSession] = {}
        self._bots: dict[str, BotRecord] = {}
        self._inventory_cache: dict[str, AgentInventoryReport] = {}
        self._inventory_waiters: dict[str, asyncio.Future[AgentInventoryReport]] = {}
        self._dashboards: dict[int, DashboardSession] = {}
        self._events: deque[EventEnvelope] = deque(maxlen=settings.event_history_size)
        self._lock = asyncio.Lock()

    async def register_agent(
        self, registration: AgentRegistration, websocket: WebSocket
    ) -> None:
        session = AgentSession(
            agent_id=registration.agent_id,
            node_name=registration.node_name,
            version=registration.version,
            capabilities=registration.capabilities,
            websocket=websocket,
        )
        events: list[EventEnvelope] = []
        reported_bot_ids = {bot.bot_id for bot in registration.bots}

        async with self._lock:
            for registration_bot in registration.bots:
                existing_record = self._bots.get(registration_bot.bot_id)
                if (
                    existing_record is not None
                    and existing_record.agent_id not in (None, registration.agent_id)
                    and existing_record.agent_id in self._agents
                ):
                    raise BotClaimedError(registration_bot.bot_id)

            self._agents[registration.agent_id] = session
            now = utc_now()
            for registration_bot in registration.bots:
                record = BotRecord(
                    **registration_bot.model_dump(),
                    agent_id=registration.agent_id,
                    updated_at=now,
                )
                self._bots[record.bot_id] = record
                events.append(self._event("bot.registered", record.model_dump(mode="json")))

            for bot_id, record in list(self._bots.items()):
                if record.agent_id != registration.agent_id or bot_id in reported_bot_ids:
                    continue
                offline_record = record.model_copy(
                    update={
                        "status": BotStatus.OFFLINE,
                        "current_task_id": None,
                        "updated_at": now,
                    }
                )
                self._bots[bot_id] = offline_record
                events.append(
                    self._event("bot.updated", offline_record.model_dump(mode="json"))
                )

            events.append(
                self._event(
                    "agent.registered",
                    {
                        "agent_id": registration.agent_id,
                        "node_name": registration.node_name,
                        "bot_count": len(registration.bots),
                    },
                )
            )

        await self._publish_many(events)

    async def register_manual_bot(self, request: ManualBotCreate) -> BotRecord:
        async with self._lock:
            if request.bot_id in self._bots:
                raise BotAlreadyExistsError(request.bot_id)
            record = BotRecord(
                **request.model_dump(), agent_id=None, status=BotStatus.OFFLINE
            )
            self._bots[record.bot_id] = record

        await self._publish(self._event("bot.registered", record.model_dump(mode="json")))
        # 通知在线执行代理动态创建假人（真正在 Minecraft 里连接假人）
        await self._notify_agent_add_bot(record)
        return record

    async def remove_bot(self, bot_id: str) -> None:
        async with self._lock:
            record = self._bots.get(bot_id)
            if record is None:
                raise BotNotFoundError(bot_id)
            del self._bots[bot_id]
            self._inventory_cache.pop(bot_id, None)
            agent_id = record.agent_id

        await self._publish(self._event("bot.removed", {"bot_id": bot_id}))
        if agent_id is not None:
            await self._notify_agent_remove_bot(bot_id, agent_id)

    async def _notify_agent_add_bot(self, record: BotRecord) -> None:
        """把新机器人的创建命令推送给第一个在线 agent（agent 动态 spawn 假人）。"""
        async with self._lock:
            sessions = list(self._agents.items())
        if not sessions:
            return
        agent_id, session = sessions[0]
        command = CommandEnvelope(
            id=f"cmd_{uuid4().hex}",
            type=CommandType.ADD_BOT,
            bot_id=record.bot_id,
            params={
                "bot_id": record.bot_id,
                "display_name": record.display_name,
                "game_server": record.game_server,
                "username": record.metadata.get("username") or record.display_name or record.bot_id,
                "password": record.metadata.get("password"),
            },
        )
        try:
            async with session.send_lock:
                await session.websocket.send_json(command.model_dump(mode="json"))
        except Exception:
            await self.disconnect_agent(agent_id, session.websocket)
            return
        await self._publish(
            self._event("command.dispatched", command.model_dump(mode="json"))
        )

    async def _notify_agent_remove_bot(self, bot_id: str, agent_id: str) -> None:
        """通知在线 agent 停止并移除假人连接。"""
        session = self._agents.get(agent_id)
        if session is None:
            return
        command = CommandEnvelope(
            id=f"cmd_{uuid4().hex}",
            type=CommandType.REMOVE_BOT,
            bot_id=bot_id,
            params={},
        )
        try:
            async with session.send_lock:
                await session.websocket.send_json(command.model_dump(mode="json"))
        except Exception:
            await self.disconnect_agent(agent_id, session.websocket)
            return
        await self._publish(
            self._event("command.dispatched", command.model_dump(mode="json"))
        )

    async def list_bots(self) -> list[BotRecord]:
        async with self._lock:
            return sorted(self._bots.values(), key=lambda bot: bot.bot_id)

    async def get_bot(self, bot_id: str) -> BotRecord:
        async with self._lock:
            record = self._bots.get(bot_id)
            if record is None:
                raise BotNotFoundError(bot_id)
            return record

    async def update_bot_status(
        self, agent_id: str, websocket: WebSocket, update: AgentStatusUpdate
    ) -> BotRecord:
        async with self._lock:
            record = self._require_owned_bot(agent_id, websocket, update.bot_id)
            changes = {"updated_at": utc_now()}
            for field_name in (
                "status",
                "current_task_id",
                "current_step",
                "hp",
                "position",
                "error",
            ):
                if field_name in update.model_fields_set:
                    changes[field_name] = getattr(update, field_name)
            updated_record = record.model_copy(update=changes)
            self._bots[update.bot_id] = updated_record

        await self._publish(
            self._event("bot.updated", updated_record.model_dump(mode="json"))
        )
        return updated_record

    async def record_task_result(
        self, agent_id: str, websocket: WebSocket, result: AgentTaskResult
    ) -> BotRecord:
        async with self._lock:
            record = self._require_owned_bot(agent_id, websocket, result.bot_id)
            status = BotStatus.IDLE if result.success else BotStatus.ERROR
            updated_record = record.model_copy(
                update={
                    "status": status,
                    "current_task_id": None,
                    "error": result.error,
                    "updated_at": utc_now(),
                }
            )
            self._bots[result.bot_id] = updated_record

        event_type = "task.completed" if result.success else "task.failed"
        await self._publish_many(
            [
                self._event(
                    event_type,
                    {
                        "bot_id": result.bot_id,
                        "task_id": result.task_id,
                        "error": result.error,
                    },
                ),
                self._event("bot.updated", updated_record.model_dump(mode="json")),
            ]
        )
        return updated_record

    async def record_heartbeat(self, agent_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            session = self._agents.get(agent_id)
            if session is None or session.websocket is not websocket:
                raise AgentUnavailableError(agent_id)
            session.last_seen_at = utc_now()

    async def record_inventory(
        self, agent_id: str, websocket: WebSocket, report: AgentInventoryReport
    ) -> AgentInventoryReport:
        """缓存 agent 上报的库存，并唤醒等待中的 GET /inventory 请求。"""
        async with self._lock:
            self._require_owned_bot(agent_id, websocket, report.bot_id)
            self._inventory_cache[report.bot_id] = report
            waiter = self._inventory_waiters.pop(report.bot_id, None)
        if waiter is not None and not waiter.done():
            waiter.set_result(report)
        await self._publish(
            self._event("inventory.updated", report.model_dump(mode="json"))
        )
        return report

    async def request_inventory(
        self, bot_id: str, timeout: float = 12.0
    ) -> AgentInventoryReport:
        """向 agent 请求一次实时库存：发 inventory 命令并等待 inventory_report。"""
        async with self._lock:
            record = self._bots.get(bot_id)
            if record is None:
                raise BotNotFoundError(bot_id)
            if record.agent_id is None:
                raise AgentUnavailableError(bot_id)
            session = self._agents.get(record.agent_id)
            if session is None or record.status is BotStatus.OFFLINE:
                raise AgentUnavailableError(bot_id)
            waiter = asyncio.get_running_loop().create_future()
            self._inventory_waiters[bot_id] = waiter
            command = CommandEnvelope(
                id=f"cmd_{uuid4().hex}",
                type="inventory",
                bot_id=bot_id,
            )

        try:
            async with session.send_lock:
                await session.websocket.send_json(command.model_dump(mode="json"))
        except Exception as error:
            async with self._lock:
                self._inventory_waiters.pop(bot_id, None)
            await self.disconnect_agent(record.agent_id, session.websocket)
            raise AgentUnavailableError(bot_id) from error

        await self._publish(
            self._event("command.dispatched", command.model_dump(mode="json"))
        )
        try:
            return await asyncio.wait_for(waiter, timeout=timeout)
        except TimeoutError as error:
            async with self._lock:
                self._inventory_waiters.pop(bot_id, None)
            raise InventoryTimeoutError(bot_id) from error

    async def send_command(
        self, bot_id: str, request: CommandRequest
    ) -> CommandEnvelope:
        async with self._lock:
            record = self._bots.get(bot_id)
            if record is None:
                raise BotNotFoundError(bot_id)
            if record.agent_id is None:
                raise AgentUnavailableError(bot_id)
            session = self._agents.get(record.agent_id)
            if session is None or record.status is BotStatus.OFFLINE:
                raise AgentUnavailableError(bot_id)
            command = CommandEnvelope(
                id=f"cmd_{uuid4().hex}",
                type=request.type,
                bot_id=bot_id,
                task=request.task,
                params=request.params,
            )

        try:
            async with session.send_lock:
                await session.websocket.send_json(command.model_dump(mode="json"))
        except Exception as error:
            await self.disconnect_agent(record.agent_id, session.websocket)
            raise AgentUnavailableError(bot_id) from error

        await self._publish(
            self._event("command.dispatched", command.model_dump(mode="json"))
        )
        return command

    async def disconnect_agent(
        self, agent_id: str, websocket: WebSocket | None = None
    ) -> None:
        events: list[EventEnvelope] = []
        async with self._lock:
            session = self._agents.get(agent_id)
            if session is None:
                return
            if websocket is not None and session.websocket is not websocket:
                return

            del self._agents[agent_id]
            now = utc_now()
            for bot_id, record in list(self._bots.items()):
                if record.agent_id != agent_id:
                    continue
                offline_record = record.model_copy(
                    update={
                        "status": BotStatus.OFFLINE,
                        "current_task_id": None,
                        "updated_at": now,
                    }
                )
                self._bots[bot_id] = offline_record
                events.append(
                    self._event("bot.updated", offline_record.model_dump(mode="json"))
                )
            events.append(self._event("agent.disconnected", {"agent_id": agent_id}))

        await self._publish_many(events)

    async def expire_stale_agents(self) -> None:
        deadline = utc_now() - timedelta(seconds=self._settings.heartbeat_timeout_seconds)
        async with self._lock:
            stale_sessions = [
                (agent_id, session.websocket)
                for agent_id, session in self._agents.items()
                if session.last_seen_at < deadline
            ]

        for agent_id, websocket in stale_sessions:
            await self.disconnect_agent(agent_id, websocket)

    async def dashboard_snapshot(self) -> DashboardSnapshot:
        bots = await self.list_bots()
        async with self._lock:
            connected_agents = len(self._agents)
        return DashboardSnapshot(bots=bots, connected_agents=connected_agents)

    async def health_counts(self) -> tuple[int, int]:
        await self.expire_stale_agents()
        async with self._lock:
            return len(self._agents), len(self._bots)

    async def recent_events(self, limit: int) -> list[EventEnvelope]:
        async with self._lock:
            return list(self._events)[-limit:]

    async def publish_event(self, event_type: str, payload: dict) -> EventEnvelope:
        """Publish an auditable control-plane event to REST and dashboard consumers."""
        event = self._event(event_type, payload)
        await self._publish(event)
        return event

    async def subscribe_dashboard(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._dashboards[id(websocket)] = DashboardSession(websocket=websocket)

    async def unsubscribe_dashboard(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._dashboards.pop(id(websocket), None)

    async def monitor_until_stopped(self, stop_event: asyncio.Event) -> None:
        interval = min(5, max(1, self._settings.heartbeat_timeout_seconds // 3))
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=interval)
            except TimeoutError:
                await self.expire_stale_agents()

    def _require_owned_bot(
        self, agent_id: str, websocket: WebSocket, bot_id: str
    ) -> BotRecord:
        session = self._agents.get(agent_id)
        if session is None or session.websocket is not websocket:
            raise AgentUnavailableError(agent_id)
        record = self._bots.get(bot_id)
        if record is None:
            raise BotNotFoundError(bot_id)
        if record.agent_id != agent_id:
            raise AgentOwnershipError(bot_id)
        return record

    @staticmethod
    def _event(event_type: str, payload: dict) -> EventEnvelope:
        return EventEnvelope(id=f"evt_{uuid4().hex}", type=event_type, payload=payload)

    async def _publish_many(self, events: list[EventEnvelope]) -> None:
        for event in events:
            await self._publish(event)

    async def _publish(self, event: EventEnvelope) -> None:
        async with self._lock:
            self._events.append(event)
            sessions = list(self._dashboards.values())

        failed_websockets: list[WebSocket] = []
        for session in sessions:
            try:
                async with session.send_lock:
                    await session.websocket.send_json(event.model_dump(mode="json"))
            except Exception:
                failed_websockets.append(session.websocket)

        for websocket in failed_websockets:
            await self.unsubscribe_dashboard(websocket)
