#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
# https://github.com/Draxx143/arduinoarm_robot
# ======================================================================
#  AXIS-5 Robot Control — نصب/پاک‌سازی کامل از ترمینال لینوکس
#
#  یک‌خطی (بدون کلون کردن ریپو):
#     bash <(curl -fsSL https://raw.githubusercontent.com/Draxx143/arduinoarm_robot/arena/01a091da-arduinoarm-robot/tools/install-linux.sh)
#
#  یا بعد از کلون:
#     bash tools/install-linux.sh              # دانلود + پاک‌سازی قبلی + نصب .deb
#     bash tools/install-linux.sh --appimage   # بدون روت، فایل تکی
#     bash tools/install-linux.sh --purge      # فقط حذف کامل
#     bash tools/install-linux.sh --dry-run    # فقط نشان بده چه می‌کرد
#
#  چه کار می‌کند:
#    ۱. نسخه‌ی قبلی را کامل پاک می‌کند (deb + AppImage + wrapper + میانبرها)
#    ۲. تازه‌ترین بسته را از ریلیز `latest` گیتهاب می‌گیرد
#    ۳. نصب می‌کند و وابستگی‌ها را با apt حل می‌کند
#    ۴. کاربر را در گروه dialout می‌گذارد (دسترسی /dev/ttyUSB0 یا ttyACM0)
#    ۵. نتیجه را راستی‌آزمایی می‌کند و دستور اجرا/لاگ را چاپ می‌کند
# ======================================================================
set -uo pipefail

REPO="${AXIS5_REPO:-Draxx143/arduinoarm_robot}"
TAG="${AXIS5_TAG:-latest}"
PKG="axis5-robot-control"
WORKDIR="${HOME}/.cache/axis5-installer"

MODE="deb"            # deb | appimage
DO_PURGE=0            # فقط پاک‌سازی
KEEP_CONFIG=0         # تنظیمات کاربر بماند
FORCE=0               # حتی اگر همان نسخه نصب است، دوباره نصب کن
DRY=0                 # فقط نمایش

c_g() { printf '\033[32m%s\033[0m\n' "$*"; }
c_y() { printf '\033[33m%s\033[0m\n' "$*"; }
c_r() { printf '\033[31m%s\033[0m\n' "$*"; }
c_b() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { c_b "── $*"; }

run() {
    if [ "$DRY" = 1 ]; then printf '  [dry-run] %s\n' "$*"; return 0; fi
    echo "  \$ $*" >&2
    "$@"
}

need_root() {
    if [ "$(id -u)" -eq 0 ]; then echo ""; else echo "sudo "; fi
}

usage() {
    sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
}

while [ $# -gt 0 ]; do
    case "$1" in
        --appimage)   MODE="appimage" ;;
        --deb)        MODE="deb" ;;
        --purge|--uninstall|--remove) DO_PURGE=1 ;;
        --keep-config) KEEP_CONFIG=1 ;;
        --force)      FORCE=1 ;;
        --dry-run|-n) DRY=1 ;;
        --help|-h)    usage ;;
        *) c_r "گزینه‌ی ناشناخته: $1"; usage ;;
    esac
    shift
done

# ----------------------------------------------------------------------
# ۰) پیش‌نیازها
# ----------------------------------------------------------------------
step "بررسی سیستم"
ARCH="$(uname -m)"
case "$ARCH" in
    x86_64|amd64) DARCH="amd64"; AARCH="x86_64" ;;
    *) c_r "معماری $ARCH پشتیبانی نمی‌شود (بسته‌ها فقط x64 هستند)"; exit 1 ;;
esac
echo "  معماری: $ARCH  →  بسته: $DARCH / $AARCH"

for t in curl; do
    command -v "$t" >/dev/null 2>&1 || { c_r "ابزار $t نصب نیست: sudo apt install $t"; exit 1; }
done

if command -v lsb_release >/dev/null 2>&1; then
    echo "  توزیع: $(lsb_release -ds 2>/dev/null)"
fi

mkdir -p "$WORKDIR" 2>/dev/null || WORKDIR="/tmp/axis5-installer"

# ----------------------------------------------------------------------
# ۱) پاک‌سازی نسخه‌ی قبلی
# ----------------------------------------------------------------------
purge_old() {
    step "پاک‌سازی نسخه‌ی قبلی"
    local found=0

    if command -v dpkg >/dev/null 2>&1 && dpkg -l "$PKG" 2>/dev/null | grep -q "^ii"; then
        found=1
        local ver; ver="$(dpkg-query -W -f='${Version}' "$PKG" 2>/dev/null)"
        echo "  بسته‌ی نصب‌شده: $PKG نسخه‌ی $ver"
        run $(need_root)apt-get remove --purge -y "$PKG"
    fi

    # فایل‌های باقی‌مانده
    local leftovers=(
        /usr/bin/axis5-robot-control
        /opt/AXIS5-Robot-Control
        /opt/axis5-robot-control
        /opt/AXIS-5-Robot-Control
    )
    for f in "${leftovers[@]}"; do
        if [ -e "$f" ]; then found=1; echo "  باقی‌مانده: $f"; run $(need_root)rm -rf "$f"; fi
    done

    # میانبرهای منو
    for f in /usr/share/applications/*axis5*.desktop /usr/share/applications/*AXIS5*.desktop \
             "$HOME"/.local/share/applications/*axis5*.desktop "$HOME"/.local/share/applications/*AXIS5*.desktop; do
        [ -e "$f" ] || continue
        found=1; echo "  میانبر: $f"
        case "$f" in /usr/*) run $(need_root)rm -f "$f" ;; *) rm -f "$f" ;; esac
    done

    # AppImage های قدیمی
    for f in "$HOME"/*.AppImage "$HOME"/Downloads/*.AppImage "$HOME"/.local/bin/*.AppImage; do
        [ -e "$f" ] || continue
        case "$f" in *[Aa][Xx][Ii][Ss]*5*) found=1; echo "  AppImage قدیمی: $f"; rm -f "$f" ;; esac
    done

    # تنظیمات و لاگ کاربر
    if [ "$KEEP_CONFIG" = 1 ]; then
        c_y "  تنظیمات کاربر نگه داشته می‌شود (--keep-config)"
    else
        for f in "$HOME/.config/axis5-robot-control" "$HOME/.config/AXIS5-Robot-Control" \
                 "$HOME/.config/AXIS-5 Robot Control" "$HOME/.config/axis5 robot control" \
                 "$HOME/.cache/axis5-robot-control" "$HOME/.axis5"; do
            [ -e "$f" ] || continue
            found=1; echo "  داده‌ی کاربر: $f"; rm -rf "$f"
        done
    fi

    if [ "$found" = 0 ]; then c_g "  نسخه‌ی قبلی پیدا نشد — چیزی برای پاک‌سازی نیست ✓"; fi
}

purge_old
if [ "$DO_PURGE" = 1 ]; then
    c_g "پاک‌سازی تمام شد."
    exit 0
fi

# ----------------------------------------------------------------------
# ۲) پیدا کردن لینک دانلود از ریلیز
# ----------------------------------------------------------------------
step "گرفتن لینک دانلود از ریلیز «$TAG»"
API="https://api.github.com/repos/${REPO}/releases/tags/${TAG}"
META="$(curl -fsSL "$API" 2>/dev/null)" || { c_r "نتوانستم ریلیز را بخوانم: $API"; exit 1; }

pick_url() {  # pick_url <پسوند> <الگوی معماری>
    # اگر در ریلیز چند نسخه‌ی مختلف بسته باشد (مثلاً ۱.۰.۳۸ قدیمی کنار
    # ۱.۰.۳۹ تازه)، بالاترین شماره‌ی نسخه انتخاب می‌شود — نه اولین تصادفی.
    printf '%s\n' "$META" | grep -o '"browser_download_url": *"[^"]*"' \
        | sed 's/.*"\(http[^"]*\)"/\1/' | grep -- "$1" | grep -- "$2" \
        | while read -r u; do
              v="$(basename "$u" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
              printf '%s %s\n' "${v:-0.0.0}" "$u"
          done | sort -V -r | head -1 | cut -d' ' -f2-
}

if [ "$MODE" = "deb" ]; then
    URL="$(pick_url '\.deb$' "$DARCH")"
else
    URL="$(pick_url '\.AppImage$' "$AARCH")"
fi

if [ -z "$URL" ]; then
    c_r "بسته‌ی مناسب ($MODE/$ARCH) در ریلیز پیدا نشد. دارایی‌های موجود:"
    printf '%s\n' "$META" | grep -o '"browser_download_url": *"[^"]*"' | sed 's/.*"\(http[^"]*\)"/    \1/'
    exit 1
fi

REL_VER="$(printf '%s\n' "$META" | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
FILE="$WORKDIR/$(basename "$URL")"
echo "  نسخه: ${REL_VER:-?}"
echo "  لینک: $URL"

# ----------------------------------------------------------------------
# ۳) دانلود
# ----------------------------------------------------------------------
step "دانلود"
if [ -f "$FILE" ] && [ "$FORCE" != 1 ]; then
    echo "  از قبل دانلود شده: $FILE"
else
    run curl -fL --retry 3 --progress-bar -o "$FILE" "$URL"
fi
[ "$DRY" = 1 ] || [ -s "$FILE" ] || { c_r "دانلود ناموفق بود"; exit 1; }
ls -lh "$FILE" 2>/dev/null | awk '{print "  اندازه: "$5}'

# ----------------------------------------------------------------------
# ۴) نصب
# ----------------------------------------------------------------------
if [ "$MODE" = "deb" ]; then
    step "نصب بسته‌ی deb"
    CUR="$(dpkg-query -W -f='${Version}' "$PKG" 2>/dev/null || true)"
    if [ -n "$CUR" ] && [ "$FORCE" != 1 ]; then
        c_y "  نسخه‌ی $CUR الان نصب است. برای نصب دوباره: --force"
    else
        # apt وابستگی‌ها را هم حل می‌کند (dpkg -i تنها، وابستگی شکسته می‌گذارد)
        if command -v apt-get >/dev/null 2>&1; then
            run $(need_root)apt-get install -y "$FILE" || {
                c_y "  apt نصب نکرد — تلاش با dpkg + رفع وابستگی"
                run $(need_root)dpkg -i "$FILE"
                run $(need_root)apt-get -f install -y
            }
        else
            run $(need_root)dpkg -i "$FILE"
        fi
    fi
else
    step "نصب AppImage (بدون روت)"
    DEST="$HOME/.local/bin/$(basename "$FILE")"
    run mkdir -p "$HOME/.local/bin"
    run cp "$FILE" "$DEST"
    run chmod +x "$DEST"
    if ! command -v fusermount >/dev/null 2>&1; then
        c_y "  برای AppImage این لازم است:  sudo apt install libfuse2t64  (یا libfuse2)"
    fi
fi

# ----------------------------------------------------------------------
# ۵) دسترسی پورت سریال (آردوینو)
# ----------------------------------------------------------------------
step "دسترسی پورت سریال"
if id -nG "$USER" 2>/dev/null | tr ' ' '\n' | grep -qx dialout; then
    c_g "  کاربر $USER در گروه dialout است ✓"
else
    c_y "  کاربر در گروه dialout نیست — بدون آن /dev/ttyUSB0 باز نمی‌شود"
    if [ "$MODE" = "deb" ] || [ "$DRY" = 0 ]; then
        run $(need_root)usermod -aG dialout "$USER"
        c_y "  ⚠ باید یک بار Log out / Log in کنی تا گروه اعمال شود"
    fi
fi
PORTS="$(ls -1 /dev/ttyUSB* /dev/ttyACM* 2>/dev/null | tr '\n' ' ')"
echo "  پورت‌های دیده‌شده: ${PORTS:-هیچ (آردوینو وصل نیست)}"

# ----------------------------------------------------------------------
# ۶) راستی‌آزمایی
# ----------------------------------------------------------------------
step "راستی‌آزمایی نصب"
if [ "$MODE" = "deb" ]; then
    if command -v dpkg-query >/dev/null 2>&1 && dpkg -l "$PKG" 2>/dev/null | grep -q "^ii"; then
        c_g "  نصب‌شده: $PKG $(dpkg-query -W -f='${Version}' "$PKG")"
    elif [ "$DRY" = 1 ]; then
        echo "  [dry-run] نصب واقعی انجام نشد"
    else
        c_r "  بسته در فهرست dpkg نیست!"
    fi
    command -v axis5-robot-control >/dev/null 2>&1 && c_g "  لانچر: $(command -v axis5-robot-control)"
else
    [ -x "$DEST" ] && c_g "  AppImage آماده: $DEST"
fi

cat <<'HOWTO'

────────────────────────────────────────────────────────────────
 اجرا
────────────────────────────────────────────────────────────────
   از منوی برنامه‌ها:  AXIS5 Robot Control
   یا از ترمینال:      axis5-robot-control
   (AppImage)         ~/.local/bin/AXIS5-Robot-Control-*.AppImage

 لاگ اجرا (وقتی چیزی کار نمی‌کند، اول این را ببین):
   cat ~/.axis5/last-run.log

────────────────────────────────────────────────────────────────
 حذف کامل بعداً
────────────────────────────────────────────────────────────────
   bash tools/install-linux.sh --purge              # با نگه‌داشتن تنظیمات: --keep-config
   یا دستی:
     sudo apt-get remove --purge axis5-robot-control
     sudo rm -f /usr/bin/axis5-robot-control
     sudo rm -rf /opt/AXIS5-Robot-Control
     rm -rf ~/.config/axis5-robot-control ~/.cache/axis5-robot-control ~/.axis5
HOWTO
