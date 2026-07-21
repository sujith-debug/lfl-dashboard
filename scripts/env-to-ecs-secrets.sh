#!/usr/bin/env bash
# Generate ECS secrets JSON entries from a .env.<env> file.
#
# Usage:
#   ./scripts/env-to-ecs-secrets.sh <env> <app-name> <aws-account-id> [region]
#
# Example:
#   ./scripts/env-to-ecs-secrets.sh dev my-app 230075660465 ap-south-1

set -euo pipefail

ENV="${1:-}"
APP_NAME="${2:-}"
AWS_ACCOUNT_ID="${3:-}"
REGION="${4:-ap-south-1}"

if [[ -z "$ENV" || -z "$APP_NAME" || -z "$AWS_ACCOUNT_ID" ]]; then
  echo "Usage: $0 <environment> <app-name> <aws-account-id> [region]"
  exit 1
fi

ENV_FILE=".env.${ENV}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found"
  exit 1
fi

echo "["
first=1
while IFS='=' read -r key value || [[ -n "$key" ]]; do
  [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
  upper_key=$(echo "$key" | tr '[:lower:]' '[:upper:]' | xargs)
  if [[ $first -eq 0 ]]; then
    echo ","
  fi
  first=0
  printf '  { "name": "%s", "valueFrom": "arn:aws:ssm:%s:%s:parameter/%s/%s/build/%s" }' \
    "$upper_key" "$REGION" "$AWS_ACCOUNT_ID" "$ENV" "$APP_NAME" "$upper_key"
done < "$ENV_FILE"
echo
echo "]"
