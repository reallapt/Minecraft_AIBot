from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from .ai import (
    AIConfigResponse,
    AIDecisionLog,
    AIDecisionService,
    AIHealthResponse,
    AIModelNotAllowedError,
    AIProviderError,
    AIProviderNotConfiguredError,
    AIProviderTimeoutError,
    CreateAIDecisionRequest,
    OpenAIChatCompletionRequest,
    AIProviderStatus,
)
from .manager import (
    AgentUnavailableError,
    BotAlreadyExistsError,
    BotManager,
    BotNotFoundError,
)
from .models import (
    AgentInventoryReport,
    BotRecord,
    CommandEnvelope,
    CommandRequest,
    EventEnvelope,
    ManualBotCreate,
)
from .security import require_api_key


router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_api_key)])


def get_manager(request: Request) -> BotManager:
    return request.app.state.bot_manager


def get_ai_service(request: Request) -> AIDecisionService:
    return request.app.state.ai_service


@router.get("/bots", response_model=list[BotRecord])
async def list_bots(manager: BotManager = Depends(get_manager)) -> list[BotRecord]:
    return await manager.list_bots()


@router.post("/bots", response_model=BotRecord, status_code=status.HTTP_201_CREATED)
async def register_manual_bot(
    bot: ManualBotCreate, manager: BotManager = Depends(get_manager)
) -> BotRecord:
    try:
        return await manager.register_manual_bot(bot)
    except BotAlreadyExistsError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Bot {error.args[0]!r} already exists",
        ) from error


@router.get("/bots/{bot_id}", response_model=BotRecord)
async def get_bot(
    bot_id: str, manager: BotManager = Depends(get_manager)
) -> BotRecord:
    try:
        return await manager.get_bot(bot_id)
    except BotNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bot {error.args[0]!r} was not found",
        ) from error


@router.delete("/bots/{bot_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_bot(
    bot_id: str, manager: BotManager = Depends(get_manager)
) -> None:
    try:
        await manager.remove_bot(bot_id)
    except BotNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bot {error.args[0]!r} was not found",
        ) from error


@router.post("/bots/{bot_id}/commands", response_model=CommandEnvelope)
async def send_command(
    bot_id: str,
    command: CommandRequest,
    manager: BotManager = Depends(get_manager),
) -> CommandEnvelope:
    try:
        return await manager.send_command(bot_id, command)
    except BotNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bot {error.args[0]!r} was not found",
        ) from error
    except AgentUnavailableError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Bot {error.args[0]!r} does not have a connected agent",
        ) from error


@router.get("/bots/{bot_id}/inventory", response_model=AgentInventoryReport)
async def get_bot_inventory(
    bot_id: str,
    manager: BotManager = Depends(get_manager),
) -> AgentInventoryReport:
    """实时请求 agent 上报假人背包（含盔甲/副手），超时约 12 秒。"""
    try:
        return await manager.request_inventory(bot_id)
    except BotNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bot {error.args[0]!r} was not found",
        ) from error
    except AgentUnavailableError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Bot {error.args[0]!r} does not have a connected agent",
        ) from error
    except TimeoutError as error:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"Bot {error.args[0]!r} did not report inventory in time",
        ) from error


@router.get("/events", response_model=list[EventEnvelope])
async def list_events(
    limit: int = Query(default=100, ge=1, le=300),
    manager: BotManager = Depends(get_manager),
) -> list[EventEnvelope]:
    return await manager.recent_events(limit)


@router.get("/ai/status", response_model=AIProviderStatus)
async def get_ai_status(
    service: AIDecisionService = Depends(get_ai_service),
) -> AIProviderStatus:
    """Check the configured remote Ollama OpenAI-compatible API."""
    return await service.status()


@router.get("/ai/config", response_model=AIConfigResponse)
async def get_ai_config(
    service: AIDecisionService = Depends(get_ai_service),
) -> AIConfigResponse:
    """Return non-secret remote Ollama settings for the dashboard."""
    return service.config()


@router.post("/ai/health", response_model=AIHealthResponse)
async def check_ai_health(
    service: AIDecisionService = Depends(get_ai_service),
) -> AIHealthResponse:
    """Test whether remote Ollama has the configured Qwen3 model ready."""
    result = await service.health()
    if result.status != "ok":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=result.detail or result.error or "Remote Ollama is not ready",
        )
    return result


@router.get("/ai/decisions", response_model=list[AIDecisionLog])
async def list_ai_decisions(
    limit: int = Query(default=100, ge=1, le=1_000),
    service: AIDecisionService = Depends(get_ai_service),
) -> list[AIDecisionLog]:
    return await service.recent_decisions(limit)


@router.post("/ai/decisions", response_model=AIDecisionLog)
async def create_ai_decision(
    request: CreateAIDecisionRequest,
    service: AIDecisionService = Depends(get_ai_service),
) -> AIDecisionLog:
    """Run one Qwen decision loop against read-only bot state tools.

    `allow_commands` adds the command-dispatch tool for this request only.
    """
    return await service.create_decision(request)


@router.post("/ai/chat/completions", response_model=dict[str, Any])
async def create_ai_chat_completion(
    completion: OpenAIChatCompletionRequest,
    service: AIDecisionService = Depends(get_ai_service),
) -> dict[str, Any]:
    """Forward a non-streaming OpenAI chat request to the configured Qwen3 model.

    Tool definitions and model tool calls are forwarded unchanged. Tool execution is
    deliberately left to the scheduler/control plane instead of the HTTP endpoint.
    """
    try:
        return await service.chat_completions(completion)
    except AIModelNotAllowedError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=error.public_message,
        ) from error
    except AIProviderNotConfiguredError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=error.public_message,
        ) from error
    except AIProviderTimeoutError as error:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=error.public_message,
        ) from error
    except AIProviderError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=error.public_message,
        ) from error
