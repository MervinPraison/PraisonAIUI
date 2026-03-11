#!/usr/bin/env bash
# Docker build and health check integration test
# Usage: bash tests/integration/test_docker.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE_NAME="aiui:test"
CONTAINER_NAME="aiui-docker-test"
PORT=8099

echo "=== Docker Build Test ==="
docker build -t "$IMAGE_NAME" -f "$PROJECT_ROOT/Dockerfile" "$PROJECT_ROOT"
echo "✅ Build succeeded"

echo "=== Docker Run + Health Check ==="
# Stop and remove any existing container
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

# Start container
docker run -d --name "$CONTAINER_NAME" -p "$PORT:8082" "$IMAGE_NAME"
echo "Container started, waiting for startup..."
sleep 10

# Health check via curl
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/health" || echo "000")
if [ "$STATUS" = "200" ]; then
    echo "✅ Health check passed (HTTP 200)"
else
    echo "❌ Health check failed (HTTP $STATUS)"
    echo "=== Container Logs ==="
    docker logs "$CONTAINER_NAME"
    docker stop "$CONTAINER_NAME" && docker rm "$CONTAINER_NAME"
    exit 1
fi

echo "=== Docker Health Check Built-in ==="
HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "none")
echo "Docker health status: $HEALTH"

echo "=== Cleanup ==="
docker stop "$CONTAINER_NAME" && docker rm "$CONTAINER_NAME"
echo "✅ All Docker tests passed"
