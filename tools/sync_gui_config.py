#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
همگام‌سازی ثابت‌های فریم‌ور با هر دو GUI.

چرا این ابزار وجود دارد
------------------------
مقادیر محورها (سرعت بیشینه، شتاب، بک‌آف، soft limit و محدوده‌ی درجه) در
GUIها کپی دستیِ Config.h بودند و از فریم‌ور عقب مانده بودند. نمونه‌ی واقعی:

    محور Y:  GUI اجازه‌ی ۰..۱۱۵ درجه می‌داد  |  فریم‌ور ۰..۱۰۰ درجه
    محور Z:  GUI اجازه‌ی ۰..۷۰  درجه می‌داد  |  فریم‌ور ۰..۵۵  درجه
    شتاب X:  GUI ۱۲۰۰ نشان می‌داد            |  فریم‌ور ۶۰۰۰

نتیجه‌اش این بود که اسلایدر را تا ۱۱۵ درجه می‌کشیدی، دستور `deg 2 115`
فرستاده می‌شد و فریم‌ور آن را با «out of range» رد می‌کرد — یعنی دکمه
«کار نمی‌کرد».

این ابزار مقادیر را مستقیم از خود فریم‌ور می‌خواند و بلوک AXES را در هر دو
GUI بازنویسی می‌کند:

    firmware/RobotArm_Firmware/Config.h          (سرعت/شتاب/بک‌آف/soft limit)
    firmware/RobotArm_Firmware/RobotArm_Firmware.ino  (AXIS_MIN_DEG/MAX_DEG)
    firmware/RobotArm_Firmware/PositionStore.h   (MAX_POSITIONS)
    firmware/RobotArm_Firmware/TeachMode.h       (MAX_TEACH_STEPS)
    →  gui/js/firmware.js
    →  desktop-app/renderer/js/core.js

کاربرد
------
    python3 tools/sync_gui_config.py            # بازنویسی GUIها
    python3 tools/sync_gui_config.py --check    # فقط بررسی؛ اگر تفاوت دارد exit 1

فیلدهای «انسانی» هر محور (name، nameEn، role، pins) دست‌نخورده می‌مانند؛
فقط عددها بازتولید می‌شوند.
"""

import re
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FW = os.path.join(ROOT, "firmware", "RobotArm_Firmware")

AXIS_IDS = ["X", "Y", "Z", "A", "B"]          # ایندکس ۰..۴ = جوینت ۱..۵

GUI_FILES = [
    os.path.join(ROOT, "gui", "js", "firmware.js"),
    os.path.join(ROOT, "desktop-app", "renderer", "js", "core.js"),
]


# ---------------------------------------------------------------------
# خواندن فریم‌ور
# ---------------------------------------------------------------------
def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def parse_defines(text):
    """#define NAME VALUE  →  dict (کامنت‌ها حذف می‌شوند)."""
    out = {}
    for m in re.finditer(r"^\s*#define\s+(\w+)\s+(.+?)\s*$", text, re.M):
        name, val = m.group(1), m.group(2)
        val = re.sub(r"/\*.*?\*/", "", val)          # /* ... */
        val = re.sub(r"//.*$", "", val).strip()      # ...
        out[name] = val
    return out


def num(v):
    """تبدیل رشته‌ی ماکرو به عدد (int یا float)."""
    v = v.strip()
    v = re.sub(r"[uUlL]+$", "", v)      # پسوند‌های C: 20000L، 12000UL
    f = float(v)
    return int(f) if f == int(f) and "." not in v and "e" not in v.lower() else f


def parse_deg_arrays(ino_text):
    """AXIS_MIN_DEG / AXIS_MAX_DEG از اسکچ."""
    def arr(name):
        m = re.search(name + r"\s*\[[^\]]*\]\s*=\s*\{([^}]*)\}", ino_text, re.S)
        if not m:
            raise SystemExit(f"!! {name} در RobotArm_Firmware.ino پیدا نشد")
        return [num(x) for x in m.group(1).replace("\n", " ").split(",") if x.strip()]
    return arr("AXIS_MIN_DEG"), arr("AXIS_MAX_DEG")


def firmware_axes():
    cfg = parse_defines(read(os.path.join(FW, "Config.h")))
    ino = read(os.path.join(FW, "RobotArm_Firmware.ino"))
    deg_min, deg_max = parse_deg_arrays(ino)

    axes = []
    for i, a in enumerate(AXIS_IDS):
        p = lambda k: num(cfg[f"AXIS_{a}_{k}"])          # noqa: E731
        rev, micro, gear = p("STEPS_PER_REV"), p("MICROSTEP"), p("GEAR_RATIO")
        spd = round(rev * micro * gear / 360.0, 2)
        axes.append({
            "id": a,
            "joint": i + 1,
            "min": deg_min[i],
            "max": deg_max[i],
            "stepsPerDeg": spd,
            "stepsPerRev": rev,
            "microstep": micro,
            "gear": f"1:{gear:g}",
            "maxSpeed": p("MAX_SPEED"),
            "accel": p("ACCELERATION"),
            "backoff": p("BACKOFF"),
            "homingSpeed": p("HOMING_SPEED"),
            "softMin": p("SOFT_MIN"),
            "softMax": p("SOFT_MAX"),
        })
    return axes, cfg


def firmware_scalars():
    cfg = parse_defines(read(os.path.join(FW, "Config.h")))
    pstore = read(os.path.join(FW, "PositionStore.h"))
    teach = read(os.path.join(FW, "TeachMode.h"))

    m = re.search(r"#define\s+MAX_POSITIONS\s+(\d+)", pstore)
    max_pos = int(m.group(1)) if m else 10
    m = re.search(r"MAX_TEACH_STEPS\s*=\s*(\d+)", teach)
    max_teach = int(m.group(1)) if m else 30

    m = re.search(r"#define\s+HOMING_ORDER\s+\{([^}]*)\}", cfg.get("HOMING_ORDER", "") or read(os.path.join(FW, "Config.h")))
    order = [int(x) for x in m.group(1).replace(" ", "").split(",") if x != ""] if m else [0, 1, 2, 3, 4]

    return {
        "MAX_POSITIONS": max_pos,
        "MAX_TEACH_STEPS": max_teach,
        "HOMING_ORDER": order,
        "MAX_SPEED_LIMIT": num(cfg["MAX_SPEED_LIMIT"]),
        "RAMP_MIN_SPEED": num(cfg["RAMP_MIN_SPEED"]),
        "STEP_TICK_FREQ": num(cfg["STEP_TICK_FREQ"]),
        "PROFILE_SLOW_PERCENT": num(cfg["PROFILE_SLOW_PERCENT"]),
        "PROFILE_FAST_PERCENT": num(cfg["PROFILE_FAST_PERCENT"]),
    }


# ---------------------------------------------------------------------
# خواندن/بازنویسی GUI
# ---------------------------------------------------------------------
def jsnum(v):
    """عدد به سبک JS (بدون .0 اضافه)."""
    if isinstance(v, float):
        return f"{v:g}"
    return str(v)


def extract_human_fields(block, axis_id):
    """فیلدهای دستی یک محور را از بلوک موجود بیرون می‌کشد."""
    m = re.search(r"\{\s*id:\s*\"" + axis_id + r"\"(.*?)\n\s*\},", block, re.S)
    if not m:
        return {}
    body = m.group(1)
    out = {}
    for key in ("name", "nameEn", "role"):
        mm = re.search(key + r":\s*\"((?:[^\"\\]|\\.)*)\"", body)
        if mm:
            out[key] = mm.group(1)
    mm = re.search(r"pins:\s*\{([^}]*)\}", body)
    if mm:
        out["pins"] = mm.group(1).strip()
    return out


def render_axes_js(axes, humans, indent="  "):
    """بلوک AXES را با اعداد درست تولید می‌کند."""
    parts = []
    for ax in axes:
        h = humans.get(ax["id"], {})
        head = [f'id: "{ax["id"]}"', f'joint: {ax["joint"]}']
        if "name" in h:
            head.append(f'name: "{h["name"]}"')
        if "nameEn" in h:
            head.append(f'nameEn: "{h["nameEn"]}"')
        if "role" in h:
            head.append(f'role: "{h["role"]}"')
        lines = [
            indent + "  {",
            indent + "    " + ", ".join(head) + ",",
            indent + "    /* ---- generated from firmware Config.h by tools/sync_gui_config.py ---- */",
            indent + f"    min: {jsnum(ax['min'])}, max: {jsnum(ax['max'])},",
            indent + f"    stepsPerDeg: {jsnum(ax['stepsPerDeg'])}, stepsPerRev: {jsnum(ax['stepsPerRev'])},"
                     f" microstep: {jsnum(ax['microstep'])}, gear: \"{ax['gear']}\",",
            indent + f"    maxSpeed: {jsnum(ax['maxSpeed'])}, accel: {jsnum(ax['accel'])},"
                     f" backoff: {jsnum(ax['backoff'])}, homingSpeed: {jsnum(ax['homingSpeed'])},",
            indent + f"    soft: {{ min: {jsnum(ax['softMin'])}, max: {jsnum(ax['softMax'])} }},",
            indent + "    /* ---- end generated ---- */",
        ]
        if "pins" in h:
            lines.append(indent + f"    pins: {{ {h['pins']} }},")
        lines.append(indent + "  },")
        parts.append("\n".join(lines))
    return "\n".join(parts)


def sync_file(path, axes, scalars, write=True):
    src = read(path)
    orig = src
    changes = []

    m = re.search(r"(?s)(\n(?P<ind>[ \t]*)AXES:\s*\[\n)(.*?)(\n[ \t]*\],)", src)
    if not m:
        print(f"!! بلوک AXES در {path} پیدا نشد")
        return None
    block = m.group(3)
    humans = {a["id"]: extract_human_fields(block, a["id"]) for a in axes}
    new_block = render_axes_js(axes, humans, indent=m.group("ind"))
    if new_block != block:
        changes.append("AXES")
    src = src[:m.start(3)] + new_block + src[m.end(3):]

    # --- ثابت‌های تکی ---
    for key in ("MAX_POSITIONS", "MAX_TEACH_STEPS"):
        pat = re.compile(r"(\b" + key + r":\s*)(\d+)")
        mm = pat.search(src)
        if mm and int(mm.group(2)) != scalars[key]:
            changes.append(f"{key}: {mm.group(2)} → {scalars[key]}")
            src = pat.sub(lambda g: g.group(1) + str(scalars[key]), src, count=1)

    # --- ترتیب هومینگ ---
    order_js = "[" + ", ".join(str(x) for x in scalars["HOMING_ORDER"]) + "]"
    order_cmp = "[" + ",".join(str(x) for x in scalars["HOMING_ORDER"]) + "]"
    pat = re.compile(r"(HOMING_ORDER:\s*)(\[[^\]]*\])")
    mm = pat.search(src)
    if mm and mm.group(2).replace(" ", "") != order_cmp:
        changes.append(f"HOMING_ORDER: {mm.group(2)} → {order_js}")
        src = pat.sub(lambda g: g.group(1) + order_js, src, count=1)
    label = " → ".join("J" + str(i + 1) for i in scalars["HOMING_ORDER"])
    pat = re.compile(r'(HOMING_ORDER_LABEL:\s*")([^"]*)(")')
    mm = pat.search(src)
    if mm and mm.group(2) != label:
        changes.append(f"HOMING_ORDER_LABEL → {label}")
        src = pat.sub(lambda g: g.group(1) + label + g.group(3), src, count=1)

    if write and src != orig:
        with open(path, "w", encoding="utf-8") as f:
            f.write(src)
    return changes


def main():
    check = "--check" in sys.argv
    axes, _ = firmware_axes()
    scalars = firmware_scalars()

    print("مقادیر واقعی فریم‌ور:")
    print(f"  ترتیب هومینگ : {' -> '.join('J' + str(i + 1) for i in scalars['HOMING_ORDER'])}")
    print(f"  MAX_POSITIONS={scalars['MAX_POSITIONS']}  MAX_TEACH_STEPS={scalars['MAX_TEACH_STEPS']}"
          f"  MAX_SPEED_LIMIT={scalars['MAX_SPEED_LIMIT']}")
    for ax in axes:
        print(f"  J{ax['joint']} ({ax['id']}): {ax['min']}..{ax['max']}°  "
              f"soft {ax['softMin']}..{ax['softMax']}  max {ax['maxSpeed']}  "
              f"accel {ax['accel']}  home {ax['homingSpeed']}  backoff {ax['backoff']}")

    drift = False
    for path in GUI_FILES:
        if not os.path.exists(path):
            print(f"\n!! فایل GUI پیدا نشد: {path}")
            drift = True
            continue
        changes = sync_file(path, axes, scalars, write=not check)
        rel = os.path.relpath(path, ROOT)
        if changes is None:
            drift = True
        elif changes:
            drift = True
            verb = "نیاز به همگام‌سازی دارد" if check else "همگام شد"
            print(f"\n{rel}: {verb}")
            for c in changes:
                print(f"    - {c}")
        else:
            print(f"\n{rel}: همگام است ✓")

    if check and drift:
        print("\n!! GUI با فریم‌ور همگام نیست. اجرا کن: python3 tools/sync_gui_config.py")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
