#!/bin/zsh
# Build the Claude Desktop extension: md-books-mcp-<version>.mcpb
# Usage: npm run mcpb
# Builds the server, installs only the runtime dependencies into a clean staging folder
# (so test tools do not end up inside), then packs it with the official mcpb tool.
set -euo pipefail
cd "$(dirname "$0")/.."

pkg_version=$(node -p "require('./package.json').version")
man_version=$(node -p "require('./mcpb/manifest.json').version")
src_version=$(node -p "require('fs').readFileSync('src/version.ts','utf8').match(/\"([^\"]+)\"/)[1]")
if [[ "$pkg_version" != "$man_version" || "$pkg_version" != "$src_version" ]]; then
  echo "Version mismatch: package.json=$pkg_version mcpb/manifest.json=$man_version src/version.ts=$src_version" >&2
  exit 1
fi

npm run build
stage=.mcpb-build
rm -rf "$stage"
mkdir -p "$stage"
cp -R dist csl "$stage"/
cp package.json package-lock.json LICENSE README.md "$stage"/
cp mcpb/manifest.json mcpb/icon.png "$stage"/
(cd "$stage" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)

out="md-books-mcp-$pkg_version.mcpb"
rm -f "$out"
npx --yes @anthropic-ai/mcpb pack "$stage" "$out"
rm -rf "$stage"
echo "Built $out"
