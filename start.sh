#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ ! -f infra/.env ]]; then
  echo 'Configure infra/.env from infra/.env.example before starting.' >&2
  exit 1
fi
# Refresh local aws login credentials by default. Roles can opt out.
case "${1:-}" in
  ''|--refresh-aws) refresh_aws=true ;;
  --skip-aws-refresh) refresh_aws=false ;;
  *) echo 'Usage: ./start.sh [--refresh-aws|--skip-aws-refresh]' >&2; exit 2 ;;
esac
if (( $# > 1 )); then
  echo 'Usage: ./start.sh [--refresh-aws|--skip-aws-refresh]' >&2
  exit 2
fi
if [[ "$refresh_aws" == true ]]; then
  if ! command -v aws >/dev/null 2>&1; then
    echo 'Install AWS CLI v2 with aws login support, or use --skip-aws-refresh for a workload role.' >&2
    exit 1
  fi
  umask 077
  credentials_tmp=$(mktemp .aws.env.tmp.XXXXXX)
  trap 'rm -f -- "$credentials_tmp"' EXIT
  # Explicit profile selection prevents stale shell credentials overriding login.
  aws_profile="${AWS_PROFILE:-${AWS_DEFAULT_PROFILE:-default}}"
  if ! aws configure export-credentials --profile "$aws_profile" --format env-no-export > "$credentials_tmp"; then
    echo "AWS session unavailable; running aws login for profile '$aws_profile'." >&2
    aws login --profile "$aws_profile"
    aws configure export-credentials --profile "$aws_profile" --format env-no-export > "$credentials_tmp"
  fi
  if [[ ! -s "$credentials_tmp" ]]; then
    echo 'AWS credential export was empty; refusing to start with stale credentials.' >&2
    exit 1
  fi
  mv -- "$credentials_tmp" .aws.env
  trap - EXIT
  echo "Refreshed AWS credentials for profile '$aws_profile'."
fi
exec sudo docker compose --env-file infra/.env -f infra/docker-compose.yml up --build
