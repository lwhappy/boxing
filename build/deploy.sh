#!/usr/bin/env bash
#
# Deploy the SilentJab static site to Cloudflare.
#
# The site lives in ./web and is published as-is (no build step).
#
# The site is a Cloudflare **Worker with static assets** (not a Pages
# project): wrangler.jsonc declares
#
#   name:    boxing-3
#   assets:  { directory: "web" }
#   routes:  [ { pattern: "silentjab.com", custom_domain: true } ]
#
# so `wrangler deploy` uploads ./web as the Worker's static assets and binds
# the silentjab.com custom domain to it. Paths match the repo, e.g.
# web/media/glb/index.glb -> /media/glb/index.glb.
#
# Usage:
#   ./build/deploy.sh                 # deploy the current working tree
#   ./build/deploy.sh --dry-run       # compile + upload plan, no changes
#   WRANGLER_ARGS=--keep-vars ./build/deploy.sh
#
# Auth: run `wrangler login` once, or export CLOUDFLARE_API_TOKEN
# (plus CLOUDFLARE_ACCOUNT_ID if the token is not scoped to one account).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
WEB_DIR="$ROOT_DIR/web"
CONFIG_FILE="$ROOT_DIR/wrangler.jsonc"

echo "=============================================="
echo " SilentJab → Cloudflare Worker (static assets)"
echo "=============================================="
echo "  source : $WEB_DIR"
echo "  config : $CONFIG_FILE"
echo

if [ ! -d "$WEB_DIR" ]; then
  echo "ERROR: $WEB_DIR not found." >&2
  exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo "ERROR: $CONFIG_FILE not found." >&2
  exit 1
fi

# Locate wrangler: prefer a local install, fall back to a global one, then npx.
if [ -f "$ROOT_DIR/node_modules/.bin/wrangler" ]; then
  WRANGLER=("$ROOT_DIR/node_modules/.bin/wrangler")
elif command -v wrangler >/dev/null 2>&1; then
  WRANGLER=(wrangler)
else
  WRANGLER=(npx --yes wrangler@4)
fi

echo "Using: ${WRANGLER[*]}"
echo

# The sandbox this repo is built in exports a local HTTP proxy that wrangler's
# fetch cannot use (it fails with "A fetch request failed"). Unset it for the
# deploy so the CLI talks to the Cloudflare API directly.
if [ -n "${HTTP_PROXY:-}${HTTPS_PROXY:-}" ]; then
  echo "Unsetting HTTP(S)_PROXY for the deploy (wrangler cannot use the local proxy)."
  unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
  echo
fi

cd "$ROOT_DIR"

# wrangler reads the Worker name, the assets directory and the custom-domain
# route from wrangler.jsonc, so no CLI flags are needed for those.
if [ -n "${WRANGLER_ARGS:-}" ]; then
  # shellcheck disable=SC2206
  EXTRA_ARGS=(${WRANGLER_ARGS})
  "${WRANGLER[@]}" deploy "${EXTRA_ARGS[@]}" "$@"
else
  "${WRANGLER[@]}" deploy "$@"
fi

echo
echo "Done. Verify:"
echo "  https://silentjab.com/"
echo "  https://silentjab.com/moves/"
echo "  https://silentjab.com/combos/"
echo "  https://silentjab.com/training/"
echo "  https://silentjab.com/moves/jab"
echo
echo "  Worker preview: https://boxing-3.532279470.workers.dev/"
