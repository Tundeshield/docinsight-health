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

# Find a signed-in Google account that can see this project; if none can, add one.
ACCOUNT=""
find_account() {
  ACCOUNT=""
  for email in $("$FB" login:list 2>/dev/null | grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' | sort -u); do
    if "$FB" projects:list --non-interactive --account "$email" 2>/dev/null | grep -q "$PROJECT"; then ACCOUNT="$email"; return 0; fi
  done
  return 1
}
if ! find_account; then
  if "$FB" login:list 2>/dev/null | grep -q "@"; then
    say "None of your saved Firebase sign-ins can see $PROJECT. A Google window will open: choose the Google account you used to create $PROJECT (it's the one signed in to the Firebase console where you copied the config), and click Allow."
    "$FB" login:add || true
  else
    say "Signing in to Firebase. A Google window will open: choose the account that owns $PROJECT and click Allow."
    "$FB" login
  fi
  find_account || fail "None of your signed-in Google accounts can see the $PROJECT project. Open https://console.firebase.google.com, check which account owns $PROJECT (top-right avatar), then run the setup again and choose that account."
fi
echo "   Using $ACCOUNT"

say "Switching on Firebase services, the database, file storage and permissions"
node scripts/setup-cloud.mjs "$PROJECT" "$ROOT/scripts/.tools/node_modules/firebase-tools" "$ACCOUNT"

say "Installing the server code's packages"
npm ci --prefix functions --no-audit --no-fund --silent >/dev/null

say "Deploying the server, database rules and storage rules (5 to 10 minutes the first time)"
deploy() { "$FB" deploy --only firestore,storage,functions --project "$PROJECT" --account "$ACCOUNT" --force --non-interactive; }
if ! deploy; then
  say "First deploys sometimes fail while Google finishes switching services on. Waiting 90 seconds and trying again."
  sleep 90
  deploy || fail "The deploy failed. Copy everything above this line and send it to Claude."
fi

say "Done. DocInsight Health is live at https://docinsight-health.netlify.app"
echo "Tell Claude it finished, and it will test hospital registration end to end."
