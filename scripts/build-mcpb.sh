#!/bin/sh
# Build the one-click Claude Desktop extension: dist/freeshow-mcp.mcpb
set -e
cd "$(dirname "$0")/.."
npm run build
STAGE=$(mktemp -d)
mkdir -p "$STAGE/server"
cp mcpb/manifest.json mcpb/icon.png "$STAGE/"
cp -R dist themes package.json package-lock.json LICENSE "$STAGE/server/"
(cd "$STAGE/server" && npm ci --omit=dev --silent)
npx --yes @anthropic-ai/mcpb validate "$STAGE/manifest.json"
npx --yes @anthropic-ai/mcpb pack "$STAGE" dist/freeshow-mcp.mcpb
rm -rf "$STAGE"
