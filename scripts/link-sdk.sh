#!/usr/bin/env bash
# Link the local @silkysquad/silk SDK into apps/backend without publishing to npm.
#
# Usage:
#   ./scripts/link-sdk.sh           # build SDK + install symlink (run once, or after yarn.lock changes)
#   ./scripts/link-sdk.sh --watch   # build SDK + start tsc --watch (rebuilds on every change)
#   ./scripts/link-sdk.sh --build   # just rebuild the SDK (after making changes)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
SDK_DIR="/Users/si/projects/maxi/silk"
BACKEND_DIR="$REPO_ROOT/apps/backend"

if [ ! -d "$SDK_DIR" ]; then
  echo "error: SDK not found at $SDK_DIR"
  exit 1
fi

build_sdk() {
  echo "==> Building SDK..."
  cd "$SDK_DIR"
  npm run build
  echo "==> SDK built at $SDK_DIR/dist"
}

install_link() {
  echo "==> Installing symlink in backend..."
  cd "$BACKEND_DIR"
  yarn install
  echo "==> Linked: node_modules/@silkysquad/silk -> $SDK_DIR"
}

case "${1:-}" in
  --watch)
    build_sdk
    install_link
    echo "==> Watching SDK for changes (Ctrl-C to stop)..."
    cd "$SDK_DIR"
    npm run dev
    ;;
  --build)
    build_sdk
    ;;
  *)
    build_sdk
    install_link
    echo ""
    echo "Done. Day-to-day workflow:"
    echo "  ./scripts/link-sdk.sh --build   # rebuild after SDK changes"
    echo "  ./scripts/link-sdk.sh --watch   # auto-rebuild on save"
    ;;
esac
