#!/bin/sh
# Concatenates src/ into main.js (no bundler or dependencies needed).
set -e
cd "$(dirname "$0")"
cat src/10-util.js src/20-data.js src/30-parts.js src/40-ui.js src/50-modals.js src/55-whatif.js src/60-report.js src/70-plugin.js > main.js
node --check main.js && echo "built main.js"
