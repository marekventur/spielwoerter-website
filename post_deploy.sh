#!/usr/bin/env bash
set -euo pipefail

# Run from repo root on the VPS (e.g. /var/www/<name>).
# Reads NAME and PORT from app.config.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f app.config ]]; then
  echo "ERROR: app.config not found in $SCRIPT_DIR"
  exit 1
fi
# shellcheck source=/dev/null
source app.config

export NAME
export PORT

echo "=== Post-deploy: $NAME (port $PORT) ==="
npm ci
npm run build

# Run PM2 as the app owner, not root
APP_USER=$(stat -c '%U' "$SCRIPT_DIR")
if [[ "$EUID" -eq 0 && "$APP_USER" != "root" ]]; then
  sudo -u "$APP_USER" bash -c "
    cd '$SCRIPT_DIR'
    export NAME='$NAME' PORT='$PORT'
    if npx pm2 describe '$NAME' &>/dev/null; then
      echo 'Restarting existing PM2 app: $NAME'
      npx pm2 restart '$NAME' --update-env
    else
      echo 'Starting PM2 app: $NAME'
      npx pm2 start ecosystem.config.cjs
    fi
    npx pm2 save
  "
else
  if npx pm2 describe "$NAME" &>/dev/null; then
    echo "Restarting existing PM2 app: $NAME"
    npx pm2 restart "$NAME" --update-env
  else
    echo "Starting PM2 app: $NAME"
    npx pm2 start ecosystem.config.cjs
  fi
  npx pm2 save
fi

echo "=== Done ==="
