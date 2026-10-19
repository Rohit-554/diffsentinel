"""HTTP application: liveness and readiness endpoints.

Phase 1 adds the queue consumer to this process, started from the lifespan.
"""

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from importlib.metadata import version
from typing import Any, Literal, Protocol

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

from reviewer.config import Settings

logger = logging.getLogger("reviewer.health")

DEFAULT_CHECK_TIMEOUT_S = 2.0
SERVICE = "reviewer"


class RedisLike(Protocol):
    def ping(self) -> Awaitable[Any]: ...

    async def aclose(self) -> None: ...


RedisFactory = Callable[[str], RedisLike]


def default_redis_factory(url: str) -> RedisLike:
    # Bounded socket timeouts so a dead Redis fails fast instead of hanging.
    client: RedisLike = Redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
    return client


async def check_redis(client: RedisLike, timeout_s: float) -> dict[str, object]:
    """Ping Redis within the timeout; return a fixed-shape result without error text."""
    started = time.perf_counter()
    error: Literal["timeout", "unreachable"] | None = None
    try:
        async with asyncio.timeout(timeout_s):
            await client.ping()
    except TimeoutError:
        error = "timeout"
    except Exception as exc:
        # Log the exception type only: messages can contain hosts or credentials.
        logger.warning("Readiness check failed: redis (unreachable, %s)", type(exc).__name__)
        error = "unreachable"
    latency_ms = round((time.perf_counter() - started) * 1000)
    if error is None:
        return {"status": "up", "latencyMs": latency_ms}
    if error == "timeout":
        logger.warning("Readiness check failed: redis (timeout)")
    return {"status": "down", "latencyMs": latency_ms, "error": error}


def create_app(
    settings: Settings,
    redis_factory: RedisFactory = default_redis_factory,
    check_timeout_s: float = DEFAULT_CHECK_TIMEOUT_S,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.redis = redis_factory(str(settings.redis_url))
        try:
            yield
        finally:
            await app.state.redis.aclose()

    app = FastAPI(title="DiffSentinel reviewer", lifespan=lifespan)
    service_version = version("diffsentinel-reviewer")

    @app.get("/health")
    async def liveness() -> dict[str, str]:
        """Liveness: no I/O, so a Redis outage never marks the process dead."""
        return {"status": "ok", "service": SERVICE, "version": service_version}

    @app.get("/health/ready")
    async def readiness() -> JSONResponse:
        redis = await check_redis(app.state.redis, check_timeout_s)
        ready = redis["status"] == "up"
        return JSONResponse(
            status_code=200 if ready else 503,
            content={
                "status": "ok" if ready else "unavailable",
                "service": SERVICE,
                "checks": {"redis": redis},
            },
        )

    return app
