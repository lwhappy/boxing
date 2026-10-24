#!/usr/bin/env bash
#
# Deploy the SilentJab static site to Cloudflare Pages.
#
# The site lives in ./web and is published as-is (no build step).
# Cloudflare Pages serves ./web as the site root, so paths match the repo
# (e.g. web/media/glb/index.glb -> /media/glb/index.glb).
#
# Usage:
#   ./build/deploy.sh                      # uses the default project name
#   PROJECT_NAME=my-proj ./build/deploy.sh
#
# Auth: either run `wrangler login` once, or export CLOUDFLARE_API_TOKEN
# (plus CLOUDFLARE_ACCOUNT_ID if the token is not scoped to one account).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
WEB_DIR="$ROOT_DIR/web"

PROJECT_NAME="${PROJECT_NAME:-silentjab}"
BRANCH="${BRANCH:-main}"

echo "=============================================="
echo " SilentJab → Cloudflare Pages"
echo "=============================================="
echo "  project : $PROJECT_NAME"
echo "  branch  : $BRANCH"
echo "  source  : $WEB_DIR"
echo

if [ ! -d "$WEB_DIR" ]; then
  echo "ERROR: $WEB_DIR not found." >&2
  exit 1
fi

# Locate wrangler: prefer a global install, fall back to npx.
if command -v wrangler >/dev/null 2>&1; then
  WRANGLER=(wrangler)
elif [ -f "$ROOT_DIR/node_modules/.bin/wrangler" ]; then
  WRANGLER=("$ROOT_DIR/node_modules/.bin/wrangler")
else
  WRANGLER=(npx --yes wrangler@4)
fi

echo "Using: ${WRANGLER[*]}"
echo

cd "$WEB_DIR"

# --branch keeps the deploy tied to a named branch so Pages shows it as a
# production branch deployment rather than a throwaway preview.
"${WRANGLER[@]}" pages deploy "$WEB_DIR" \
  --project-name "$PROJECT_NAME" \
  --branch "$BRANCH" \
  --commit-dirty=true

echo
echo "Done. Check:"
echo "  https://$PROJECT_NAME.pages.dev/"
echo "  https://silentjab.com/combo_jab_cross_hook.html"
