"""Smoke tests for GET /health.

DATABASE_URL must be present in the environment before any app module is
imported, because app.config validates required vars at import time.
The monkeypatch fixture sets it before the TestClient is constructed.
"""

import os
import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("DATABASE_URL", "postgresql://test:test@localhost:5432/test_db")

    # Re-import to ensure config validation sees the patched env var.
    import app.config as cfg
    importlib.reload(cfg)

    import app.main as main_module
    importlib.reload(main_module)

    return TestClient(main_module.app, raise_server_exceptions=True)


def test_health_returns_200(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200


def test_health_body_contains_status_ok(client: TestClient) -> None:
    response = client.get("/health")
    body = response.json()
    assert body["status"] == "ok"


def test_health_content_type_is_json(client: TestClient) -> None:
    response = client.get("/health")
    assert "application/json" in response.headers["content-type"]


def test_health_no_database_url_raises_at_startup(monkeypatch: pytest.MonkeyPatch) -> None:
    """Service must refuse to start when DATABASE_URL is missing."""
    monkeypatch.delenv("DATABASE_URL", raising=False)

    import app.config as cfg

    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        importlib.reload(cfg)


def test_health_unknown_route_returns_404(client: TestClient) -> None:
    response = client.get("/nonexistent")
    assert response.status_code == 404
