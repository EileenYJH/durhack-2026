#!/usr/bin/env bash
# Copy this folder to a Vultr server and set it up. Run from anywhere:
#   bash deploy/deploy.sh <server-ip> [env-file]
#
# The .env file (your API keys) is sent only if you name it, and is never
# committed to git. The first run installs everything; later runs just update.

set -euo pipefail

IP="${1:?usage: deploy.sh <server-ip> [env-file]}"
ENV_FILE="${2:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH="ssh -o StrictHostKeyChecking=accept-new root@$IP"

tar -C "$ROOT" --exclude=.git --exclude=.env --exclude=node_modules -cz . | $SSH 'mkdir -p /opt/rollcall && tar -xz -C /opt/rollcall'
if [ -n "$ENV_FILE" ]; then
  scp -q "$ENV_FILE" "root@$IP:/opt/rollcall/.env"
fi
$SSH 'bash /opt/rollcall/deploy/setup.sh'
