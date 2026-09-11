#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
مقایسه‌ی «کد قبل از اصلاح» با «کد بعد از اصلاح» برای موتور حرکت بازوی ۵ محوره.

این اسکریلت دقیقاً همان منطقی را شبیه‌سازی می‌کند که روی AVR اجرا می‌شود:

  قبل: تایمر 1kHz، در هر تیک حداکثر یک استپ، پروفایل S-curve با sqrtf،
        سرعت هوم hard-code روی 100 steps/s، و MIN_SPEED=200.
  بعد:  تایمر 20kHz، پروفایل ذوزنقه‌ای واقعی (v² = v0² + 2as) با جدول
        از پیش‌محاسبه‌شده، سرعت هوم از Config.h، RAMP_MIN_SPEED=350.

اجرا:  python3 tools/sim_motion.py
"""

import math

# ------------------------------------------------------------------
# تنظیمات (مطابق Config.h)
# ------------------------------------------------------------------
AXES = {
    #        max   accel  accel_new  home_new  backoff  steps/deg  softMin softMax
    "X": dict(ms=2000, ac=700,  acn=6000, hs=900, bo=5200, spd=200*16*5/360.0,   lo=-4888, hi=4888),
    "Y": dict(ms=2000, ac=1000, acn=5000, hs=900, bo=300,  spd=200*16*6/360.0,   lo=0,     hi=5333),
    "Z": dict(ms=1000, ac=500,  acn=3000, hs=600, bo=200,  spd=200*16*8/360.0,   lo=0,     hi=3911),
    "A": dict(ms=1000, ac=500,  acn=4000, hs=700, bo=3000, spd=200*16*3/360.0,   lo=-2400, hi=2400),
    "B": dict(ms=1000, ac=500,  acn=4000, hs=700, bo=200,  spd=200*16*2.5/360.0, lo=-2000, hi=2000),
}

OLD_TICK_HZ = 1000      # CONTROL_LOOP_FREQ قبلی
NEW_TICK_HZ = 20000     # STEP_TICK_FREQ جدید
OLD_HOMING_SPEED = 100  # hard-code شده در startHoming() قبلی
OLD_MIN_SPEED = 200
NEW_MIN_SPEED = 350


# ------------------------------------------------------------------
# شبیه‌سازی کد قدیمی
# ------------------------------------------------------------------
def old_move(ms, ac, steps, tick_hz=OLD_TICK_HZ):
    accel_steps = int(ms * ms / (2.0 * ac))
    decel_steps = accel_steps
    cruise = steps - accel_steps - decel_steps
    if cruise < 0:
        accel_steps = steps // 2
        decel_steps = steps - accel_steps
        cruise = 0

    tick = 1e6 / tick_hz
    t = 0.0
    last = 0.0
    interval = 0.0
    speed = 0
    n = 0
    dn = 0
    phase = "accel"
    peak = 0
    while n < steps and t < 600e6:
        fire = (interval == 0) or (t - last >= interval)
        if fire:
            n += 1
            last = t
            if phase == "accel":
                dn += 1
                x = min(1.0, dn / accel_steps)
                s = (math.sqrt(x / 0.15) * 0.7) if x < 0.15 else \
                    0.7 + 0.3 * (1 - (1 - (x - 0.15) / 0.85) ** 2)
                speed = max(OLD_MIN_SPEED, int(ms * s))
                interval = 1e6 / speed
                if dn >= accel_steps:
                    phase, speed, interval = "cruise", ms, 1e6 / ms
            elif phase == "cruise":
                if cruise > 0:
                    cruise -= 1
                interval = 1e6 / speed
                if cruise == 0:
                    phase, dn = "decel", 0
            else:
                dn += 1
                x = min(1.0, dn / decel_steps)
                s = (1 - 0.7 * (x / 0.85) ** 2) if x < 0.85 else \
                    0.3 * (1 - (x - 0.85) / 0.15) ** 2
                speed = max(OLD_MIN_SPEED, int(ms * s))
                interval = 1e6 / speed
            peak = max(peak, min(speed, tick_hz))
        t += tick
    # سقف واقعی: تایمر نمی‌تواند بیشتر از tick_hz استپ در ثانیه بدهد
    return t / 1e6, peak


def old_homing(ax):
    """زمان هوم یک محور از دورترین نقطه‌ی مجاز (کد قدیمی)"""
    search = ax["hi"] + ax["bo"]     # از softMax تا endstop (که در -bo قرار دارد)
    t_search = search / OLD_HOMING_SPEED
    # backoff داخل ISR با delayMicroseconds(500)+delayMicroseconds(500) => 1ms/step
    t_backoff = ax["bo"] * 1e-3
    return t_search + t_backoff, search


# ------------------------------------------------------------------
# شبیه‌سازی کد جدید (همان فرمول‌های Axis.cpp)
# ------------------------------------------------------------------
def new_move(ms, ac, steps, tick_hz=NEW_TICK_HZ, vmin=NEW_MIN_SPEED):
    v0 = vmin
    vmax = float(ms)
    a = float(ac)
    accel_full = (vmax**2 - v0**2) / (2 * a)
    decel_full = (vmax**2 - vmin**2) / (2 * a)

    if accel_full + decel_full <= steps:
        acc, dec = accel_full, decel_full
        cruise = steps - acc - dec
        vpeak = vmax
        t = 2 * (vmax - v0) / a + cruise / vmax
    else:
        ratio = accel_full / (accel_full + decel_full)
        acc = steps * ratio
        dec = steps - acc
        vpeak = math.sqrt(v0**2 + 2 * a * acc)
        t = (vpeak - v0) / a + (vpeak - vmin) / a
    # سقف فیزیکی: تایمر نمی‌تواند سریع‌تر از tick_hz استپ بدهد
    return t, min(vpeak, tick_hz)


def new_homing(ax):
    search = ax["hi"] + ax["bo"]
    # جستجو + مکث ۲۵ms + عقب‌نشینی به اندازه‌ی backoff
    return search / ax["hs"] + ax["bo"] / ax["hs"] + 0.025, search


# ------------------------------------------------------------------
def main():
    line = "=" * 86
    print(line)
    print("۱) هومینگ — زمان رسیدن به endstop و صفر شدن (از انتهای محدوده‌ی نرم‌افزاری)")
    print(line)
    print(f"{'محور':<6}{'مسافت(استپ)':>12}{'قبل(ثانیه)':>14}{'بعد(ثانیه)':>14}{'سرعت هوم':>12}{'بهبود':>10}")
    tot_old = tot_new = 0.0
    for k, ax in AXES.items():
        o, dist = old_homing(ax)
        n, _ = new_homing(ax)
        tot_old += o
        tot_new += n
        print(f"{k:<6}{dist:>12,}{o:>14.1f}{n:>14.1f}{ax['hs']:>12}{o/n:>9.1f}x")
    print(f"{'مجموع':<6}{'':>12}{tot_old:>14.1f}{tot_new:>14.1f}{'':>12}{tot_old/tot_new:>9.1f}x")
    print("\n  نکته: در کد قبلی سرعت هوم روی 100 steps/s hard-code شده بود و")
    print("        هیچ ارتباطی با AXIS_*_MAX_SPEED / ACCELERATION نداشت.")

    print()
    print(line)
    print("۲) حرکت ۴۵ درجه‌ی هر محور")
    print(line)
    print(f"{'محور':<6}{'استپ':>8}{'قبل(s)':>10}{'قبل(°/s)':>11}{'بعد(s)':>10}{'بعد(°/s)':>11}{'بهبود':>9}")
    for k, ax in AXES.items():
        steps = int(45 * ax["spd"])
        if steps > ax["hi"]:
            steps = ax["hi"]
        to, po = old_move(ax["ms"], ax["ac"], steps)
        tn, pn = new_move(ax["ms"], ax["acn"], steps)
        print(f"{k:<6}{steps:>8,}{to:>10.2f}{po/ax['spd']:>11.1f}{tn:>10.2f}{pn/ax['spd']:>11.1f}{to/tn:>8.1f}x")

    print()
    print(line)
    print("۳) سقف سرعت — چرا بالا بردن MAX_SPEED در کد قبلی هیچ اثری نداشت")
    print(line)
    steps = int(45 * AXES["X"]["spd"])
    print(f"   حرکت {steps} استپی (۴۵ درجه) روی محور X با شتاب ثابت:")
    print(f"   {'MAX_SPEED':>12}{'زمان کد قدیم':>16}{'زمان کد جدید':>16}")
    for ms in (1000, 2000, 4000, 8000):
        to, _ = old_move(ms, 4000, steps)
        tn, _ = new_move(ms, 8000, steps)
        print(f"   {ms:>12,}{to:>13.2f} s{tn:>13.2f} s")
    print(f"\n   سقف مطلق کد قدیم = {OLD_TICK_HZ} steps/s (تایمر 1kHz و یک استپ در هر تیک)")
    print(f"   سقف مطلق کد جدید = {NEW_TICK_HZ} steps/s")

    print()
    print(line)
    print("۴) دستور `profile slow/normal/fast`")
    print(line)
    print("   کد قبلی : ضریب‌ها فقط در SpeedProfileManager ذخیره می‌شدند و")
    print("             هیچ‌وقت به Axis نمی‌رسیدند → سرعت هیچ‌وقت عوض نمی‌شد.")
    print("   کد جدید : SpeedProfileManager.attach(motorController) + apply()")
    print("             ضریب را روی MAX_SPEED/ACCELERATION همه‌ی محورها می‌گذارد.")
    for name, mult in (("slow", 0.5), ("normal", 1.0), ("fast", 1.5)):
        t, p = new_move(int(AXES["X"]["ms"] * mult), int(6000 * mult), steps)
        print(f"      profile {name:<7} → {t:.2f}s برای ۴۵ درجه (اوج {p:.0f} steps/s)")


if __name__ == "__main__":
    main()
