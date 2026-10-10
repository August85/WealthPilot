# WealthPilot API + worker image. Build from the repository root (the calc engine is a path dependency):
#
#   docker build -f services/api/Dockerfile -t wealthpilot-api .
#   docker run --env-file services/api/.env -p 8000:8000 wealthpilot-api                       # API
#   docker run --env-file services/api/.env wealthpilot-api python -m wealthpilot_api.worker   # worker
#   docker run --env-file services/api/.env wealthpilot-api alembic upgrade head               # migrations

FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /src
COPY packages/calculation_engine /src/packages/calculation_engine
COPY services/api/pyproject.toml services/api/uv.lock services/api/README.md /src/services/api/
WORKDIR /src/services/api
RUN uv sync --frozen --no-dev --no-install-project --no-editable
COPY services/api /src/services/api
RUN uv sync --frozen --no-dev --no-editable

FROM python:3.12-slim
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=build /src/services/api/.venv /app/.venv
COPY services/api/alembic.ini /app/alembic.ini
COPY services/api/alembic /app/alembic
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 WP_ENV=production WP_EXPORT_DIR=/app/var/exports
RUN mkdir -p /app/var/exports && chown -R app /app/var
USER app
EXPOSE 8000
# probes: GET /healthz (liveness), GET /readyz (database reachable)
CMD ["uvicorn", "wealthpilot_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--no-server-header"]
