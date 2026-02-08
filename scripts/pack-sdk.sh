#!/usr/bin/env bash
#
# pack-sdk.sh — Build and package the Handshake SDK for local distribution.
#
# The NestJS server serves static files from public/. This script builds the
# SDK, creates a tarball with `npm pack`, and drops it into public/sdk/ so it
# can be installed via:
#
#   npm install -g https://<your-host>/sdk/handshake-sdk-0.1.0.tgz
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK_DIR="$REPO_ROOT/packages/sdk"
OUT_DIR="$REPO_ROOT/public/sdk"

# 1. Build TypeScript → dist/
echo "Building SDK..."
npm run --prefix "$SDK_DIR" build

# 2. Pack into a .tgz tarball
#    npm pack produces a file named from package.json name+version,
#    e.g. @handshake/sdk@0.1.0 → handshake-sdk-0.1.0.tgz
echo "Packing SDK..."
TARBALL=$(npm pack --pack-destination "$OUT_DIR" "$SDK_DIR" 2>/dev/null)

echo "Done → $OUT_DIR/$TARBALL"
