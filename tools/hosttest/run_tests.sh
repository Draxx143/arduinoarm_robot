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
echo "===== [1/3] compiling all modules ====="
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
    echo "===== [2/3] link + serial smoke test ====="
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
    echo "===== [3/3] behavioural simulation (homing order + backoff + motion) ====="
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
    echo "===== [4/4] GUI -> firmware command conformance ====="
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
