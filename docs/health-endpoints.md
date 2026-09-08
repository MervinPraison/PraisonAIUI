# Health Endpoints Guide

## Overview

PraisonAIUI provides multiple health endpoints optimized for different use cases:

- **`/health/live`** - Fast liveness check (<500ms)
- **`/health/ready`** - Readiness check with optional deep checks
- **`/health`** - Legacy endpoint (backward compatibility)

## Endpoints

### Liveness Check: `/health/live`

Fast endpoint to verify the server is running. Returns immediately with minimal processing.

**Use for:**
- Load balancer health probes
- Kubernetes liveness probes
- High-frequency monitoring

**Response time:** <500ms (typically <100ms)

**Example:**
```bash
curl http://localhost:8082/health/live
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-20T10:30:00.000Z"
}
```

### Readiness Check: `/health/ready`

Verifies the server is ready to handle requests. Performs parallel health checks on all features with timeout protection.

**Use for:**
- Kubernetes readiness probes
- Pre-deployment validation
- Detailed diagnostics

**Query parameters:**
- `?deep=false` - Skip feature checks for faster response

**Response time:** 
- With deep checks: <1s (parallel execution)
- Without deep checks: <200ms

**Example:**
```bash
# Full readiness check
curl http://localhost:8082/health/ready

# Basic readiness (no feature checks)
curl http://localhost:8082/health/ready?deep=false
```

**Response with deep checks:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-20T10:30:00.000Z",
  "provider": {
    "name": "PraisonAIProvider",
    "status": "ok"
  },
  "features": {
    "agents": {"status": "ok", "feature": "agents"},
    "chat": {"status": "ok", "feature": "chat"},
    "memory": {"healthy": false, "detail": "timeout"}
  }
}
```

### API Health: `/api/health`

Cached version of readiness check for dashboard polling. 30-second TTL to reduce load.

**Use for:**
- Dashboard health indicators
- Frequent client polling
- Status pages

**Response:** Same as `/health/ready` but cached for 30 seconds

## Deployment Configurations

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: praisonaiui
spec:
  template:
    spec:
      containers:
      - name: praisonaiui
        image: praisonaiui:latest
        livenessProbe:
          httpGet:
            path: /health/live
            port: 8082
          initialDelaySeconds: 10
          periodSeconds: 10
          timeoutSeconds: 2
        readinessProbe:
          httpGet:
            path: /health/ready?deep=false
            port: 8082
          initialDelaySeconds: 5
          periodSeconds: 5
          timeoutSeconds: 3
```

### AWS ALB/ELB

```terraform
resource "aws_lb_target_group" "praisonaiui" {
  health_check {
    enabled             = true
    path                = "/health/live"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }
}
```

### Docker Compose

```yaml
services:
  praisonaiui:
    image: praisonaiui:latest
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8082/health/live"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

### Nginx

```nginx
upstream praisonaiui {
    server backend1:8082 max_fails=2 fail_timeout=5s;
    server backend2:8082 max_fails=2 fail_timeout=5s;
    
    # Health check configuration
    check interval=5000 rise=2 fall=3 timeout=2000 type=http;
    check_http_send "GET /health/live HTTP/1.0\r\n\r\n";
    check_http_expect_alive http_2xx;
}
```

## Migration Guide

If you're upgrading from a version using only `/health`:

1. **Update monitoring:** Change health checks to use `/health/live` for liveness
2. **Update readiness:** Use `/health/ready?deep=false` for readiness probes
3. **Update dashboards:** Point status indicators to `/api/health` (cached)
4. **Backward compatibility:** The `/health` endpoint remains available but may be slow

## Performance Characteristics

| Endpoint | Cold Start | Warm (p50) | Warm (p95) | Use Case |
|----------|------------|------------|------------|----------|
| `/health/live` | <100ms | <20ms | <50ms | Liveness probes |
| `/health/ready?deep=false` | <200ms | <50ms | <100ms | Basic readiness |
| `/health/ready` | <1s | <500ms | <800ms | Full diagnostics |
| `/api/health` (cached) | <1s* | <20ms | <50ms | Dashboard polling |

*First request only, then cached for 30s

## Troubleshooting

### Slow `/health` responses

If you're seeing slow responses on the legacy `/health` endpoint:
- Switch to `/health/live` for fast checks
- Use `/health/ready?deep=false` if you don't need feature health
- Enable caching with `/api/health` for frequent polling

### Feature timeouts

Features that timeout in `/health/ready` will show:
```json
{
  "feature_name": {
    "healthy": false,
    "detail": "timeout"
  }
}
```

This indicates the feature took longer than 500ms to respond. The server is still operational, but that specific feature may be experiencing issues.

### High latency under load

Under high load, use `/health/live` exclusively for monitoring. It has minimal overhead and won't impact performance.