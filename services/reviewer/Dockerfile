# syntax=docker/dockerfile:1
# Build context: repository root (docker build -f services/reviewer/Dockerfile .)

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.8.3 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1
WORKDIR /app

# Dependencies first, from the lockfile only, so this layer is cached until uv.lock changes.
COPY services/reviewer/pyproject.toml services/reviewer/uv.lock services/reviewer/.python-version services/reviewer/README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY services/reviewer/src ./src
RUN uv sync --frozen --no-dev --no-editable

RUN useradd --system --uid 10001 --no-create-home reviewer
USER reviewer
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["reviewer"]
