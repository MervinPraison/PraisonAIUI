# Production Dockerfile for AIUI
# Minimal image with health check and configurable port

FROM python:3.12-slim AS base

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AIUI_PORT=8082 \
    AIUI_HOST=0.0.0.0

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python package
COPY pyproject.toml README.md ./
COPY src/ src/
RUN pip install --no-cache-dir .

# Expose port
EXPOSE ${AIUI_PORT}

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${AIUI_PORT}/health || exit 1

# Entrypoint
ENTRYPOINT ["aiui", "run"]
CMD ["--host", "0.0.0.0", "--port", "8082"]
