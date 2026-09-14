#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
# https://github.com/Draxx143/arduinoarm_robot
# ======================================================================
#  آزادسازیِ پورتِ سریال از دستِ دیمون‌های لینوکس
#
#  چرا: ModemManager هر دستگاهِ سریالِ تازه را با دستورِ AT کاوش می‌کند و
#       DTR را تکان می‌دهد → برد ریست می‌شود و بایت‌هایش را می‌خورد.
#       brltty هم چیپِ CH340 (1a86:7523) را «نمایشگرِ بریل» فرض می‌کند و
#       دستگاه را busy می‌گیرد (Launchpad #1958224).
#       علامتِ هر دو: با زدنِ «اتصال» موتورها سفت می‌شوند (برد ریست شده)
#       ولی RX صفر می‌ماند و هیچ دستوری قبول نمی‌شود.
#
#  چه می‌کند:
#    ۱. قاعده‌ی udev پروژه را در /etc/udev/rules.d نصب می‌کند
#       (ID_MM_DEVICE_IGNORE + مجوزِ dialout + نامِ ثابتِ /dev/axis5)
#    ۲. اگر brltty ادعای CH340 دارد، همان قاعده را در /etc خنثی می‌کند
#       (کپی در /etc/udev/rules.d بر /lib اولویت دارد — بدونِ حذفِ بسته)
#    ۳. udev را reload می‌کند
#
#  اجرا:
#     bash tools/fix-serial-port-ownership.sh            # نصب
#     bash tools/fix-serial-port-ownership.sh --check    # فقط گزارش
#     bash tools/fix-serial-port-ownership.sh --undo     # برگرداندن
# ======================================================================
set -uo pipefail

RULE_NAME="99-axis5-serial.rules"
RULE_DST="/etc/udev/rules.d/$RULE_NAME"
BRLTTY_OVERRIDE="/etc/udev/rules.d/85-brltty.rules"
RAW_URL="https://raw.githubusercontent.com/Draxx143/arduinoarm_robot/arena/01a09f8f-arduinoarm-robot/desktop-app/build/$RULE_NAME"
MODE="install"
case "${1:-}" in
  --check) MODE="check" ;;
  --undo)  MODE="undo" ;;
  ""|install|--install) MODE="install" ;;
  *) echo "usage: $0 [--check|--undo]"; exit 2 ;;
esac

c_g() { printf '\033[32m%s\033[0m\n' "$*"; }
c_y() { printf '\033[33m%s\033[0m\n' "$*"; }
c_r() { printf '\033[31m%s\033[0m\n' "$*"; }
c_b() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }
info(){ printf '  · %s\n' "$*"; }

SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO="sudo"

# ---- فایلِ قاعده را پیدا کن: ریپو → نصبِ اپ → دانلود ----
find_rule() {
  local here; here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  for cand in \
      "$here/desktop-app/build/$RULE_NAME" \
      /opt/*/"$RULE_NAME" \
      /opt/*/resources/"$RULE_NAME" \
      "$HOME/.cache/axis5-installer/$RULE_NAME"; do
    [ -f "$cand" ] && { echo "$cand"; return 0; }
  done
  local tmp="${TMPDIR:-/tmp}/$RULE_NAME"
  if command -v curl >/dev/null 2>&1 && curl -fsSL "$RAW_URL" -o "$tmp" 2>/dev/null; then
    echo "$tmp"; return 0
  fi
  if command -v wget >/dev/null 2>&1 && wget -q "$RAW_URL" -O "$tmp" 2>/dev/null; then
    echo "$tmp"; return 0
  fi
  return 1
}

brltty_claims_ch340() {
  local f
  for f in /lib/udev/rules.d/85-brltty.rules /usr/lib/udev/rules.d/85-brltty.rules; do
    [ -f "$f" ] || continue
    grep -qi '1a86' "$f" && { echo "$f"; return 0; }
  done
  return 1
}

report_state() {
  c_b "── وضعیتِ فعلی"
  if pgrep -x ModemManager >/dev/null 2>&1; then
    info "ModemManager: در حالِ اجرا (pid $(pgrep -x ModemManager | tr '\n' ' '))"
  else
    info "ModemManager: اجرا نمی‌شود"
  fi
  if command -v brltty >/dev/null 2>&1 || [ -n "$(brltty_claims_ch340 || true)" ]; then
    local src; src="$(brltty_claims_ch340 || true)"
    if [ -n "$src" ]; then
      bad "brltty قاعده‌ی CH340 (1a86) دارد: $src → بردِ تو را «نمایشگرِ بریل» می‌پندارد"
    else
      info "brltty نصب است ولی قاعده‌ی CH340 ندارد"
    fi
  else
    info "brltty: نصب نیست"
  fi
  if [ -f "$RULE_DST" ]; then
    ok "قاعده‌ی پروژه نصب است: $RULE_DST"
    grep -q 'ID_MM_DEVICE_IGNORE' "$RULE_DST" && ok "ModemManager از این دستگاه‌ها چشم می‌پوشد"
  else
    bad "قاعده‌ی پروژه نصب نیست: $RULE_DST"
  fi
  [ -e "$BRLTTY_OVERRIDE" ] && ok "ادعای brltty روی CH340 خنثی شده: $BRLTTY_OVERRIDE"
  if [ -e /dev/axis5 ]; then
    ok "/dev/axis5 وجود دارد → $(readlink -f /dev/axis5 2>/dev/null || echo '?')"
    info "این نام با افتِ USB عوض نمی‌شود (برخلافِ ttyUSB0/ttyUSB1)"
  else
    bad "/dev/axis5 وجود ندارد (قاعده نصب نشده، یا کابل بعد از نصب وصل نشده)"
  fi
  for d in /dev/ttyUSB* /dev/ttyACM*; do
    [ -e "$d" ] || continue
    local holders
    holders="$(fuser "$d" 2>/dev/null || true)"
    if [ -n "$holders" ]; then
      info "$d در دستِ pid: $holders → $(ps -o comm= -p $(echo "$holders" | tr -s ' ' ',') 2>/dev/null | tr '\n' ' ')"
    else
      info "$d آزاد است"
    fi
  done
}

case "$MODE" in
check)
  c_b "════ بررسیِ مالکیتِ پورتِ سریال ════"
  report_state
  exit 0
  ;;
undo)
  c_b "════ برگرداندنِ تغییرات ════"
  [ -f "$RULE_DST" ] && $SUDO rm -f "$RULE_DST" && ok "$RULE_DST حذف شد"
  [ -f "$BRLTTY_OVERRIDE" ] && $SUDO rm -f "$BRLTTY_OVERRIDE" && ok "$BRLTTY_OVERRIDE حذف شد (brltty دوباره فعال)"
  $SUDO udevadm control --reload 2>/dev/null || true
  $SUDO udevadm trigger --subsystem-match=tty 2>/dev/null || true
  c_y "کابلِ USB را یک بار بکش و دوباره بزن."
  exit 0
  ;;
esac

c_b "════ آزادسازیِ پورتِ سریال (ModemManager + brltty) ════"

SRC="$(find_rule || true)"
if [ -z "$SRC" ]; then
  c_r "فایلِ قاعده پیدا نشد و دانلود هم ممکن نبود."
  c_y "دستی: desktop-app/build/$RULE_NAME را در /etc/udev/rules.d/ کپی کن."
  exit 1
fi
info "منبعِ قاعده: $SRC"

$SUDO install -m 0644 "$SRC" "$RULE_DST" \
  && ok "نصب شد: $RULE_DST" || { c_r "نصبِ قاعده ناموفق بود"; exit 1; }

BRL_SRC="$(brltty_claims_ch340 || true)"
if [ -n "$BRL_SRC" ]; then
  # کپی در /etc/udev/rules.d بر /lib/udev/rules.d اولویت دارد: همان فایل را
  # می‌گذاریم ولی خط‌های مربوط به CH340 (1a86) را کامنت می‌کنیم.
  tmp="$(mktemp)"
  sed -E '/1a86/ s/^/#AXIS5: /' "$BRL_SRC" > "$tmp"
  $SUDO install -m 0644 "$tmp" "$BRLTTY_OVERRIDE" \
    && ok "ادعای brltty روی CH340 خنثی شد: $BRLTTY_OVERRIDE (منبع: $BRL_SRC)" \
    || c_r "نتوانستم قاعده‌ی brltty را خنثی کنم"
  rm -f "$tmp"
else
  info "brltty ادعایی روی CH340 ندارد — چیزی برای خنثی‌کردن نیست"
fi

$SUDO udevadm control --reload 2>/dev/null && ok "udev reload شد"
$SUDO udevadm trigger --subsystem-match=tty 2>/dev/null && ok "قاعده‌ها روی دستگاه‌های موجود اجرا شد"

# ModemManager ممکن است همین حالا پورت را نگه داشته باشد
if pgrep -x ModemManager >/dev/null 2>&1; then
  $SUDO systemctl restart ModemManager >/dev/null 2>&1 \
    && ok "ModemManager ریستارت شد تا قاعده‌ی تازه را بخواند" \
    || info "ModemManager را دستی ریستارت کن: sudo systemctl restart ModemManager"
fi

echo
if [ -e /dev/axis5 ]; then
  c_g "آماده است: /dev/axis5 → $(readlink -f /dev/axis5)"
else
  c_y "یک بار کابلِ USB را بکش و دوباره بزن تا /dev/axis5 ساخته شود"
fi
echo
report_state
