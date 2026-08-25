from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_health_and_manual_bot_registration() -> None:
    app = create_app(Settings())
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json() == {
            "status": "ok",
            "connected_agents": 0,
            "known_bots": 0,
        }

        created = client.post(
            "/api/v1/bots",
            json={"bot_id": "manual-1", "display_name": "Manual bot"},
        )
        assert created.status_code == 201
        assert created.json()["status"] == "offline"

        listed = client.get("/api/v1/bots")
        assert listed.status_code == 200
        assert [bot["bot_id"] for bot in listed.json()] == ["manual-1"]


def test_api_key_protects_control_endpoints() -> None:
    app = create_app(Settings(api_key="test-secret"))
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/api/v1/bots").status_code == 401
        assert (
            client.get("/api/v1/bots", headers={"X-API-Key": "test-secret"}).status_code
            == 200
        )
