#!/bin/bash
set -e

GATEWAY_URL="http://localhost:3000"
DB_URL="postgres://postgres:postgres@localhost:5432/cloud_sentinel"

echo "=== Cloud-Sentinel Test Flow ==="
echo ""

# 1. Register user
echo "1. Registering user..."
REGISTER_RESPONSE=$(curl -s -X POST "$GATEWAY_URL/api/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}')
echo "Response: $REGISTER_RESPONSE"
USER_ID=$(echo $REGISTER_RESPONSE | grep -o '"id":[0-9]*' | grep -o '[0-9]*' | head -1)
echo "User ID: $USER_ID"
echo ""

# 2. Login
echo "2. Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "$GATEWAY_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}')
echo "Response: $LOGIN_RESPONSE"
TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | sed 's/"token":"//')
echo "Token: $TOKEN"
echo ""

if [ -z "$TOKEN" ]; then
  echo "ERROR: Failed to get token"
  exit 1
fi

# 3. Queue audit
echo "3. Queuing audit task..."
AUDIT_RESPONSE=$(curl -s -X POST "$GATEWAY_URL/api/audit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"params":{"scope":"default"}}')
echo "Response: $AUDIT_RESPONSE"
echo ""

# 4. Wait for worker to process
echo "4. Waiting 5 seconds for worker to process..."
sleep 5
echo ""

# 5. Fetch reports
echo "5. Fetching reports..."
REPORTS_RESPONSE=$(curl -s -X GET "$GATEWAY_URL/api/reports" \
  -H "Authorization: Bearer $TOKEN")
echo "Response: $REPORTS_RESPONSE"
REPORT_COUNT=$(echo $REPORTS_RESPONSE | grep -o '"count":[0-9]*' | grep -o '[0-9]*' | head -1)
echo "Reports found: $REPORT_COUNT"
echo ""

echo "6. Test Summary:"
if [ "$REPORT_COUNT" -gt "0" ]; then
  echo "✅ SUCCESS: Audit report was created and stored!"
  echo "Total reports: $REPORT_COUNT"
else
  echo "⚠️  No reports found yet. Checking worker logs..."
  echo ""
  echo "=== Worker Logs (last 30 lines) ==="
  sudo docker compose logs --tail=30 worker
fi
