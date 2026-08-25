import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.ai import (
    AIProviderResponseError,
    OllamaOpenAIClient,
    OpenAIChatCompletionRequest,
)
from app.config import Settings
from app.main import create_app


def test_ollama_client_forwards_openai_tool_request() -> None:
    async def scenario() -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "POST"
            assert str(request.url) == "http://ollama.example:11434/v1/chat/completions"
            assert request.headers["authorization"] == "Bearer upstream-secret"
            payload = json.loads(request.content)
            assert payload["model"] == "qwen3:8b"
            assert payload["stream"] is False
            assert payload["tools"][0]["function"]["name"] == "list_bots"
            return httpx.Response(
                200,
                json={
                    "id": "chatcmpl-test",
                    "object": "chat.completion",
                    "created": 1,
                    "model": "qwen3:8b",
                    "choices": [
                        {
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": None,
                                "tool_calls": [
                                    {
                                        "id": "call-1",
                                        "type": "function",
                                        "function": {
                                            "name": "list_bots",
                                            "arguments": "{}",
                                        },
                                    }
                                ],
                            },
                            "finish_reason": "tool_calls",
                        }
                    ],
                },
            )

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = OllamaOpenAIClient(
            Settings(
                ollama_base_url="http://ollama.example:11434",
                ollama_api_key="upstream-secret",
            ),
            http_client=http_client,
        )
        request = OpenAIChatCompletionRequest.model_validate(
            {
                "messages": [{"role": "user", "content": "Which bot is idle?"}],
                "tools": [
                    {
                        "type": "function",
                        "function": {
                            "name": "list_bots",
                            "parameters": {"type": "object", "properties": {}},
                        },
                    }
                ],
                "tool_choice": "auto",
            }
        )
        response = await client.chat_completions(request)
        assert response["choices"][0]["message"]["tool_calls"][0]["function"]["name"] == "list_bots"
        await http_client.aclose()

    asyncio.run(scenario())


def test_ai_endpoints_record_decisions_and_report_provider_status() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": "qwen3:8b"}]})
        if request.url.path == "/v1/chat/completions":
            return httpx.Response(
                200,
                json={
                    "id": "chatcmpl-2",
                    "object": "chat.completion",
                    "created": 2,
                    "model": "qwen3:8b",
                    "choices": [
                        {
                            "index": 0,
                            "message": {"role": "assistant", "content": "bot-001 is idle"},
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 4},
                },
            )
        return httpx.Response(404)

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    ollama_client = OllamaOpenAIClient(
        Settings(ollama_base_url="http://ollama.example:11434"),
        http_client=http_client,
    )
    app = create_app(
        Settings(ollama_base_url="http://ollama.example:11434"),
        ollama_client=ollama_client,
    )

    with TestClient(app) as client:
        config = client.get("/api/v1/ai/config")
        assert config.status_code == 200
        assert config.json() == {
            "enabled": True,
            "base_url": "http://ollama.example:11434",
            "model": "qwen3:8b",
            "timeout_seconds": 90.0,
            "max_tool_rounds": 4,
        }

        provider_status = client.get("/api/v1/ai/status")
        assert provider_status.status_code == 200
        assert provider_status.json()["reachable"] is True
        assert provider_status.json()["model_available"] is True

        health = client.post("/api/v1/ai/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"

        completion = client.post(
            "/api/v1/ai/chat/completions",
            json={"messages": [{"role": "user", "content": "Find an idle bot"}]},
        )
        assert completion.status_code == 200
        assert completion.json()["choices"][0]["message"]["content"] == "bot-001 is idle"

        decisions = client.get("/api/v1/ai/decisions")
        assert decisions.status_code == 200
        assert decisions.json()[0]["status"] == "completed"
        assert decisions.json()[0]["prompt"] == "Find an idle bot"
        assert decisions.json()[0]["response"]["id"] == "chatcmpl-2"
        assert [message["role"] for message in decisions.json()[0]["messages"]] == [
            "user",
            "assistant",
        ]

        events = client.get("/api/v1/events")
        assert [event["type"] for event in events.json()][-2:] == [
            "ai.decision.started",
            "ai.decision.completed",
        ]

    asyncio.run(http_client.aclose())


def test_native_decision_uses_read_only_bot_tools_by_default() -> None:
    chat_requests: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != "/v1/chat/completions":
            return httpx.Response(404)

        payload = json.loads(request.content)
        chat_requests.append(payload)
        if len(chat_requests) == 1:
            tool_names = [tool["function"]["name"] for tool in payload["tools"]]
            assert tool_names == ["list_bots", "get_bot"]
            return httpx.Response(
                200,
                json={
                    "id": "chatcmpl-tools",
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": None,
                                "tool_calls": [
                                    {
                                        "id": "call-list",
                                        "type": "function",
                                        "function": {
                                            "name": "list_bots",
                                            "arguments": "{}",
                                        },
                                    }
                                ],
                            },
                            "finish_reason": "tool_calls",
                        }
                    ],
                },
            )

        messages = payload["messages"]
        assert messages[-1]["role"] == "tool"
        assert messages[-1]["tool_call_id"] == "call-list"
        assert messages[-1]["content"].startswith("[")
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-summary",
                "choices": [
                    {
                        "message": {"role": "assistant", "content": "bot-001 is idle"},
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app = create_app(
        Settings(ollama_base_url="http://ollama.example:11434"),
        ollama_client=OllamaOpenAIClient(
            Settings(ollama_base_url="http://ollama.example:11434"),
            http_client=http_client,
        ),
    )

    with TestClient(app) as client:
        client.post("/api/v1/bots", json={"bot_id": "bot-001"})
        response = client.post(
            "/api/v1/ai/decisions",
            json={"prompt": "Which bot is idle?"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "completed"
        assert body["summary"] == "bot-001 is idle"
        tool_call = body["tool_calls"][0]
        assert tool_call["id"] == "call-list"
        assert tool_call["name"] == "list_bots"
        assert tool_call["arguments"] == {}
        assert tool_call["result"][0]["bot_id"] == "bot-001"
        assert tool_call["error"] is None

    asyncio.run(http_client.aclose())


def test_ai_completion_returns_503_when_ollama_is_not_configured() -> None:
    app = create_app(Settings())
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/ai/chat/completions",
            json={"messages": [{"role": "user", "content": "hello"}]},
        )
        assert response.status_code == 503
        assert response.json()["detail"] == "Remote Ollama is not configured"


def test_ai_health_returns_503_when_ollama_is_not_configured() -> None:
    app = create_app(Settings())
    with TestClient(app) as client:
        response = client.post("/api/v1/ai/health")
        assert response.status_code == 503


def test_ollama_client_rejects_an_oversized_streaming_response() -> None:
    async def scenario() -> None:
        http_client = httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    content=b"x" * (2 * 1024 * 1024 + 1),
                )
            )
        )
        client = OllamaOpenAIClient(
            Settings(ollama_base_url="http://ollama.example:11434"),
            http_client=http_client,
        )
        with pytest.raises(AIProviderResponseError):
            await client.chat_completions(
                OpenAIChatCompletionRequest.model_validate(
                    {"messages": [{"role": "user", "content": "hello"}]}
                )
            )
        await http_client.aclose()

    asyncio.run(scenario())


def test_ollama_client_rejects_a_malformed_completion_choice() -> None:
    async def scenario() -> None:
        http_client = httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json={"choices": ["bad"]})
            )
        )
        client = OllamaOpenAIClient(
            Settings(ollama_base_url="http://ollama.example:11434"),
            http_client=http_client,
        )
        with pytest.raises(AIProviderResponseError):
            await client.chat_completions(
                OpenAIChatCompletionRequest.model_validate(
                    {"messages": [{"role": "user", "content": "hello"}]}
                )
            )
        await http_client.aclose()

    asyncio.run(scenario())


def test_decision_audit_log_omits_large_raw_provider_fields() -> None:
    oversized_content = "x" * 16_000
    oversized_extra = "y" * 32_000

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-large",
                "object": "chat.completion",
                "model": "qwen3:8b",
                "extra_provider_field": oversized_extra,
                "choices": [
                    {
                        "message": {"role": "assistant", "content": oversized_content},
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app = create_app(
        Settings(ollama_base_url="http://ollama.example:11434"),
        ollama_client=OllamaOpenAIClient(
            Settings(ollama_base_url="http://ollama.example:11434"),
            http_client=http_client,
        ),
    )

    with TestClient(app) as client:
        completion = client.post(
            "/api/v1/ai/chat/completions",
            json={"messages": [{"role": "user", "content": "hello"}]},
        )
        assert completion.status_code == 200
        decisions = client.get("/api/v1/ai/decisions").json()
        log = decisions[0]
        assert "extra_provider_field" not in log["response"]
        assert len(log["summary"]) == 8_000
        assert len(log["messages"][-1]["content"]) <= 8_003

    asyncio.run(http_client.aclose())
