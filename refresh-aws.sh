#!/bin/bash

echo "Logging into AWS..."
aws login

echo "Extracting new credentials..."
CREDS=$(cat ~/.aws/login/cache/*.json | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(d['accessToken']['accessKeyId'])
print(d['accessToken']['secretAccessKey'])
print(d['accessToken']['sessionToken'])
")

ACCESS_KEY=$(echo "$CREDS" | sed -n '1p')
SECRET_KEY=$(echo "$CREDS" | sed -n '2p')
SESSION_TOKEN=$(echo "$CREDS" | sed -n '3p')

echo "Updating .env file..."
sed -i "s/^AWS_ACCESS_KEY_ID=.*/AWS_ACCESS_KEY_ID=$ACCESS_KEY/" .env
sed -i "s/^AWS_SECRET_ACCESS_KEY=.*/AWS_SECRET_ACCESS_KEY=$SECRET_KEY/" .env
sed -i "s/^AWS_SESSION_TOKEN=.*/AWS_SESSION_TOKEN=$SESSION_TOKEN/" .env

echo "Restarting containers..."
sudo docker compose down && sudo docker compose up --build -d

echo "Done!"