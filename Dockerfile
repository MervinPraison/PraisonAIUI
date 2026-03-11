# Production Dockerfile for PraisonAIUI
# Used for hostaibot managed hosting and standalone deployment
#
# Build:  docker build -t praisonaiui:test .
# Run:    docker run --rm -p 8082:8082 -e OPENAI_API_KEY=sk-xxx praisonaiui:test
# Health: curl http://localhost:8082/health

FROM python:3.12-slim AS base

# Environment
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AIUI_PORT=8082 \
    AIUI_HOST=0.0.0.0 \
    AIUI_DATA_DIR=/data

WORKDIR /app

# System dependencies
# - curl: for HEALTHCHECK
# - build-essential: for native Python wheel compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python package with bot channel extras
# [bot] includes: python-telegram-bot, discord.py, slack_sdk, slack-bolt
COPY pyproject.toml README.md ./
COPY src/ src/
RUN pip install --no-cache-dir ".[bot]"

# Copy default app for managed hosting
# Required because `aiui run` needs a positional APP_FILE argument
COPY app.py .

# Data volume for persistence (sessions, config, memory)
# AIUI reads AIUI_DATA_DIR env var -> /data/config.yaml, /data/sessions/
RUN mkdir -p /data
VOLUME /data

# Expose the default AIUI port
EXPOSE 8082

# Health check (hardcoded port for robustness)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8082/health || exit 1

# Entrypoint: aiui run <app_file> [options]
ENTRYPOINT ["aiui", "run"]
CMD ["app.py", "--host", "0.0.0.0", "--port", "8082"]
