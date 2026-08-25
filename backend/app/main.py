from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from .ai import AIDecisionService, OllamaOpenAIClient
from .api import router as api_router
from .config import Settings
from .manager import BotManager
from .models import HealthResponse
from .websocket import agent_websocket, dashboard_websocket


@asynccontextmanager
async def lifespan(app: FastAPI):
    manager = BotManager(app.state.settings)
    app.state.bot_manager = manager
    ollama_client: OllamaOpenAIClient = (
        app.state.ollama_client or OllamaOpenAIClient(app.state.settings)
    )
    app.state.ai_service = AIDecisionService(
        ollama_client,
        manager,
        app.state.settings.ai_decision_history_size,
        app.state.settings.ai_max_tool_rounds,
    )
    stop_event = asyncio.Event()
    monitor_task = asyncio.create_task(manager.monitor_until_stopped(stop_event))
    try:
        yield
    finally:
        stop_event.set()
        await monitor_task
        await app.state.ai_service.aclose()


def create_app(
    settings: Settings | None = None,
    *,
    ollama_client: OllamaOpenAIClient | None = None,
) -> FastAPI:
    app = FastAPI(
        title="MC Bot Controller API",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.settings = settings or Settings.from_environment()
    app.state.ollama_client = ollama_client
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(app.state.settings.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router)

    @app.get("/health", response_model=HealthResponse, tags=["system"])
    async def health(request: Request) -> HealthResponse:
        manager: BotManager = request.app.state.bot_manager
        connected_agents, known_bots = await manager.health_counts()
        return HealthResponse(
            connected_agents=connected_agents,
            known_bots=known_bots,
        )

    @app.websocket("/ws/agents")
    async def agents_socket(websocket: WebSocket) -> None:
        await agent_websocket(websocket)

    @app.websocket("/ws/dashboard")
    async def dashboard_socket(websocket: WebSocket) -> None:
        await dashboard_websocket(websocket)

    return app


app = create_app()
