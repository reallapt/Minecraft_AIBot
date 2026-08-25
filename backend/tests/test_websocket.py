from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_agent_registers_reports_status_and_receives_command() -> None:
    app = create_app(Settings())
    with TestClient(app) as client:
        with client.websocket_connect("/ws/agents") as agent:
            agent.send_json(
                {
                    "type": "register",
                    "agent_id": "node-a",
                    "node_name": "game-machine-a",
                    "version": "0.1.0",
                    "bots": [
                        {
                            "bot_id": "bot-001",
                            "display_name": "Farmer 1",
                            "status": "idle",
                        }
                    ],
                }
            )
            registered = agent.receive_json()
            assert registered["type"] == "registered"

            command_response = client.post(
                "/api/v1/bots/bot-001/commands",
                json={"type": "run_task", "task": "daily_login", "params": {"route": "A"}},
            )
            assert command_response.status_code == 200

            command = agent.receive_json()
            assert command["type"] == "run_task"
            assert command["bot_id"] == "bot-001"
            assert command["task"] == "daily_login"

            agent.send_json(
                {
                    "type": "status",
                    "bot_id": "bot-001",
                    "status": "running",
                    "current_task_id": "daily-login-1",
                    "current_step": 3,
                    "hp": 85,
                    "position": "map_A",
                }
            )
            bot_response = client.get("/api/v1/bots/bot-001")
            assert bot_response.status_code == 200
            assert bot_response.json()["status"] == "running"
            assert bot_response.json()["current_step"] == 3


def test_dashboard_receives_agent_registration_event() -> None:
    app = create_app(Settings())
    with TestClient(app) as client:
        with client.websocket_connect("/ws/dashboard") as dashboard:
            snapshot = dashboard.receive_json()
            assert snapshot["type"] == "dashboard.snapshot"
            assert snapshot["payload"]["bots"] == []

            with client.websocket_connect("/ws/agents") as agent:
                agent.send_json(
                    {
                        "type": "register",
                        "agent_id": "node-b",
                        "node_name": "game-machine-b",
                        "version": "0.1.0",
                        "bots": [{"bot_id": "bot-002"}],
                    }
                )
                agent.receive_json()
                event = dashboard.receive_json()
                assert event["type"] == "bot.registered"
                assert event["payload"]["bot_id"] == "bot-002"
