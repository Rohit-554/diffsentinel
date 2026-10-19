import json
import logging
import sys

import pytest

from reviewer.config import ConfigError, load_settings
from reviewer.logging_setup import JsonFormatter


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("REDIS_URL", "REVIEWER_PORT", "LOG_LEVEL"):
        monkeypatch.delenv(name, raising=False)


def test_defaults_apply_with_only_required_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379")
    settings = load_settings()
    assert settings.reviewer_port == 8000
    assert settings.log_level == "info"
    assert str(settings.redis_url).startswith("redis://localhost:6379")


def test_missing_redis_url_is_rejected() -> None:
    with pytest.raises(ConfigError) as exc_info:
        load_settings()
    assert len(exc_info.value.problems) == 1
    assert exc_info.value.problems[0].startswith("REDIS_URL: ")


def test_wrong_scheme_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REDIS_URL", "http://localhost:6379")
    with pytest.raises(ConfigError) as exc_info:
        load_settings()
    assert exc_info.value.problems[0].startswith("REDIS_URL: ")


def test_port_out_of_range_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379")
    monkeypatch.setenv("REVIEWER_PORT", "70000")
    with pytest.raises(ConfigError) as exc_info:
        load_settings()
    assert exc_info.value.problems[0].startswith("REVIEWER_PORT: ")


def test_errors_never_contain_the_value(monkeypatch: pytest.MonkeyPatch) -> None:
    secret = "s3cr3t-Pa55word"
    monkeypatch.setenv("REDIS_URL", f"memcached://admin:{secret}@cache.internal:11211")
    with pytest.raises(ConfigError) as exc_info:
        load_settings()
    assert "REDIS_URL" in str(exc_info.value)
    assert secret not in str(exc_info.value)
    assert "cache.internal" not in str(exc_info.value)
    assert exc_info.value.__cause__ is None  # the pydantic error (with input) is not chained


def test_json_formatter_reduces_exceptions_to_type_name() -> None:
    try:
        raise ConnectionError("redis://:hunter2@cache:6379 refused")
    except ConnectionError:
        exc_info = sys.exc_info()
    record = logging.LogRecord(
        "reviewer", logging.WARNING, __file__, 1, "check failed", None, exc_info
    )
    line = JsonFormatter().format(record)
    entry = json.loads(line)
    assert entry["level"] == "warning"
    assert entry["message"] == "check failed"
    assert entry["exception"] == "ConnectionError"
    assert "hunter2" not in line
