#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ ! -f infra/.env ]]; then
  echo 'Configure infra/.env from infra/.env.example before starting.' >&2
  exit 1
fi
# Credential refresh is explicit. Production can use an instance/task role.
if [[ "${1:-}" == '--refresh-aws' ]]; then
  umask 077
  aws configure export-credentials --format env > .aws.env.tmp
  mv .aws.env.tmp .aws.env
fi
exec docker compose --env-file infra/.env -f infra/docker-compose.yml up --build
