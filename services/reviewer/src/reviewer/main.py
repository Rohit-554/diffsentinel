"""Process entry point: validate settings, configure logging, serve HTTP."""

import logging
import sys

import uvicorn

from reviewer.app import create_app
from reviewer.config import ConfigError, load_settings
from reviewer.logging_setup import configure_logging


def main() -> None:
    try:
        settings = load_settings()
    except ConfigError as exc:
        # Exit before opening the port. The message names variables, not values.
        configure_logging("info")
        logging.getLogger("reviewer.config").critical(str(exc))
        sys.exit(1)

    configure_logging(settings.log_level)
    uvicorn.run(
        create_app(settings),
        host="0.0.0.0",  # noqa: S104  # runs in a container; the port mapping limits exposure
        port=settings.reviewer_port,
        log_config=None,  # use the JSON root logger configured above
    )


if __name__ == "__main__":
    main()
