#!/usr/bin/env bash
set -euxo pipefail

DEPLOY_PATH=${DEPLOY_PATH:-$(pwd)}
cd "$DEPLOY_PATH"

export NVM_DIR="$HOME/.nvm"
mkdir -p "$NVM_DIR"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

if [ -f .nvmrc ]; then
  TARGET_NODE=$(cat .nvmrc)
else
  TARGET_NODE=22.18.0
fi

nvm install "$TARGET_NODE" --no-progress > /dev/null
nvm use "$TARGET_NODE" > /dev/null

if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable || true
  corepack prepare pnpm@9.12.3 --activate || npm install -g pnpm
else
  corepack enable || true
fi

pnpm install --frozen-lockfile || pnpm install
pnpm run build
pnpm prune --prod
