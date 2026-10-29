#!/usr/bin/env bash
# DocInsight Health: one-time Firebase setup and deploy.
# Run from the repository folder:  bash scripts/setup.sh
set -euo pipefail
PROJECT="docinsight-health"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

say() { printf "\n\033[1;32m==> %s\033[0m\n" "$1"; }
fail() { printf "\n\033[1;31m%s\033[0m\n" "$1"; exit 1; }

# Node 20 or newer is needed by the Firebase tools
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true; fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 20 ]; then
  if command -v nvm >/dev/null 2>&1; then say "Installing Node 20 (one time)"; nvm install 20 >/dev/null; nvm use 20 >/dev/null
  else fail "Node.js 20 or newer is needed. Install it from https://nodejs.org (the LTS version), then run this again."; fi
fi

say "Installing the Firebase tools (one time, about a minute)"
mkdir -p scripts/.tools
npm install --prefix scripts/.tools firebase-tools@15 --no-audit --no-fund --silent >/dev/null
FB="$ROOT/scripts/.tools/node_modules/.bin/firebase"

if ! "$FB" login:list 2>/dev/null | grep -q "@"; then
  say "Signing in to Firebase. A Google window will open: choose the account that owns $PROJECT and click Allow."
  "$FB" login
fi

say "Switching on Firebase services, the database, file storage and permissions"
node scripts/setup-cloud.mjs "$PROJECT" "$ROOT/scripts/.tools/node_modules/firebase-tools"

say "Installing the server code's packages"
npm ci --prefix functions --no-audit --no-fund --silent >/dev/null

say "Deploying the server, database rules and storage rules (5 to 10 minutes the first time)"
deploy() { "$FB" deploy --only firestore,storage,functions --project "$PROJECT" --force --non-interactive; }
if ! deploy; then
  say "First deploys sometimes fail while Google finishes switching services on. Waiting 90 seconds and trying again."
  sleep 90
  deploy || fail "The deploy failed. Copy everything above this line and send it to Claude."
fi

say "Done. DocInsight Health is live at https://docinsight-health.netlify.app"
echo "Tell Claude it finished, and it will test hospital registration end to end."
