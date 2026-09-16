#!/usr/bin/env bash
# ============================================================
#  AXIS-3 Robot Control — one-click builder for Linux
#  Requires Node.js LTS: https://nodejs.org
# ============================================================
set -e
cd "$(dirname "$0")"

echo "[1/3] Installing dependencies (first run downloads ~110 MB)..."
npm install

echo "[2/3] Building Linux packages..."
npm run dist:linux

echo "[3/3] Done! Look in the dist/ folder:"
echo "   - AXIS3-Robot-Control-1.0.0-x64.AppImage  (run anywhere)"
echo "   - axis3-robot-control_1.0.0_amd64.deb     (Debian/Ubuntu install)"
