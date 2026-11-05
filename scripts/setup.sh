#!/usr/bin/env bash
# DocInsight Health: ONE-TIME setup, run on your own computer.
#   bash scripts/setup.sh
# It signs in to Google, switches on the services DocInsight needs, stores your
# Anthropic key securely in Google Secret Manager, and creates a keyless link so
# GitHub can deploy future updates by itself. No keys are written to disk or GitHub.
set -euo pipefail
PROJECT="docinsight-health"
REPO="Tundeshield/docinsight-health"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

say() { printf "\n\033[1;32m==> %s\033[0m\n" "$1"; }
fail() { printf "\n\033[1;31m%s\033[0m\n" "$1"; exit 1; }

if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true; fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 20 ]; then
  if command -v nvm >/dev/null 2>&1; then say "Installing Node 20 (one time)"; nvm install 20 >/dev/null; nvm use 20 >/dev/null
  else fail "Node.js 20 or newer is needed. Install the LTS version from https://nodejs.org, then run this again."; fi
fi

say "Installing the Firebase tools (one time, about a minute)"
mkdir -p scripts/.tools
npm install --prefix scripts/.tools firebase-tools@14 --no-audit --no-fund --silent >/dev/null
FB="$ROOT/scripts/.tools/node_modules/.bin/firebase"

ACCOUNT=""
find_account() {
  ACCOUNT=""
  for email in $("$FB" login:list 2>/dev/null | grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' | sort -u); do
    if "$FB" projects:list --non-interactive --account "$email" 2>/dev/null | grep -q "$PROJECT"; then ACCOUNT="$email"; return 0; fi
  done
  return 1
}
if ! find_account; then
  say "Signing in. A Google window will open: choose the account that owns $PROJECT and click Allow."
  if "$FB" login:list 2>/dev/null | grep -q "@"; then "$FB" login:add || true; else "$FB" login || true; fi
  find_account || { "$FB" login --reauth || true; find_account; } || fail "None of your Google accounts can see $PROJECT. Check which account owns it at https://console.firebase.google.com and choose that one."
fi
echo "   Using $ACCOUNT"

say "Setting up Google Cloud for DocInsight"
node scripts/setup-cloud.mjs "$PROJECT" "$ROOT/scripts/.tools/node_modules/firebase-tools" "$ACCOUNT" "$REPO"

say "All done on your side."
echo "   Tell Claude \"setup finished\". From now on Claude deploys every update through GitHub; you don't need to run anything again."
