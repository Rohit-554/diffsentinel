import asyncio
import time
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from reviewer.app import create_app
from reviewer.config import Settings


class FakeRedis:
    def __init__(self, behaviour: str = "up") -> None:
        self.behaviour = behaviour
        self.closed = False

    async def ping(self) -> Any:
        if self.behaviour == "down":
            raise ConnectionError("Error connecting to redis://:hunter2@cache.internal:6379")
        if self.behaviour == "hang":
            await asyncio.sleep(3600)
        return True

    async def aclose(self) -> None:
        self.closed = True


@pytest.fixture
def fake() -> FakeRedis:
    return FakeRedis()


@pytest.fixture
def client(fake: FakeRedis) -> Iterator[TestClient]:
    settings = Settings(redis_url="redis://localhost:6379")
    app = create_app(settings, redis_factory=lambda _url: fake, check_timeout_s=0.1)
    with TestClient(app) as test_client:
        yield test_client


def test_liveness_ok(client: TestClient) -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert res.json()["service"] == "reviewer"


def test_liveness_ok_while_redis_down(client: TestClient, fake: FakeRedis) -> None:
    fake.behaviour = "down"
    assert client.get("/health").status_code == 200


def test_ready_when_redis_up(client: TestClient) -> None:
    res = client.get("/health/ready")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["checks"]["redis"]["status"] == "up"


def test_unavailable_when_redis_down_without_leaking(client: TestClient, fake: FakeRedis) -> None:
    fake.behaviour = "down"
    res = client.get("/health/ready")
    assert res.status_code == 503
    body = res.json()
    assert body["status"] == "unavailable"
    assert body["checks"]["redis"] == {
        "status": "down",
        "latencyMs": body["checks"]["redis"]["latencyMs"],
        "error": "unreachable",
    }
    assert "hunter2" not in res.text
    assert "cache.internal" not in res.text


def test_hung_redis_reports_timeout_within_limit(client: TestClient, fake: FakeRedis) -> None:
    fake.behaviour = "hang"
    started = time.monotonic()
    res = client.get("/health/ready")
    assert time.monotonic() - started < 1.0
    assert res.status_code == 503
    assert res.json()["checks"]["redis"]["error"] == "timeout"


def test_redis_client_closed_on_shutdown(fake: FakeRedis) -> None:
    settings = Settings(redis_url="redis://localhost:6379")
    app = create_app(settings, redis_factory=lambda _url: fake)
    with TestClient(app):
        pass
    assert fake.closed


def test_failure_logs_type_not_message(
    client: TestClient, fake: FakeRedis, caplog: pytest.LogCaptureFixture
) -> None:
    fake.behaviour = "down"
    client.get("/health/ready")
    logged = " ".join(r.getMessage() for r in caplog.records)
    assert "ConnectionError" in logged
    assert "hunter2" not in logged
