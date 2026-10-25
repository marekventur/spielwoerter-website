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
# Secrets at rest: .env* files here hold production credentials and are read
# only by the app, which pm2-root runs as root. Keep them root-only (600), even
# ones that were placed by hand or written before this was enforced.
for f in .env* */.env*; do
  if [[ -f "$f" ]]; then
    if [[ $EUID -eq 0 ]]; then chown root:root "$f"; fi
    chmod 600 "$f"
  fi
done

npm ci
npm run build

if npx pm2 describe "$NAME" &>/dev/null; then
  echo "Restarting existing PM2 app: $NAME"
  npx pm2 restart "$NAME" --update-env
else
  echo "Starting PM2 app: $NAME"
  npx pm2 start ecosystem.config.cjs
fi

npx pm2 save
echo "=== Done ==="
