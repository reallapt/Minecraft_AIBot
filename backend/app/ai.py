from __future__ import annotations

import asyncio
from collections import deque
from datetime import datetime
import json
from typing import Any, Literal
from uuid import uuid4

import httpx
from pydantic import Field, ValidationError, field_validator, model_validator

from .config import Settings
from .manager import AgentUnavailableError, BotManager, BotNotFoundError
from .models import CommandEnvelope, CommandRequest, StrictModel, utc_now


MAX_OLLAMA_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_MESSAGE_CONTENT_CHARS = 32_000
MAX_TOTAL_MESSAGE_CONTENT_CHARS = 64_000
MAX_TOOL_RESULT_CHARS = 8_000
MAX_TOOL_CALLS_PER_RESPONSE = 16
MAX_AUDIT_MESSAGES = 64
MAX_AUDIT_MESSAGE_CHARS = 8_000
MAX_AUDIT_VALUE_CHARS = 8_000


class AIProviderError(Exception):
    """Base error for failures communicating with the configured AI provider."""

    public_message = "The AI provider is unavailable"


class AIProviderNotConfiguredError(AIProviderError):
    public_message = "Remote Ollama is not configured"


class AIProviderTimeoutError(AIProviderError):
    public_message = "Remote Ollama did not respond before the timeout"


class AIProviderUnavailableError(AIProviderError):
    public_message = "Remote Ollama could not be reached"


class AIProviderResponseError(AIProviderError):
    def __init__(self, upstream_status: int | None = None) -> None:
        self.upstream_status = upstream_status
        if upstream_status is None:
            self.public_message = "Remote Ollama returned an invalid response"
        else:
            self.public_message = f"Remote Ollama returned HTTP {upstream_status}"
        super().__init__(self.public_message)


class AIModelNotAllowedError(AIProviderError):
    def __init__(self, requested_model: str, configured_model: str) -> None:
        self.requested_model = requested_model
        self.configured_model = configured_model
        self.public_message = f"Only the configured model {configured_model!r} is available"
        super().__init__(self.public_message)


class OpenAIFunctionDefinition(StrictModel):
    name: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    description: str | None = Field(default=None, max_length=4_000)
    parameters: dict[str, Any] = Field(default_factory=dict)
    strict: bool | None = None


class OpenAIToolDefinition(StrictModel):
    type: Literal["function"]
    function: OpenAIFunctionDefinition


class OpenAIToolChoiceFunction(StrictModel):
    name: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")


class OpenAIToolChoice(StrictModel):
    type: Literal["function"]
    function: OpenAIToolChoiceFunction


class OpenAIToolCallFunction(StrictModel):
    name: str = Field(min_length=1, max_length=128)
    arguments: str = Field(max_length=32_000)


class OpenAIToolCall(StrictModel):
    id: str = Field(min_length=1, max_length=256)
    type: Literal["function"]
    function: OpenAIToolCallFunction


class OpenAIChatMessage(StrictModel):
    role: Literal["system", "developer", "user", "assistant", "tool"]
    content: str | list[dict[str, Any]] | None = None
    name: str | None = Field(default=None, max_length=128)
    tool_call_id: str | None = Field(default=None, max_length=256)
    tool_calls: list[OpenAIToolCall] | None = None

    @model_validator(mode="after")
    def validate_message(self) -> "OpenAIChatMessage":
        if self.content is None and not self.tool_calls:
            raise ValueError("content is required unless assistant tool_calls are supplied")
        if isinstance(self.content, str) and len(self.content) > MAX_MESSAGE_CONTENT_CHARS:
            raise ValueError(
                f"message content must not exceed {MAX_MESSAGE_CONTENT_CHARS} characters"
            )
        if isinstance(self.content, list):
            serialized_content = json.dumps(self.content, ensure_ascii=False, default=str)
            if len(serialized_content) > MAX_MESSAGE_CONTENT_CHARS:
                raise ValueError(
                    "structured message content must not exceed "
                    f"{MAX_MESSAGE_CONTENT_CHARS} characters"
                )
        if self.role == "tool" and not self.tool_call_id:
            raise ValueError("tool_call_id is required for tool messages")
        if self.role != "assistant" and self.tool_calls:
            raise ValueError("tool_calls are only allowed in assistant messages")
        return self


class OpenAIChatCompletionRequest(StrictModel):
    """Non-streaming OpenAI chat completion request for the configured Qwen model."""

    model: str | None = Field(default=None, min_length=1, max_length=128)
    messages: list[OpenAIChatMessage] = Field(min_length=1, max_length=100)
    tools: list[OpenAIToolDefinition] | None = Field(default=None, max_length=64)
    tool_choice: Literal["none", "auto", "required"] | OpenAIToolChoice | None = None
    parallel_tool_calls: bool | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    top_p: float | None = Field(default=None, gt=0, le=1)
    max_tokens: int | None = Field(default=None, ge=1, le=8_192)
    response_format: dict[str, Any] | None = None
    stream: Literal[False] = False

    @model_validator(mode="after")
    def validate_request(self) -> "OpenAIChatCompletionRequest":
        if self.tool_choice is not None and not self.tools:
            raise ValueError("tool_choice requires at least one tool")

        total_content_chars = sum(
            len(message.content)
            for message in self.messages
            if isinstance(message.content, str)
        )
        if total_content_chars > MAX_TOTAL_MESSAGE_CONTENT_CHARS:
            raise ValueError(
                "combined message content must not exceed "
                f"{MAX_TOTAL_MESSAGE_CONTENT_CHARS} characters"
            )
        return self

    def to_openai_payload(self, model: str) -> dict[str, Any]:
        payload = self.model_dump(mode="json", exclude_none=True)
        payload["model"] = model
        payload["stream"] = False
        return payload


class AIProviderStatus(StrictModel):
    provider: Literal["ollama"] = "ollama"
    configured: bool
    reachable: bool
    model: str
    model_available: bool | None = None
    detail: str | None = None
    checked_at: datetime = Field(default_factory=utc_now)


class AIConfigResponse(StrictModel):
    enabled: bool
    base_url: str | None = None
    model: str | None = None
    timeout_seconds: float
    max_tool_rounds: int


class AIHealthResponse(StrictModel):
    status: Literal["ok", "disabled", "error"]
    enabled: bool
    model: str | None = None
    base_url: str | None = None
    detail: str | None = None
    error: str | None = None


class CreateAIDecisionRequest(StrictModel):
    prompt: str = Field(min_length=1, max_length=16_000)
    allow_commands: bool = False

    @field_validator("prompt")
    @classmethod
    def require_non_whitespace_prompt(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("prompt must contain non-whitespace text")
        return value.strip()


class AIToolCallRecord(StrictModel):
    id: str
    name: str
    arguments: Any | None = None
    result: Any | None = None
    error: str | None = Field(default=None, max_length=1_000)


class AIDecisionLog(StrictModel):
    id: str
    status: Literal["completed", "failed"]
    prompt: str
    summary: str | None = Field(default=None, max_length=8_000)
    model: str
    started_at: datetime
    finished_at: datetime = Field(default_factory=utc_now)
    response: dict[str, Any] | None = None
    error: str | None = Field(default=None, max_length=1_000)
    tool_calls: list[AIToolCallRecord] = Field(default_factory=list)
    messages: list[dict[str, Any]] = Field(default_factory=list)


class OllamaOpenAIClient:
    """Small HTTP client for Ollama's OpenAI-compatible /v1 API."""

    def __init__(
        self,
        settings: Settings,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._settings = settings
        self._http_client = http_client
        self._owns_client = http_client is None

    @property
    def configured(self) -> bool:
        return self._settings.ollama_base_url is not None

    @property
    def model(self) -> str:
        return self._settings.ollama_model

    @property
    def base_url(self) -> str | None:
        return self._settings.ollama_base_url

    @property
    def timeout_seconds(self) -> float:
        return self._settings.ollama_timeout_seconds

    @property
    def _base_url(self) -> str:
        if self._settings.ollama_base_url is None:
            raise AIProviderNotConfiguredError()
        base_url = self._settings.ollama_base_url.rstrip("/")
        if not base_url.endswith("/v1"):
            base_url = f"{base_url}/v1"
        return base_url

    async def aclose(self) -> None:
        if self._owns_client and self._http_client is not None:
            await self._http_client.aclose()

    async def chat_completions(
        self, request: OpenAIChatCompletionRequest
    ) -> dict[str, Any]:
        if request.model is not None and request.model != self.model:
            raise AIModelNotAllowedError(request.model, self.model)

        response = await self._request(
            "POST",
            "/chat/completions",
            json=request.to_openai_payload(self.model),
        )
        payload = self._json_object(response)
        choices = payload.get("choices")
        if (
            not isinstance(choices, list)
            or not choices
            or not isinstance(choices[0], dict)
            or not isinstance(choices[0].get("message"), dict)
        ):
            raise AIProviderResponseError()
        return payload

    async def status(self) -> AIProviderStatus:
        if not self.configured:
            return AIProviderStatus(
                configured=False,
                reachable=False,
                model=self.model,
                detail="Set MC_OLLAMA_BASE_URL to enable remote Ollama.",
            )

        try:
            response = await self._request("GET", "/models")
            payload = self._json_object(response)
            models = payload.get("data")
            if not isinstance(models, list):
                raise AIProviderResponseError()
            available_models = {
                item.get("id")
                for item in models
                if isinstance(item, dict) and isinstance(item.get("id"), str)
            }
            return AIProviderStatus(
                configured=True,
                reachable=True,
                model=self.model,
                model_available=self.model in available_models,
                detail=(
                    None
                    if self.model in available_models
                    else "The configured model is not installed on remote Ollama."
                ),
            )
        except AIProviderError as error:
            return AIProviderStatus(
                configured=True,
                reachable=False,
                model=self.model,
                detail=error.public_message,
            )

    async def _request(
        self,
        method: str,
        path: str,
        **kwargs: Any,
    ) -> httpx.Response:
        if not self.configured:
            raise AIProviderNotConfiguredError()

        headers = {"Accept": "application/json"}
        if self._settings.ollama_api_key is not None:
            headers["Authorization"] = f"Bearer {self._settings.ollama_api_key}"

        try:
            async with self._get_http_client().stream(
                method,
                f"{self._base_url}{path}",
                headers=headers,
                **kwargs,
            ) as upstream_response:
                content_length = upstream_response.headers.get("content-length")
                if content_length is not None:
                    try:
                        if int(content_length) > MAX_OLLAMA_RESPONSE_BYTES:
                            raise AIProviderResponseError()
                    except ValueError:
                        pass

                content = bytearray()
                async for chunk in upstream_response.aiter_bytes():
                    if len(content) + len(chunk) > MAX_OLLAMA_RESPONSE_BYTES:
                        raise AIProviderResponseError()
                    content.extend(chunk)

                if not 200 <= upstream_response.status_code < 300:
                    raise AIProviderResponseError(upstream_response.status_code)

                response = httpx.Response(
                    upstream_response.status_code,
                    headers=upstream_response.headers,
                    content=bytes(content),
                    request=upstream_response.request,
                )
        except httpx.TimeoutException as error:
            raise AIProviderTimeoutError() from error
        except httpx.RequestError as error:
            raise AIProviderUnavailableError() from error
        return response

    def _get_http_client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            timeout = httpx.Timeout(
                self._settings.ollama_timeout_seconds,
                connect=min(10.0, self._settings.ollama_timeout_seconds),
            )
            self._http_client = httpx.AsyncClient(
                timeout=timeout,
                follow_redirects=False,
                trust_env=False,  # 禁用系统代理：局域网直连 Ollama，避免代理拦截
            )
        return self._http_client

    @staticmethod
    def _json_object(response: httpx.Response) -> dict[str, Any]:
        try:
            payload = response.json()
        except ValueError as error:
            raise AIProviderResponseError() from error
        if not isinstance(payload, dict):
            raise AIProviderResponseError()
        return payload


class AIDecisionService:
    """Runs audited Qwen decisions and exposes a small, safe tool surface."""

    def __init__(
        self,
        client: OllamaOpenAIClient,
        manager: BotManager,
        history_size: int,
        max_tool_rounds: int,
    ) -> None:
        self._client = client
        self._manager = manager
        self._max_tool_rounds = max_tool_rounds
        self._logs: deque[AIDecisionLog] = deque(maxlen=history_size)
        self._lock = asyncio.Lock()

    async def aclose(self) -> None:
        await self._client.aclose()

    def config(self) -> AIConfigResponse:
        return AIConfigResponse(
            enabled=self._client.configured,
            base_url=self._settings_base_url(),
            model=self._client.model,
            timeout_seconds=self._client.timeout_seconds,
            max_tool_rounds=self._max_tool_rounds,
        )

    async def health(self) -> AIHealthResponse:
        provider_status = await self._client.status()
        if not provider_status.configured:
            return AIHealthResponse(
                status="disabled",
                enabled=False,
                model=self._client.model,
                base_url=None,
                detail=provider_status.detail,
            )
        if provider_status.reachable and provider_status.model_available:
            return AIHealthResponse(
                status="ok",
                enabled=True,
                model=self._client.model,
                base_url=self._settings_base_url(),
            )
        return AIHealthResponse(
            status="error",
            enabled=True,
            model=self._client.model,
            base_url=self._settings_base_url(),
            detail=provider_status.detail,
            error=provider_status.detail,
        )

    async def chat_completions(
        self, request: OpenAIChatCompletionRequest
    ) -> dict[str, Any]:
        """Proxy a standard request while retaining a lightweight audit record."""
        decision_id = f"ai_{uuid4().hex}"
        started_at = utc_now()
        prompt = self._prompt_from_messages(request.messages)
        messages = self._audit_messages(
            [
                message.model_dump(mode="json", exclude_none=True)
                for message in request.messages
            ]
        )
        await self._publish_started(decision_id, prompt, request.tools or [])

        try:
            response = await self._client.chat_completions(request)
        except AIProviderError as error:
            await self._record_failure(
                decision_id=decision_id,
                prompt=prompt,
                started_at=started_at,
                messages=messages,
                error=error,
            )
            raise

        assistant_message = self._assistant_message(response)
        messages.append(assistant_message)
        log = AIDecisionLog(
            id=decision_id,
            status="completed",
            prompt=prompt,
            summary=self._message_content(assistant_message),
            model=self._client.model,
            started_at=started_at,
            response=self._audit_response(response),
            tool_calls=self._tool_records_from_message(assistant_message),
            messages=self._audit_messages(messages),
        )
        await self._record_completed(log)
        return response

    async def create_decision(
        self, request: CreateAIDecisionRequest
    ) -> AIDecisionLog:
        """Ask Qwen to inspect current bot state, optionally dispatching commands."""
        decision_id = f"ai_{uuid4().hex}"
        started_at = utc_now()
        tools = self._decision_tools(request.allow_commands)
        messages: list[dict[str, Any]] = [
            {
                "role": "system",
                "content": (
                    "You are the MC bot control-plane decision assistant. Use the "
                    "provided tools to inspect actual state before making claims. "
                    "Treat tool results as authoritative. Only state that a command was "
                    "sent when the command tool returns success. Respond with a concise "
                    "Chinese operational summary after tool work is complete."
                ),
            },
            {"role": "user", "content": request.prompt},
        ]
        tool_records: list[AIToolCallRecord] = []
        await self._publish_started(decision_id, request.prompt, tools)

        try:
            for tool_round in range(self._max_tool_rounds + 1):
                try:
                    completion_request = OpenAIChatCompletionRequest.model_validate(
                        {
                            "messages": messages,
                            "tools": [
                                tool.model_dump(mode="json", exclude_none=True)
                                for tool in tools
                            ],
                            "tool_choice": "auto",
                            "temperature": 0.2,
                        }
                    )
                except ValidationError as error:
                    raise AIProviderResponseError() from error
                response = await self._client.chat_completions(completion_request)
                assistant_message = self._assistant_message(response)
                messages.append(assistant_message)
                tool_calls = self._tool_calls_from_message(assistant_message)
                if not tool_calls:
                    log = AIDecisionLog(
                        id=decision_id,
                        status="completed",
                        prompt=request.prompt,
                        summary=self._message_content(assistant_message),
                        model=self._client.model,
                        started_at=started_at,
                        response=self._audit_response(response),
                        tool_calls=tool_records,
                        messages=self._audit_messages(messages),
                    )
                    await self._record_completed(log)
                    return log

                if tool_round >= self._max_tool_rounds:
                    for tool_call in tool_calls:
                        tool_records.append(
                            AIToolCallRecord(
                                id=tool_call.id,
                                name=tool_call.function.name,
                                arguments=self._audit_value(
                                    self._display_tool_arguments(
                                        tool_call.function.arguments
                                    )
                                ),
                                error="Maximum AI tool rounds reached; call was not executed.",
                            )
                        )
                    log = AIDecisionLog(
                        id=decision_id,
                        status="completed",
                        prompt=request.prompt,
                        summary=(
                            "AI reached the configured tool-round limit before it produced "
                            "a final text response."
                        ),
                        model=self._client.model,
                        started_at=started_at,
                        response=self._audit_response(response),
                        tool_calls=tool_records,
                        messages=self._audit_messages(messages),
                    )
                    await self._record_completed(log)
                    return log

                for tool_call in tool_calls:
                    record, tool_message = await self._run_tool(
                        tool_call, request.allow_commands
                    )
                    tool_records.append(record)
                    messages.append(tool_message)
        except AIProviderError as error:
            return await self._record_failure(
                decision_id=decision_id,
                prompt=request.prompt,
                started_at=started_at,
                messages=messages,
                error=error,
                tool_calls=tool_records,
            )

        raise RuntimeError("AI decision loop exited unexpectedly")

    async def status(self) -> AIProviderStatus:
        return await self._client.status()

    async def recent_decisions(self, limit: int) -> list[AIDecisionLog]:
        async with self._lock:
            return list(self._logs)[-limit:]

    async def _record_completed(self, log: AIDecisionLog) -> None:
        await self._append(log)
        await self._manager.publish_event(
            "ai.decision.completed", self._completion_event_payload(log)
        )

    async def _record_failure(
        self,
        *,
        decision_id: str,
        prompt: str,
        started_at: datetime,
        messages: list[dict[str, Any]],
        error: AIProviderError,
        tool_calls: list[AIToolCallRecord] | None = None,
    ) -> AIDecisionLog:
        log = AIDecisionLog(
            id=decision_id,
            status="failed",
            prompt=prompt,
            model=self._client.model,
            started_at=started_at,
            error=error.public_message,
            tool_calls=tool_calls or [],
            messages=self._audit_messages(messages),
        )
        await self._append(log)
        await self._manager.publish_event(
            "ai.decision.failed",
            {
                "decision_id": decision_id,
                "model": self._client.model,
                "error": error.public_message,
            },
        )
        return log

    async def _append(self, log: AIDecisionLog) -> None:
        async with self._lock:
            self._logs.append(log)

    async def _publish_started(
        self,
        decision_id: str,
        prompt: str,
        tools: list[OpenAIToolDefinition],
    ) -> None:
        await self._manager.publish_event(
            "ai.decision.started",
            {
                "decision_id": decision_id,
                "model": self._client.model,
                "prompt": prompt[:500],
                "tool_names": [tool.function.name for tool in tools],
            },
        )

    def _decision_tools(self, allow_commands: bool) -> list[OpenAIToolDefinition]:
        tools = [
            OpenAIToolDefinition(
                type="function",
                function=OpenAIFunctionDefinition(
                    name="list_bots",
                    description="List all registered bots and their current state.",
                    parameters={"type": "object", "properties": {}},
                ),
            ),
            OpenAIToolDefinition(
                type="function",
                function=OpenAIFunctionDefinition(
                    name="get_bot",
                    description="Get the current state of one bot by bot_id.",
                    parameters={
                        "type": "object",
                        "properties": {
                            "bot_id": {"type": "string", "description": "Bot ID"}
                        },
                        "required": ["bot_id"],
                        "additionalProperties": False,
                    },
                ),
            ),
        ]
        if allow_commands:
            tools.append(
                OpenAIToolDefinition(
                    type="function",
                    function=OpenAIFunctionDefinition(
                        name="send_bot_command",
                        description=(
                            "Send an explicit command to one connected bot. Use only when "
                            "the user request requires an action."
                        ),
                        parameters={
                            "type": "object",
                            "properties": {
                                "bot_id": {"type": "string"},
                                "type": {
                                    "type": "string",
                                    "enum": [
                                        "run_task",
                                        "pause",
                                        "resume",
                                        "stop",
                                        "screenshot",
                                    ],
                                },
                                "task": {"type": "string"},
                                "params": {"type": "object"},
                            },
                            "required": ["bot_id", "type"],
                            "additionalProperties": False,
                        },
                    ),
                )
            )
        return tools

    async def _run_tool(
        self, tool_call: OpenAIToolCall, allow_commands: bool
    ) -> tuple[AIToolCallRecord, dict[str, Any]]:
        arguments, parse_error = self._parse_tool_arguments(tool_call.function.arguments)
        record = AIToolCallRecord(
            id=tool_call.id,
            name=tool_call.function.name,
            arguments=self._audit_value(
                arguments
                if parse_error is None
                else self._display_tool_arguments(tool_call.function.arguments)
            ),
        )
        if parse_error is not None:
            record = record.model_copy(update={"error": parse_error})
            return record, self._tool_result_message(tool_call.id, {"error": parse_error})

        try:
            if tool_call.function.name == "list_bots":
                result: Any = [
                    bot.model_dump(mode="json") for bot in await self._manager.list_bots()
                ]
            elif tool_call.function.name == "get_bot":
                bot_id = arguments.get("bot_id")
                if not isinstance(bot_id, str) or not bot_id:
                    raise ValueError("bot_id must be a non-empty string")
                bot = await self._manager.get_bot(bot_id)
                result = bot.model_dump(mode="json")
            elif tool_call.function.name == "send_bot_command":
                if not allow_commands:
                    raise PermissionError(
                        "Command tools are disabled for this decision request."
                    )
                bot_id = arguments.get("bot_id")
                if not isinstance(bot_id, str) or not bot_id:
                    raise ValueError("bot_id must be a non-empty string")
                command = CommandRequest.model_validate(
                    {
                        "type": arguments.get("type"),
                        "task": arguments.get("task"),
                        "params": arguments.get("params", {}),
                    }
                )
                envelope: CommandEnvelope = await self._manager.send_command(
                    bot_id, command
                )
                result = envelope.model_dump(mode="json")
            else:
                raise ValueError("Requested tool is not available")
        except (
            AgentUnavailableError,
            BotNotFoundError,
            PermissionError,
            ValidationError,
            ValueError,
        ) as error:
            message = str(error) or error.__class__.__name__
            record = record.model_copy(update={"error": message})
            return record, self._tool_result_message(tool_call.id, {"error": message})

        record = record.model_copy(update={"result": self._audit_value(result)})
        return record, self._tool_result_message(tool_call.id, result)

    @staticmethod
    def _tool_result_message(tool_call_id: str, result: Any) -> dict[str, Any]:
        serialized_result = json.dumps(result, ensure_ascii=False, default=str)
        if len(serialized_result) > MAX_TOOL_RESULT_CHARS:
            serialized_result = json.dumps(
                {
                    "truncated": True,
                    "preview": serialized_result[:MAX_TOOL_RESULT_CHARS],
                },
                ensure_ascii=False,
            )
        return {
            "role": "tool",
            "tool_call_id": tool_call_id,
            "content": serialized_result,
        }

    @staticmethod
    def _parse_tool_arguments(arguments: str) -> tuple[dict[str, Any], str | None]:
        try:
            parsed = json.loads(arguments)
        except (TypeError, json.JSONDecodeError):
            return {}, "Tool arguments must be a JSON object."
        if not isinstance(parsed, dict):
            return {}, "Tool arguments must be a JSON object."
        return parsed, None

    @staticmethod
    def _display_tool_arguments(arguments: str) -> Any:
        try:
            return json.loads(arguments)
        except (TypeError, json.JSONDecodeError):
            return arguments

    @staticmethod
    def _assistant_message(response: dict[str, Any]) -> dict[str, Any]:
        choices = response.get("choices")
        choice = choices[0] if isinstance(choices, list) and choices else {}
        raw_message = choice.get("message") if isinstance(choice, dict) else {}
        if not isinstance(raw_message, dict):
            raw_message = {}

        content = raw_message.get("content")
        if not isinstance(content, (str, list)) and content is not None:
            content = str(content)
        if isinstance(content, str) and len(content) > MAX_MESSAGE_CONTENT_CHARS:
            content = content[:MAX_MESSAGE_CONTENT_CHARS]
        if isinstance(content, list) and len(
            json.dumps(content, ensure_ascii=False, default=str)
        ) > MAX_MESSAGE_CONTENT_CHARS:
            content = "[Structured assistant content omitted because it exceeded the audit limit.]"
        message: dict[str, Any] = {"role": "assistant", "content": content}
        raw_tool_calls = raw_message.get("tool_calls")
        if isinstance(raw_tool_calls, list):
            tool_calls: list[dict[str, Any]] = []
            for index, raw_tool_call in enumerate(
                raw_tool_calls[:MAX_TOOL_CALLS_PER_RESPONSE]
            ):
                if not isinstance(raw_tool_call, dict):
                    continue
                raw_function = raw_tool_call.get("function")
                if not isinstance(raw_function, dict):
                    continue
                name = raw_function.get("name")
                if not isinstance(name, str) or not name or len(name) > 128:
                    continue
                arguments = raw_function.get("arguments", "{}")
                if not isinstance(arguments, str):
                    arguments = json.dumps(arguments, ensure_ascii=False)
                if len(arguments) > 32_000:
                    arguments = "{"
                call_id = raw_tool_call.get("id")
                if not isinstance(call_id, str) or not call_id or len(call_id) > 256:
                    call_id = f"call_{uuid4().hex}_{index}"
                tool_calls.append(
                    {
                        "id": call_id,
                        "type": "function",
                        "function": {"name": name, "arguments": arguments},
                    }
                )
            if tool_calls:
                message["tool_calls"] = tool_calls
        return message

    @staticmethod
    def _tool_calls_from_message(message: dict[str, Any]) -> list[OpenAIToolCall]:
        raw_tool_calls = message.get("tool_calls")
        if not isinstance(raw_tool_calls, list):
            return []
        return [
            OpenAIToolCall.model_validate(tool_call)
            for tool_call in raw_tool_calls
            if isinstance(tool_call, dict)
        ]

    @classmethod
    def _tool_records_from_message(
        cls, message: dict[str, Any]
    ) -> list[AIToolCallRecord]:
        return [
            AIToolCallRecord(
                id=tool_call.id,
                name=tool_call.function.name,
                arguments=cls._audit_value(
                    cls._display_tool_arguments(tool_call.function.arguments)
                ),
            )
            for tool_call in cls._tool_calls_from_message(message)
        ]

    @classmethod
    def _audit_messages(
        cls, messages: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        if len(messages) > MAX_AUDIT_MESSAGES:
            preserved_count = (MAX_AUDIT_MESSAGES - 1) // 2
            messages = [
                *messages[:preserved_count],
                {
                    "role": "system",
                    "content": "[Audit log omitted intermediate messages.]",
                },
                *messages[-preserved_count:],
            ]

        audited_messages: list[dict[str, Any]] = []
        for message in messages:
            audited_message = dict(message)
            content = audited_message.get("content")
            if isinstance(content, str) and len(content) > MAX_AUDIT_MESSAGE_CHARS:
                audited_message["content"] = f"{content[:MAX_AUDIT_MESSAGE_CHARS]}..."
            elif content is not None and not isinstance(content, str):
                audited_message["content"] = cls._audit_value(content)
            if "tool_calls" in audited_message:
                audited_message["tool_calls"] = cls._audit_value(
                    audited_message["tool_calls"]
                )
            audited_messages.append(audited_message)
        return audited_messages

    @classmethod
    def _audit_response(cls, response: dict[str, Any]) -> dict[str, Any]:
        """Keep enough completion metadata for debugging without retaining raw bodies."""
        audit: dict[str, Any] = {
            key: cls._audit_value(response[key])
            for key in ("id", "object", "created", "model", "usage")
            if key in response
        }
        choices = response.get("choices")
        if isinstance(choices, list) and choices:
            first_choice = choices[0] if isinstance(choices[0], dict) else {}
            if isinstance(first_choice, dict):
                audit["choices"] = [
                    {
                        "index": first_choice.get("index"),
                        "finish_reason": first_choice.get("finish_reason"),
                        "message": cls._audit_messages(
                            [cls._assistant_message(response)]
                        )[0],
                    }
                ]
        return audit

    @staticmethod
    def _audit_value(value: Any) -> Any:
        try:
            serialized = json.dumps(value, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            serialized = repr(value)
        if len(serialized) <= MAX_AUDIT_VALUE_CHARS:
            return value
        return {
            "truncated": True,
            "preview": f"{serialized[:MAX_AUDIT_VALUE_CHARS]}...",
        }

    @staticmethod
    def _message_content(message: dict[str, Any]) -> str | None:
        content = message.get("content")
        if isinstance(content, str):
            return content[:8_000] or None
        return None

    @staticmethod
    def _prompt_from_messages(messages: list[OpenAIChatMessage]) -> str:
        for message in reversed(messages):
            if message.role == "user" and isinstance(message.content, str):
                return message.content
        return "OpenAI-compatible chat completion"

    def _settings_base_url(self) -> str | None:
        return self._client.base_url

    @staticmethod
    def _completion_event_payload(log: AIDecisionLog) -> dict[str, Any]:
        summary = log.summary
        if isinstance(summary, str) and len(summary) > 2_000:
            summary = f"{summary[:2_000]}..."
        return {
            "decision_id": log.id,
            "model": log.model,
            "content": summary,
            "tool_names": [tool_call.name for tool_call in log.tool_calls],
            "tool_errors": [
                tool_call.error for tool_call in log.tool_calls if tool_call.error
            ],
            "response_id": (log.response or {}).get("id"),
            "usage": (log.response or {}).get("usage"),
        }
