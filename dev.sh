#!/bin/bash

echo "🚀 Starting Cloud Sentinel (LOCAL DEV MODE)"

# ✅ Kill ports safely
lsof -ti:3000 | xargs -r kill -9
lsof -ti:3001 | xargs -r kill -9

# ✅ Cleanup old containers
sudo docker rm -f sentinel-postgres sentinel-redis >/dev/null 2>&1

# =========================
# ✅ Start Postgres
# =========================
echo "🐘 Starting Postgres..."
sudo docker run -d \
  --name sentinel-postgres \
  -p 5432:5432 \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=cloud_sentinel \
  postgres:15-alpine

# =========================
# ✅ Wait for Postgres
# =========================
echo "⏳ Waiting for Postgres..."
for i in {1..25}; do
  sudo docker exec sentinel-postgres pg_isready -U postgres > /dev/null 2>&1 && \
    echo "✅ Postgres ready" && break
  echo "Waiting for Postgres ($i/25)..."
  sleep 1
done
sleep 3

# =========================
# ✅ Start Redis
# =========================
echo "📦 Starting Redis..."
sudo docker run -d \
  --name sentinel-redis \
  -p 6379:6379 \
  redis:7-alpine

# =========================
# ✅ Wait for Redis
# =========================
echo "⏳ Waiting for Redis..."
for i in {1..20}; do
  nc -z localhost 6379 >/dev/null 2>&1 && echo "✅ Redis ready" && break
  echo "Waiting for Redis ($i/20)..."
  sleep 1
done

# =========================
# ✅ AWS creds
# =========================
echo "🔐 Loading AWS credentials..."
eval $(aws configure export-credentials --format env)

# =========================
# ✅ Start Gateway
# =========================
echo "🌐 Starting Gateway..."
cd gateway
npm install
DATABASE_URL=postgres://postgres:postgres@localhost:5432/cloud_sentinel \
REDIS_URL=redis://localhost:6379 \
npx ts-node src/server.ts &
cd ..
sleep 3

# =========================
# ✅ Start Worker
# =========================
echo "⚙️ Starting Worker..."
cd worker

if [ ! -d ".venv" ]; then
  python -m venv .venv
fi

source .venv/bin/activate
pip install -r requirements.txt

DATABASE_URL=postgres://postgres:postgres@localhost:5432/cloud_sentinel \
REDIS_URL=redis://localhost:6379 \
python worker.py &

cd ..
sleep 2

# =========================
# ✅ Start Dashboard
# =========================
echo "🖥️ Starting Dashboard..."
cd dashboard

if [ ! -f .env.local ]; then
  echo "NEXT_PUBLIC_BACKEND_URL=http://localhost:3000" > .env.local
fi

npm install
npm run dev -- -p 3001 &
cd ..

echo ""
echo "✅ ALL SERVICES STARTED"
echo "🌐 Dashboard: http://localhost:3001"
echo "🔗 Backend:   http://localhost:3000"
echo ""

wait