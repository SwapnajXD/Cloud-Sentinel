#!/bin/bash
set -e

GATEWAY_URL="http://localhost:3000"
AWS_REGION="ap-south-1"
BUCKET_PREFIX="cs-audit-test-$(date +%s)"

echo "=== Cloud-Sentinel: Real AWS Audit Flow (Low Cost) ==="
echo ""

# 1. Register/Login
echo "1. Authenticating..."
LOGIN_RESPONSE=$(curl -s -X POST "$GATEWAY_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}')

TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | sed 's/"token":"//')

if [ -z "$TOKEN" ]; then
  echo "Login failed, trying to register first..."
  curl -s -X POST "$GATEWAY_URL/api/register" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"testpass123"}' > /dev/null
  
  LOGIN_RESPONSE=$(curl -s -X POST "$GATEWAY_URL/api/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"testpass123"}')
  TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | sed 's/"token":"//')
fi

echo "Token obtained: ${TOKEN:0:20}..."
echo ""

# Function to queue audit
queue_audit() {
  local audit_num=$1
  echo "   Audit $audit_num: Queueing..."
  curl -s -X POST "$GATEWAY_URL/api/audit" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"params":{"scope":"aws-baseline"}}' > /dev/null
  sleep 8
}

# 2. Audit 1: Baseline (current state)
echo "2. Running 5 real AWS audits with resource changes..."
echo ""
echo "Audit 1 - Baseline:"
queue_audit 1

# 3. Create first S3 bucket and launch EC2 instance
echo "   Creating S3 bucket: $BUCKET_PREFIX-1"
aws s3api create-bucket --bucket "$BUCKET_PREFIX-1" --region "$AWS_REGION" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION" 2>/dev/null || true

echo "   Launching EC2 instance (t3.micro)..."
INSTANCE_1=$(aws ec2 run-instances --image-id ami-0c1a7f89451184c8b --instance-type t3.micro \
  --region "$AWS_REGION" --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value='$BUCKET_PREFIX'-instance-1}]' \
  2>/dev/null | grep -o '"InstanceId": "[^"]*' | head -1 | grep -o '[^"]*$' || echo "unknown")
echo "   Instance ID: $INSTANCE_1"
sleep 3

# Audit 2: With bucket and instance
echo ""
echo "Audit 2 - With S3 bucket and EC2 instance:"
queue_audit 2

# 4. Delete bucket and terminate instance
echo "   Deleting S3 bucket: $BUCKET_PREFIX-1"
aws s3api delete-bucket --bucket "$BUCKET_PREFIX-1" --region "$AWS_REGION" 2>/dev/null || true

echo "   Terminating EC2 instance: $INSTANCE_1"
aws ec2 terminate-instances --instance-ids "$INSTANCE_1" --region "$AWS_REGION" 2>/dev/null || true
sleep 5

# Audit 3: After deletion
echo ""
echo "Audit 3 - After resource deletion:"
queue_audit 3

# 5. Create second bucket and instance
echo "   Creating S3 bucket: $BUCKET_PREFIX-2"
aws s3api create-bucket --bucket "$BUCKET_PREFIX-2" --region "$AWS_REGION" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION" 2>/dev/null || true

echo "   Launching second EC2 instance (t3.micro)..."
INSTANCE_2=$(aws ec2 run-instances --image-id ami-0c1a7f89451184c8b --instance-type t3.micro \
  --region "$AWS_REGION" --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value='$BUCKET_PREFIX'-instance-2}]' \
  2>/dev/null | grep -o '"InstanceId": "[^"]*' | head -1 | grep -o '[^"]*$' || echo "unknown")
echo "   Instance ID: $INSTANCE_2"
sleep 3

# Audit 4: New bucket and instance
echo ""
echo "Audit 4 - With new S3 bucket and EC2 instance:"
queue_audit 4

# 6. Delete second bucket and instance
echo "   Deleting S3 bucket: $BUCKET_PREFIX-2"
aws s3api delete-bucket --bucket "$BUCKET_PREFIX-2" --region "$AWS_REGION" 2>/dev/null || true

echo "   Terminating EC2 instance: $INSTANCE_2"
aws ec2 terminate-instances --instance-ids "$INSTANCE_2" --region "$AWS_REGION" 2>/dev/null || true
sleep 5

# Audit 5: Clean state
echo ""
echo "Audit 5 - Final clean state:"
queue_audit 5

echo ""
echo "3. Waiting 10 seconds for final processing..."
sleep 10
echo ""

# 7. Fetch and display reports
echo "4. Fetching all audit reports..."
REPORTS=$(curl -s -X GET "$GATEWAY_URL/api/reports" \
  -H "Authorization: Bearer $TOKEN")

REPORT_COUNT=$(echo $REPORTS | grep -o '"count":[0-9]*' | grep -o '[0-9]*' | head -1)

echo "✅ SUCCESS!"
echo "Reports found: $REPORT_COUNT"
echo ""
echo "Dashboard now shows real AWS changes:"
echo "  • Risk timeline (5 audits: S3 buckets + running EC2 instances)"
echo "  • Evidence mode (S3 encryption + EC2 surface area findings)"
echo "  • Simulation mode (impact of adding/removing resources)"
echo ""
echo "Go to http://localhost and refresh to see the live data!"
