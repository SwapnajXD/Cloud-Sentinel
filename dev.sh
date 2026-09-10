#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ ! -f infra/.env || ! -d gateway/node_modules || ! -d dashboard/node_modules || ! -x .venv/bin/python ]]; then
  echo 'See docs/DEPLOYMENT.md: configure infra/.env and install service dependencies first.' >&2
  exit 1
fi
set -a
source infra/.env
if [[ -f .aws.env ]]; then source .aws.env; fi
set +a
export NODE_ENV=development PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=cloud_sentinel PGUSER=postgres
export PGPASSWORD="$POSTGRES_PASSWORD" REDIS_URL=redis://127.0.0.1:6379 BACKEND_URL=http://127.0.0.1:3000
unset DATABASE_URL
# Start dependencies separately; this script never removes containers or kills port owners.
children=()
cleanup() { for pid in "${children[@]}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM
npm run start:ts --prefix gateway & children+=("$!")
.venv/bin/python worker/worker.py & children+=("$!")
npm run dev --prefix dashboard -- -p 3001 & children+=("$!")
echo 'Dashboard: http://localhost:3001 · Gateway: http://localhost:3000'
wait -n
