"""Structured JSON logging to stdout."""

import json
import logging
import sys
from datetime import UTC, datetime

from reviewer.config import LogLevel

_LEVELS: dict[LogLevel, int] = {
    "fatal": logging.CRITICAL,
    "error": logging.ERROR,
    "warn": logging.WARNING,
    "info": logging.INFO,
    "debug": logging.DEBUG,
    "verbose": logging.DEBUG,
}


class JsonFormatter(logging.Formatter):
    """One JSON object per line. Exceptions are reduced to their type name so
    driver messages (which can contain hosts or credentials) never reach logs."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, object] = {
            "level": record.levelname.lower(),
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info and record.exc_info[0] is not None:
            entry["exception"] = record.exc_info[0].__name__
        return json.dumps(entry)


def configure_logging(level: LogLevel) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(_LEVELS[level])
