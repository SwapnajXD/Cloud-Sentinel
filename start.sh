#!/bin/bash

set -e

echo "🔐 Logging into AWS..."
aws login

echo "📦 Exporting AWS credentials..."
aws configure export-credentials --format env > .aws.env

echo "✅ Credentials saved to .aws.env"

echo "🐳 Starting Docker..."
sudo docker compose -f infra/docker-compose.yml \
  --env-file .aws.env \
  up --build