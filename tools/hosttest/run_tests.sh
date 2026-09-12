#!/bin/bash
# =====================================================================
#  اجرای همه‌ی تست‌های host:
#    بخش ۱) کامپایل + لینک + اسموک‌تست همه‌ی دستورات سریال
#    بخش ۲) شبیه‌سازی رفتاری: اولویت هومینگ، بک‌آف اجباری، پروفایل حرکت
#
#  اجرا:  bash tools/hosttest/run_tests.sh
# =====================================================================
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SKETCH="$ROOT/firmware/RobotArm_Firmware"      # پوشه‌ی اسکچ آردوینو
HT="$ROOT/tools/hosttest"
OUT="$HT/build"
rm -rf "$OUT"; mkdir -p "$OUT"

CXXFLAGS="-std=gnu++11 -O1 -g0 -Wall -Wextra -Wno-unused-parameter -Wno-unused-function"
INC="-I$HT -I$HT/ros_stub -I$HT/ros_stub/ros -I$SKETCH -I$OUT"
FAIL=0

# ---------------------------------------------------------------------
# ۰) ساخت نسخه‌ی قابل کامپایل از .ino با prototype خودکار
#    (دقیقاً همان کاری که Arduino IDE انجام می‌دهد)
# ---------------------------------------------------------------------
python3 - "$SKETCH/RobotArm_Firmware.ino" "$OUT/sketch.cpp" <<'PY'
import sys, re
lines = open(sys.argv[1], encoding='utf-8').read().split('\n')
last_inc = max(i for i, l in enumerate(lines) if l.strip().startswith('#include'))
skip = {'if','for','while','switch','return','else','do','case','class','struct','enum','namespace'}
protos, seen = [], set()
for l in lines:
    m = re.match(r'^([A-Za-z_][\w\s\*]*?)\s+\**(\w+)\s*\(([^;{]*)\)\s*\{?\s*$', l)
    if not m: continue
    ret, name, args = m.group(1).strip(), m.group(2), m.group(3).strip()
    if name in skip or ret in skip or name in seen: continue
    seen.add(name)
    protos.append(f"{ret} {name}({args});")
body = "\n".join(lines[:last_inc+1]) + \
       "\n// --- auto-generated prototypes (like Arduino IDE) ---\n" + \
       "\n".join(protos) + "\n" + "\n".join(lines[last_inc+1:])
open(sys.argv[2], 'w', encoding='utf-8').write(body)
print(f"  generated sketch.cpp with {len(protos)} prototypes")
PY

# ---------------------------------------------------------------------
# ۱) کامپایل همه‌ی ماژول‌ها
# ---------------------------------------------------------------------
if [ ! -f "$SKETCH/RobotArm_Firmware.ino" ]; then
    echo "!! اسکچ پیدا نشد: $SKETCH" >&2
    exit 1
fi

echo
echo "===== [1/7] compiling all modules ====="
OBJS=""
for f in "$SKETCH"/*.cpp "$OUT/sketch.cpp" "$HT/stubs.cpp"; do
    b=$(basename "$f" | tr '.-' '__')
    printf "  %-24s " "$(basename "$f")"
    if g++ $CXXFLAGS $INC -c "$f" -o "$OUT/$b.o" 2> "$OUT/$b.log"; then
        echo "OK"; OBJS="$OBJS $OUT/$b.o"
    else
        echo "COMPILE FAIL"; FAIL=1
    fi
done

# ---------------------------------------------------------------------
# ۲) لینک + اجرای اسموک‌تست دستورات سریال
# ---------------------------------------------------------------------
if [ $FAIL -eq 0 ]; then
    echo
    echo "===== [2/7] link + serial smoke test ====="
    printf "  %-24s " "compiling link_main"
    if g++ $CXXFLAGS $INC -c "$HT/link_main.cpp" -o "$OUT/link_main.o" 2> "$OUT/lm.log"; then echo OK; else echo FAIL; FAIL=1; fi

    if [ $FAIL -eq 0 ]; then
        printf "  %-24s " "LINK (undefined refs?)"
        if g++ -o "$OUT/firmware" $OBJS "$OUT/link_main.o" 2> "$OUT/link.log"; then
            echo "OK"
            printf "  %-24s " "RUN smoke test"
            if "$OUT/firmware" > "$OUT/smoke.log" 2>&1; then
                echo "OK — $(grep -c '^> ' "$OUT/smoke.log") commands"
            else
                echo "RUNTIME FAIL"; FAIL=1
            fi
        else
            echo "LINK FAIL"; FAIL=1
        fi
    fi
fi

# ---------------------------------------------------------------------
# ۳) شبیه‌سازی رفتاری هومینگ/حرکت
# ---------------------------------------------------------------------
if [ $FAIL -eq 0 ]; then
    echo
    echo "===== [3/7] behavioural simulation (homing order + backoff + motion) ====="
    SIM_OBJS=""
    for m in Axis MotorController SpeedProfile TimerManager Trajectory IK Logger Macro PositionStore TeachMode EnergyManager; do
        SIM_OBJS="$SIM_OBJS $OUT/${m}_cpp.o"
    done
    printf "  %-24s " "compiling sim_main"
    if g++ $CXXFLAGS $INC -c "$HT/sim_main.cpp" -o "$OUT/sim_main.o" 2> "$OUT/sm.log"; then echo OK; else echo FAIL; FAIL=1; fi

    if [ $FAIL -eq 0 ]; then
        printf "  %-24s " "LINK sim"
        if g++ -o "$OUT/sim" "$OUT/sim_main.o" "$OUT/stubs_cpp.o" $SIM_OBJS 2> "$OUT/simlink.log"; then
            echo "OK"
            echo "  ----------------------------------------"
            "$OUT/sim" > "$OUT/sim.log" 2>&1
            RC=$?
            cat "$OUT/sim.log"
            echo "  ----------------------------------------"
            if [ $RC -ne 0 ]; then FAIL=1; fi
        else
            echo "LINK FAIL"; FAIL=1
        fi
    fi
fi

# ---------------------------------------------------------------------
# ۴) انطباق GUI ↔ فریم‌ور: هر دستوری که GUI می‌سازد باید شناخته شود
# ---------------------------------------------------------------------
if [ $FAIL -eq 0 ]; then
    echo
    echo "===== [4/7] GUI -> firmware command conformance ====="
    if command -v node >/dev/null 2>&1; then
        printf "  %-24s " "generating GUI commands"
        if node "$ROOT/tools/gui_cmds.js" > "$OUT/gui_cmds.txt" 2> "$OUT/gui_cmds.err"; then
            echo "OK — $(wc -l < "$OUT/gui_cmds.txt") commands"
        else
            echo "FAIL"; cat "$OUT/gui_cmds.err"; FAIL=1
        fi

        if [ $FAIL -eq 0 ]; then
            printf "  %-24s " "feeding them to firmware"
            if "$OUT/firmware" "$OUT/gui_cmds.txt" > "$OUT/gui_run.log" 2>&1; then
                UNK=$(grep -c "^Unknown command" "$OUT/gui_run.log" || true)
                REJ=$(grep -c "^!! " "$OUT/gui_run.log" || true)
                if [ "$UNK" = "0" ]; then
                    echo "OK — همه شناخته شدند (پیام‌های '!!' وابسته به وضعیت دستگاه: $REJ)"
                else
                    echo "FAIL — $UNK دستور ناشناخته"
                    grep -B1 "^Unknown command" "$OUT/gui_run.log" | grep "^> " | sort -u | sed 's/^/      /'
                    FAIL=1
                fi
            else
                echo "RUNTIME FAIL"; FAIL=1
            fi
        fi
    else
        echo "  (node پیدا نشد — این بخش رد شد)"
    fi
fi

# ---------------------------------------------------------------------
# ۵) کانال همگام‌سازی POS — اسلایدرها باید حرکتِ برد را دنبال کنند
# ---------------------------------------------------------------------
if [ $FAIL -eq 0 ]; then
    echo
    echo "===== [5/7] POS sync channel (sliders follow the board) ====="
    printf 'pos\ndeg 3 30\npos\nik 210 0 30\npos\nstatus\n' > "$OUT/pos_cmds.txt"
    if "$OUT/firmware" "$OUT/pos_cmds.txt" > "$OUT/pos_run.log" 2>&1; then
        N_POS=$(grep -c '^>> POS ' "$OUT/pos_run.log" || true)
        N_OK=$(grep -cE '^>> POS -?[0-9]+\.[0-9],-?[0-9]+\.[0-9],-?[0-9]+\.[0-9],-?[0-9]+\.[0-9],-?[0-9]+\.[0-9]$' "$OUT/pos_run.log" || true)
        N_ECHO=$(grep -c '^> pos$' "$OUT/pos_run.log" || true)
        N_NAN=$(grep -ci 'nan' "$OUT/pos_run.log" || true)

        printf "  %-34s " "lines with the exact POS format"
        if [ "$N_POS" -ge 4 ] && [ "$N_POS" = "$N_OK" ]; then echo "OK — $N_POS/$N_OK"; else echo "FAIL ($N_OK از $N_POS)"; FAIL=1; fi

        printf "  %-34s " "'pos' is not echoed (quiet poll)"
        if [ "$N_ECHO" = "0" ]; then echo "OK"; else echo "FAIL — $N_ECHO echo"; FAIL=1; fi

        printf "  %-34s " "no nan/inf anywhere"
        if [ "$N_NAN" = "0" ]; then echo "OK"; else echo "FAIL — $N_NAN مورد"; FAIL=1; fi

        printf "  %-34s " "status also ends with a POS line"
        if awk '/^======================$/{f=1;next} f&&/^>> POS /{found=1} END{exit !found}' "$OUT/pos_run.log"; then echo "OK"; else echo "FAIL"; FAIL=1; fi

        printf "  %-34s " "POS follows a move (deg 3 30)"
        if grep -qE '^>> POS [^,]*,[^,]*,(0\.[1-9]|[1-9])' "$OUT/pos_run.log"; then echo "OK"; else echo "FAIL — J3 تکان نخورد"; FAIL=1; fi

        # --- نسخه‌ی فریم‌ور: برد باید بگوید کدام نسخه است، و GUIها هم همان را
        # --- انتظار بکشند؛ وگرنه بعد از فلشِ درست، GUI بی‌دلیل «قدیمی» می‌گوید.
        FW_VER=$(sed -n 's/^#define FIRMWARE_VERSION[[:space:]]*"\([^"]*\)".*/\1/p' \
                 "$ROOT/firmware/RobotArm_Firmware/Config.h")
        printf "  %-34s " "boot banner + status report version"
        if [ -n "$FW_VER" ] && grep -q "Firmware v$FW_VER" "$OUT/pos_run.log" \
           && grep -q "^FW: v$FW_VER$" "$OUT/pos_run.log"; then
            echo "OK — v$FW_VER"
        else
            echo "FAIL — انتظار «AXIS-5 Firmware v$FW_VER» و «FW: v$FW_VER»"; FAIL=1
        fi

        printf "  %-34s " "both GUIs expect that version"
        N_EXP=$(grep -ho 'EXPECTED_FW: *"[0-9.]*"' "$ROOT/gui/js/firmware.js" \
                "$ROOT/desktop-app/renderer/js/core.js" | grep -c "\"$FW_VER\"" || true)
        if [ "$N_EXP" = "2" ]; then echo "OK — هر دو GUI: $FW_VER"; else echo "FAIL — $N_EXP از ۲"; FAIL=1; fi
    else
        echo "  RUNTIME FAIL"; FAIL=1
    fi
fi

# ---------------------------------------------------------------------
# ۶) کینماتیک: ریاضی GUI + برابریِ آن با فریم‌ور
# ---------------------------------------------------------------------
if [ $FAIL -eq 0 ] && command -v node >/dev/null 2>&1; then
    echo
    echo "===== [6/7] kinematics: GUI math + IK parity with the firmware ====="
    printf "  %-34s " "Go-to-XYZ reachable band / round-trip"
    if node "$ROOT/tools/test_goto.js" > "$OUT/goto.log" 2>&1; then
        echo "OK — $(tail -1 "$OUT/goto.log")"
    else
        echo "FAIL"; sed 's/^/      /' "$OUT/goto.log"; FAIL=1
    fi
    printf "  %-34s " "GUI IK == firmware IK (both GUIs)"
    if node "$ROOT/tools/test_ik_parity.js" "$OUT/firmware" > "$OUT/ik_parity.log" 2>&1; then
        echo "OK — $(tail -1 "$OUT/ik_parity.log")"
    else
        echo "FAIL"; sed 's/^/      /' "$OUT/ik_parity.log" | tail -12; FAIL=1
    fi
fi

# ---------------------------------------------------------------------
# ۷) خودِ GUI در DOM واقعی (jsdom): چیدمانِ ردیفِ اسلایدر، بی‌شلوغیِ
#    کنسول زیرِ poll، و دنبال‌کردنِ موقعیتِ برد توسط اسلایدرها.
#    jsdom اختیاری است: نصب نباشد این مرحله SKIP می‌شود (نه FAIL).
# ---------------------------------------------------------------------
if [ $FAIL -eq 0 ] && command -v node >/dev/null 2>&1; then
    echo
    echo "===== [7/7] both GUIs in a real DOM (jsdom) ====="
    printf "  %-34s " "layout + quiet console + POS sync"
    if node "$ROOT/tools/test_gui_dom.js" > "$OUT/gui_dom.log" 2>&1; then
        if grep -q "SKIP" "$OUT/gui_dom.log"; then
            echo "SKIP — jsdom نصب نیست (cd tools && npm install)"
        else
            echo "OK — $(grep -m1 'نتیجه:' "$OUT/gui_dom.log")"
        fi
    else
        echo "FAIL"; sed 's/^/      /' "$OUT/gui_dom.log" | tail -20; FAIL=1
    fi
fi

echo
if [ $FAIL -ne 0 ]; then
    echo "########## خطاها ##########"
    for l in "$OUT"/*.log; do
        case "$l" in *smoke.log|*sim.log) continue;; esac
        if [ -s "$l" ]; then echo "--- $l ---"; head -30 "$l"; fi
    done
    exit 1
fi
echo "########## همه‌ی تست‌ها پاس شدند: کامپایل + لینک + اسموک‌تست + شبیه‌سازی ##########"
