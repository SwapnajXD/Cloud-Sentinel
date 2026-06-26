# 🛠️ Troubleshooting

This guide covers common issues you may encounter while developing or running Cloud-Sentinel and provides recommended solutions.

---

# AWS Credentials

## Error

```text id="wv2w76"
Unable to locate credentials
```

### Cause

AWS credentials have not been configured or exported.

### Solution

Login to AWS:

```bash id="cy4kud"
aws login
```

Verify your identity:

```bash id="lzyt76"
aws sts get-caller-identity
```

Restart the application:

```bash id="8gt0g0"
./start.sh
```

---

# Worker Not Processing Jobs

## Symptoms

* Audit requests remain queued.
* No audit reports are generated.

### Check Worker Logs

```bash id="tfuy9o"
docker compose logs -f worker
```

### Verify Redis

```bash id="s2saf9"
docker compose logs redis
```

### Restart the Worker

```bash id="aajd1e"
docker compose restart worker
```

---

# Redis Connection Issues

## Symptoms

* Gateway cannot enqueue audit jobs.
* Worker cannot retrieve tasks.

### Verify Redis Container

```bash id="9m2frg"
docker compose ps
```

### Restart Redis

```bash id="wejlwm"
docker compose restart redis
```

### Check Redis Logs

```bash id="yfxkfw"
docker compose logs redis
```

---

# PostgreSQL Issues

## View Database Logs

```bash id="n8vfe9"
docker compose logs postgres
```

### Connect to PostgreSQL

```bash id="w67k7r"
docker exec -it infra-db-1 psql -U postgres -d cloud_sentinel
```

### Verify Tables

```sql id="2f91qb"
\dt
```

---

# Gateway Not Starting

## View Logs

```bash id="6v17ho"
docker compose logs gateway
```

### Common Causes

* Missing environment variables
* Port already in use
* Database unavailable

Check running services:

```bash id="08m3xw"
docker compose ps
```

---

# Dashboard Not Loading

## Check Dashboard Logs

```bash id="22e3aj"
docker compose logs dashboard
```

### Verify NGINX

```bash id="6a31g6"
docker compose logs nginx
```

Ensure the Dashboard container is running:

```bash id="c51yjc"
docker compose ps
```

---

# Docker Issues

## Rebuild Containers

```bash id="y9m6qg"
docker compose up --build
```

### Restart Everything

```bash id="4ibkdz"
docker compose down
docker compose up -d
```

### Remove Containers and Volumes

> **Warning:** This removes local database data.

```bash id="u4x7fo"
docker compose down -v
```

---

# Verify All Services

List running containers:

```bash id="bm4n8f"
docker compose ps
```

Expected services:

* gateway
* worker
* dashboard
* postgres
* redis
* nginx

---

# Health Check

Verify the Gateway API is running:

```bash id="j7v4ea"
curl http://localhost/health
```

Expected response:

```json id="2vuv1z"
{
  "status": "ok"
}
```

---

# Useful Docker Commands

View logs for all services:

```bash id="mm1qzv"
docker compose logs -f
```

Restart a specific service:

```bash id="btr4zs"
docker compose restart worker
```

Stop all services:

```bash id="wgzwoz"
docker compose down
```

List running containers:

```bash id="6j2mhl"
docker compose ps
```

---

# Still Having Issues?

If the problem persists:

1. Verify AWS credentials.
2. Ensure Docker services are running.
3. Check Redis connectivity.
4. Confirm PostgreSQL is accessible.
5. Review Gateway and Worker logs.
6. Restart the application using:

```bash id="slf3g7"
./start.sh
```

If the issue remains unresolved, inspect the logs for the affected service and verify your environment configuration.
