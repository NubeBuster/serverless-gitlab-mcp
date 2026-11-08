#!/usr/bin/env bash
# Build and run serverless-gitlab-mcp on a VPS with Docker.
# Run from a checkout:   ./install.sh
# Config via env vars:   GITLAB_URL GITLAB_TOKEN MCP_AUTH_TOKEN ALLOWED_PROJECTS PORT
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
command -v docker > /dev/null || {
    echo "docker is required: https://docs.docker.com/engine/install/" >&2
    exit 1
}

PORT="${PORT:-8787}"
NAME=serverless-gitlab-mcp

docker build -t "$NAME" .
docker rm -f "$NAME" > /dev/null 2>&1 || true
docker run -d --name "$NAME" --restart unless-stopped \
    -p "${PORT}:8787" \
    -e GITLAB_URL="${GITLAB_URL:-https://invent.kde.org}" \
    -e GITLAB_TOKEN="${GITLAB_TOKEN:-}" \
    -e MCP_AUTH_TOKEN="${MCP_AUTH_TOKEN:-}" \
    -e ALLOWED_PROJECTS="${ALLOWED_PROJECTS:-}" \
    "$NAME" > /dev/null

echo "Running on :${PORT}. MCP endpoint: http://<host>:${PORT}/mcp"
echo "Gemini needs HTTPS: put a reverse proxy (Caddy, Traefik, Coolify) in front of it."
