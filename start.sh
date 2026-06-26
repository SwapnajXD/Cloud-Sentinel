#!/bin/bash

# export AWS creds automatically
eval $(aws configure export-credentials --format env)

# run docker with env
sudo docker compose -f infra/docker-compose.yml up --build
