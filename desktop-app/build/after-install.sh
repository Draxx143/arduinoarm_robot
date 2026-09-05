#!/bin/bash
# ============================================================
# AXIS-5 Robot Control — deb after-install script (v1.0.3+)
# 1) Setuid the Chrome sandbox helper (belt & braces).
# 2) Replace /usr/bin/axis5-robot-control with a wrapper that
#    launches the app with --no-sandbox (Ubuntu 23.10+/24.04+
#    AppArmor user-namespace restrictions) and logs every run
#    to ~/.axis5/last-run.log — including menu-icon launches.
# 3) Refresh desktop & icon caches.
# ============================================================
APP_DIR="/opt/AXIS5-Robot-Control"
BIN="$APP_DIR/axis5-robot-control"

if [ -e "$APP_DIR/chrome-sandbox" ]; then
  chmod 4755 "$APP_DIR/chrome-sandbox" 2>/dev/null || true
fi

if [ -x "$BIN" ] && [ -d /usr/bin ]; then
  rm -f /usr/bin/axis5-robot-control
  cat > /usr/bin/axis5-robot-control << 'WRAPPER'
#!/bin/bash
LOG_DIR="$HOME/.axis5"
mkdir -p "$LOG_DIR" 2>/dev/null
LOG_FILE="$LOG_DIR/last-run.log"
{
  echo "=== AXIS-5 launch $(date) | args: $* | session: ${XDG_SESSION_TYPE:-unknown} ==="
} >> "$LOG_FILE" 2>/dev/null
export ELECTRON_DISABLE_SANDBOX=1
EXEC="/opt/AXIS5-Robot-Control/axis5-robot-control"
"$EXEC" --no-sandbox --disable-gpu-sandbox "$@" 2>&1 | tee -a "$LOG_FILE"
exit ${PIPESTATUS[0]}
WRAPPER
  chmod 755 /usr/bin/axis5-robot-control 2>/dev/null || true
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t /usr/share/icons/hicolor >/dev/null 2>&1 || true
fi

exit 0
