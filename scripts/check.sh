#!/usr/bin/env bash
set -euo pipefail
python3 -m compileall -q scripts
node --check scripts/static/app.js
python3 scripts/build.py
node --check dist/app.js
node --check dist/map.js
node --check dist/vendor/leaflet/leaflet.js
python3 scripts/verify.py
python3 scripts/verify_prices.py
python3 scripts/prepare_github_pages.py
node --check .github-pages/app.js
python3 scripts/verify_pages.py
