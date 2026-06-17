# Deployment Guide

Deploy the OAN Notification Service to a remote Linux server using a pre-built Docker image.

## Prerequisites

**Local machine**

- Docker
- `scp` access to the target server

**Remote server** (`10.128.188.7`)

- Docker and Docker Compose
- PostgreSQL reachable from the container (usually via `host.docker.internal`)
- Project directory: `~/oan-notification-service`

## 1. Build the image (local)

From the project root:

```bash
docker build --platform linux/amd64 -t oan-notification-service:latest .
```

## 2. Export and transfer the image

```bash
docker save oan-notification-service:latest | gzip > oan-notification-service.tar.gz
scp -P 9822 oan-notification-service.tar.gz akshat@10.128.188.7:~/oan-notification-service/
```

Also copy `docker-compose.yml` and `.env` if they changed:

```bash
scp -P 9822 docker-compose.yml .env akshat@10.128.188.7:~/oan-notification-service/
```

## 3. Load and start (remote server)

SSH into the server:

```bash
ssh -p 9822 akshat@10.128.188.7
```

Then:

```bash
cd ~/oan-notification-service

docker load < oan-notification-service.tar.gz
docker compose up -d
```

## 4. Verify

```bash
docker compose ps
docker compose logs -f app
curl http://localhost:3000/health
```

Replace `3000` with the `PORT` value from your `.env` if different.

## Environment

Create `.env` on the server before the first deploy. Minimum required variables:

```env
NODE_ENV=production
PORT=3000

DB_HOST=host.docker.internal
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_DATABASE=oan_notification

REDIS_HOST=redis
LOG_LEVEL=info
NOTIFICATION_RADIUS_KM=2
```

`docker-compose.yml` overrides `REDIS_HOST` to `redis` for the bundled Redis container. Set `DB_HOST=host.docker.internal` when PostgreSQL runs on the host machine.

## Redeploy after code changes

Repeat from step 1:

```bash
# local
docker build --platform linux/amd64 -t oan-notification-service:latest .
docker save oan-notification-service:latest | gzip > oan-notification-service.tar.gz
scp -P 9822 oan-notification-service.tar.gz akshat@10.128.188.7:~/oan-notification-service/

# remote
cd ~/oan-notification-service
docker load < oan-notification-service.tar.gz
docker compose up -d
```

## Useful commands

```bash
# stop services
docker compose down

# restart app only
docker compose restart app

# view app logs
docker compose logs -f app

# remove old unused images
docker image prune -f
```

## Troubleshooting

| Issue | Check |
|-------|-------|
| App cannot reach PostgreSQL | `DB_HOST=host.docker.internal` in `.env`; PostgreSQL listening on host port `5432` |
| Port already in use | Change `PORT` in `.env` and the `ports` mapping in `docker-compose.yml` |
| Redis not ready | `docker compose logs redis`; wait for healthcheck to pass |
| Image architecture mismatch | Always build with `--platform linux/amd64` on Apple Silicon |
