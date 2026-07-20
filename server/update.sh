#!/usr/bin/env bash
# PCC — Proxmox Command Center
# Full update: pulls latest from GitHub, copies files, restarts service.
# Installed to /usr/local/bin/pcc-update by setup.sh.
# Run as root: pcc-update

set -euo pipefail

REPO="https://github.com/bclaremont/proxmox-dashboard.git"
TMP="/tmp/pcc-update-$$"

echo "=== PCC Update ==="
echo "Fetching latest from GitHub..."
git clone --depth 1 --quiet "$REPO" "$TMP"

echo "Copying files..."
cp "$TMP/server/server.js"       /opt/pcc/server.js
cp "$TMP/server/package.json"    /opt/pcc/package.json
cp "$TMP/server/reset-2fa.js"    /opt/pcc/reset-2fa.js
cp "$TMP/proxmox-dashboard.html" /opt/pcc/public/index.html
cp "$TMP/console.html"           /opt/pcc/public/console.html
cp -r "$TMP/vendor"              /opt/pcc/public/vendor

echo "Installing dependencies..."
cd /opt/pcc && npm install --omit=dev --silent

echo "Restarting service..."
systemctl restart pcc

rm -rf "$TMP"

echo ""
echo "=== Done ==="
systemctl status pcc --no-pager -l | head -10
