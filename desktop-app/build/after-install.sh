#!/bin/bash
# ============================================================
# AXIS-5 Robot Control — deb after-install script
# 1) Fixes the Chrome SUID sandbox bit (belt & braces; the app
#    also launches with --no-sandbox built in).
# 2) Replaces the /usr/bin launcher symlink with a wrapper that
#    logs every run (including crashes) to ~/.axis5/last-run.log,
#    so failures are diagnosable even when started from the menu.
# 3) Refreshes the desktop & icon caches.
# ============================================================
APP_DIR="/opt/AXIS-5 Robot Control"
BIN="$APP_DIR/axis5-robot-control"

if [ -e "$APP_DIR/chrome-sandbox" ]; then
  chmod 4755 "$APP_DIR/chrome-sandbox" 2>/dev/null || true
fi

# Wrapper launcher: keeps the app path but captures stderr to a log
if [ -x "$BIN" ] && [ -d /usr/bin ]; then
  rm -f /usr/bin/axis5-robot-control
  cat > /usr/bin/axis5-robot-control << 'WRAPPER'
#!/bin/bash
LOG_DIR="$HOME/.axis5"
mkdir -p "$LOG_DIR" 2>/dev/null
LOG_FILE="$LOG_DIR/last-run.log"
{
  echo "=== AXIS-5 launch $(date) | args: $* | session: $XDG_SESSION_TYPE ==="
} >> "$LOG_FILE" 2>/dev/null
EXEC="/opt/AXIS-5 Robot Control/axis5-robot-control"
"$EXEC" "$@" 2>&1 | tee -a "$LOG_FILE"
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
