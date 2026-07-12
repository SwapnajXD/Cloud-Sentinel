#!/bin/bash

set -e

echo "🔐 Logging into AWS..."
aws login

echo "📦 Exporting AWS credentials..."
aws configure export-credentials --format env > .aws.env

echo "✅ Credentials saved to .aws.env"

if [ ! -f infra/.env ]; then
  echo "⚠️  infra/.env not found - copy infra/.env.example to infra/.env and fill it in"
  echo "   (JWT_SECRET, ALLOWED_ORIGIN, POSTGRES_PASSWORD, etc. all live there)."
  exit 1
fi

echo "🐳 Starting Docker..."
# Both files are needed: infra/.env carries JWT_SECRET/ALLOWED_ORIGIN/etc,
# .aws.env carries the freshly-exported AWS credentials. Passing only one
# --env-file would silently drop the other's variables from interpolation.
sudo docker compose -f infra/docker-compose.yml \
  --env-file infra/.env \
  --env-file .aws.env \
  up --build