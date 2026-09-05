#!/bin/bash
# ============================================================
# AXIS-5 Robot Control — deb after-install script
# 1) Fixes the Chrome SUID sandbox bit so the app launches on
#    Ubuntu 23.10 / 24.04+ (AppArmor user-namespace restrictions).
# 2) Refreshes the desktop & icon caches so the menu icon shows up.
# ============================================================
APP_DIR="/opt/AXIS-5 Robot Control"

if [ -e "$APP_DIR/chrome-sandbox" ]; then
  chmod 4755 "$APP_DIR/chrome-sandbox" 2>/dev/null || true
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t /usr/share/icons/hicolor >/dev/null 2>&1 || true
fi

exit 0
