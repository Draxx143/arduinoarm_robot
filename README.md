# 5 DOF Robot Arm Firmware for Arduino Mega2560

## Overview

This is a complete firmware for a 5-DOF robot arm controlled by an Arduino Mega2560 with ROS integration via rosserial. The firmware handles real-time motor control while ROS handles high-level tasks like inverse kinematics and trajectory planning.

## Repository layout / ساختار پوشه‌ها

همه‌چیز جای مشخصی دارد. اگر دنبال چیزی می‌گردی، اول اینجا را ببین:

```
arduinoarm_robot/
├── firmware/RobotArm_Firmware/   ← فریم‌ور (همین پوشه را در Arduino IDE باز کن)
│   ├── RobotArm_Firmware.ino       هسته‌ی اصلی + هندلر همه‌ی دستورات سریال
│   ├── Config.h                    ★ تنها منبع تنظیمات: سرعت/شتاب/soft limit/
│   │                                 بک‌آف هومینگ + HOMING_ORDER
│   ├── MotorController.{h,cpp}     موتور/محور + تولید استپ (ISR تایمر1)
│   ├── Trajectory.{h,cpp}          پروفایل ذوزنقه‌ای
│   ├── IK.{h,cpp}                  سینماتیک معکوس/مستقیم (FK)
│   ├── PositionStore.{h,cpp}       ۱۰ اسلات حافظه‌ی موقعیت
│   ├── TeachMode.{h,cpp}           ضبط/پخش تا ۳۰ گام
│   ├── TimerManager.{h,cpp}        تایمر «صبر کن بعد برو»
│   ├── Macro.{h,cpp}               ماکروهای ترتیبی
│   ├── SpeedProfile.{h,cpp}        slow / normal / fast
│   ├── EnergyManager.{h,cpp}       خواب خودکار + آمار مصرف
│   ├── Logger.{h,cpp}              حلقه‌ی لاگ
│   └── ROS_Interface.{h,cpp}       rosserial (در حالت TEST غیرفعال)
│
├── gui/                          ← GUI وب (مرورگر؛ بدون نصب، با حالت شبیه‌سازی)
│   ├── index.html
│   ├── js/{app,firmware,serial,sim,viz}.js
│   └── css/style.css
│
├── desktop-app/                  ← نسخه‌ی Electron (همان GUI به‌صورت اپ دسکتاپ)
│   ├── main.js, preload.js       پل serialport بین Node و رابط کاربری
│   ├── bridge/serial-bridge.js   پل جایگزین برای Node ≥ ۲۲
│   ├── renderer/{index.html, js/, css/}
│   └── package.json              npm install → npm start → npm run dist:*
│
├── tools/
│   ├── hosttest/run_tests.sh     ★ تست کامل روی کامپیوتر (بدون سخت‌افزار)
│   ├── sync_gui_config.py        همگام‌سازی عددهای GUI با Config.h
│   ├── gui_cmds.js               تولید همه‌ی دستورات GUI برای تست انطباق
│   ├── sim_motion.py             شبیه‌سازی ریاضی حرکت
│   └── preview_server.py         سرور محلی برای دیدن GUI وب در مرورگر
│
├── docs/
│   ├── PROTOCOL.md               ★ جدول کامل ۳۷ دستور سریال (قالب + پاسخ)
│   └── SPEED_FIX.md              گزارش فارسی اصلاح سرعت و هومینگ
│
├── themes/                       پیش‌نمایش پوسته‌های رنگی GUI
├── .github/workflows/build.yml   ساخت خودکار نصب‌کننده‌ها + تست‌ها
└── _archive/                     فایل zip اصلی آپلودشده (بایگانی)
```

**قاعده‌ی طلایی:** هر عددی که مربوط به حرکت است (سرعت، شتاب، بک‌آف، soft limit)
فقط و فقط در `firmware/RobotArm_Firmware/Config.h` تغییر می‌کند؛ GUIها همان
عددها را با `python3 tools/sync_gui_config.py` می‌گیرند.

---

## Features

- **5 Independent Axes Control**: Each axis has its own motion profile
- **Trapezoidal Acceleration/Deceleration**: Smooth motion profiles
- **Homing Sequence**: Automatic homing with configurable order
- **ROS Integration**: Full rosserial communication
- **Emergency Stop**: Hardware and software emergency stop
- **Software Limits**: Configurable soft limits for each axis
- **Modular Design**: Clean, object-oriented code structure

## Hardware Requirements

- Arduino Mega2560
- 5 Stepper Motors (NEMA17/NEMA23)
- 5 Stepper Drivers (A4988/TB6600)
- 5 Endstop Switches (NO, NC compatible)
- USB connection to ROS computer

## Pin Configuration

| Axis | STEP | DIR | ENABLE | ENDSTOP |
|------|------|-----|--------|---------|
| X    | A0   | A1  | 38     | 3       |
| Y    | A6   | A7  | A2     | 14      |
| Z    | 46   | 48  | A8     | 18      |
| A    | 26   | 28  | 24     | 2       |
| B    | 36   | 34  | 30     | 15      |

## Installation

### 1. Install Arduino IDE

Download and install Arduino IDE from [arduino.cc](https://www.arduino.cc/en/software)

### 2. Install rosserial

```bash
sudo apt-get install ros-<distro>-rosserial-arduino
sudo apt-get install ros-<distro>-rosserial

### 3. Open the sketch

Open **`firmware/RobotArm_Firmware/RobotArm_Firmware.ino`** in the Arduino IDE
(the whole `firmware/RobotArm_Firmware/` folder is the sketch folder), select
**Arduino Mega 2560**, and upload.

> `ROS_Interface.cpp` needs the `rosserial_arduino` library. The shipped
> firmware runs in **TEST MODE (no ROS)**, but the file is still part of the
> sketch folder, so rosserial must be installed for the build to succeed.

---

## Speed & motion tuning

Full background (in Persian) in [`docs/SPEED_FIX.md`](docs/SPEED_FIX.md).

The step engine is driven by Timer1 at `STEP_TICK_FREQ` (default **20 kHz**).
That value is the absolute ceiling for step rate:

```
max steps/second per axis = STEP_TICK_FREQ
degrees/second            = MAX_SPEED / (STEPS_PER_REV * MICROSTEP * GEAR_RATIO / 360)
ramp length (steps)       = MAX_SPEED^2 / (2 * ACCELERATION)
ramp time (s)             = MAX_SPEED / ACCELERATION
```

Rule of thumb: pick `ACCELERATION` so the ramp takes **0.2 – 0.4 s**.

### Runtime commands (Serial Monitor @ 115200)

```
speeds                       show the effective speed table
speed <percent>              global speed scale, e.g. speed 150
profile slow|normal|fast     50% / 100% / 150%
maxspeed <axis> <steps/s>    per-axis MAX_SPEED
accel <axis> <steps/s2>      per-axis ACCELERATION
homespeed <axis> <steps/s>   per-axis homing speed
status                       position, homed, moving, live speed, endstops
```

Changes apply to the **next** move (never mid-move).

### Motion commands

```
home                         home ALL joints, in priority order J1 -> J2 -> J3 -> J4 -> J5
home <1-5>                   home a single joint
homeorder                    show the current homing priority
homeorder <j1> <j2> <j3> <j4> <j5>
                             change the priority at runtime (each joint exactly once)
abort                        abort homing / motion
move <axis> <steps>          absolute move in steps
deg <axis> <degrees>         absolute move in degrees
moveall <d1> <d2> <d3> <d4> <d5>
traj line <d1..d5> <ms>      all axes arrive together in <ms>
demo / stopdemo
enable / disable [<axis>]
estop / reset / stop
savepos / loadpos / listpos / clearpos
timer <ms> <axis> <degrees>
teach / teach step / teach stop / play / play stop
ik <x> <y> <z> / fk <a1..a5>
log on|off|show|clear
sleep / wake / autosleep on|off
```

### Homing sequence

Homing is **strictly sequential by priority** and completely non-blocking
(no `delay()` inside the timer ISR, so the serial prompt stays alive and
`abort` works at any time).

For every joint, in priority order (`J1 -> J2 -> J3 -> J4 -> J5` by default):

```
   [endstop already pressed?] --yes--> RELEASE: creep off the switch
                                        |
   SEARCH  : move toward the endstop at AXIS_x_HOMING_SPEED
                                        |  endstop hit
   BACKOFF : dwell HOMING_DWELL_MS, then move away by AXIS_x_BACKOFF steps
                                        |
   VERIFY  : the endstop MUST be released -> position := 0, joint marked homed
                                        |
                              next joint starts only now
```

Guarantees:

* **The backoff is mandatory** — no joint is ever zeroed without backing off.
  The measured backoff distance is always at least `AXIS_x_BACKOFF` steps.
* **The endstop release is verified.** If the switch is still pressed after
  the backoff, homing continues up to `HOMING_BACKOFF_EXTRA_STEPS` more
  steps; if it is *still* pressed, homing **fails loudly** instead of
  silently zeroing on top of a pressed switch (which used to corrupt the
  whole position reference).
* `home` re-homes **all** joints even if they are already marked homed.
* A failing joint **aborts the sequence** — the remaining joints are not
  homed and are reported as not homed.

Reported fault reasons:

| message | meaning |
|---|---|
| `endstop not found within search limit` | switch never triggered — wiring / mount / travel |
| `endstop stuck - never released, even during backoff` | switch stays closed while moving away |
| `endstop still pressed after backoff` | backoff too short for this switch's hysteresis |
| `emergency stop active` | `estop` engaged — send `reset` first |

Tuning in `Config.h`:

```c
#define HOMING_ORDER         {0, 1, 2, 3, 4}   // priority: joint 1 first
#define HOMING_VERIFY_BACKOFF      true        // verify the switch released
#define HOMING_BACKOFF_EXTRA_STEPS 400         // extra travel to free a switch
#define AXIS_X_BACKOFF        5200             // per-joint backoff distance
#define AXIS_X_HOMING_SPEED    900             // per-joint homing speed
```

> Note: joint 1 (`X`) has a large `AXIS_X_BACKOFF` (5200 steps ≈ 117°).
> Since the position zero is defined **at the end of the backoff**, that
> value is part of your machine's geometry — change it only if you know the
> switch is mounted that far from the working zero.

---

## نصب روی لینوکس از ترمینال (کامل)

**یک خطی** — نه کلون لازم است نه چیز دیگر:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Draxx143/arduinoarm_robot/arena/01a091da-arduinoarm-robot/tools/install-linux.sh)
```

اسکریپت `tools/install-linux.sh` این کارها را به ترتیب انجام می‌دهد:
پاک‌سازی کامل نسخه‌ی قبلی → گرفتن لینک تازه‌ترین بسته از ریلیز `latest`
→ دانلود → نصب با `apt` (وابستگی‌ها خودکار حل می‌شوند) → گذاشتن کاربر در
گروه `dialout` برای دسترسی به پورت سریال → راستی‌آزمایی.

```bash
bash tools/install-linux.sh --dry-run      # فقط نشان بده چه می‌کرد
bash tools/install-linux.sh --appimage     # بدون روت، یک فایل اجرایی
bash tools/install-linux.sh --purge        # فقط حذف کامل
bash tools/install-linux.sh --keep-config  # حذف کامل ولی تنظیمات بماند
bash tools/install-linux.sh --force        # نصب دوباره‌ی همان نسخه
```

لینک مستقیم بسته‌ها (ریپو عمومی است، با `wget` هم می‌شود):

```bash
wget https://github.com/Draxx143/arduinoarm_robot/releases/download/latest/AXIS5-Robot-Control-1.0.53-amd64.deb
wget https://github.com/Draxx143/arduinoarm_robot/releases/download/latest/AXIS5-Robot-Control-1.0.53-x86_64.AppImage
```

> اگر شماره‌ی نسخه عوض شده باشد، `tools/install-linux.sh` خودش بالاترین نسخه‌ی
> موجود در ریلیز را پیدا می‌کند؛ لینک‌های بالا فقط برای دانلود دستی هستند.
> صفحه‌ی ریلیز: <https://github.com/Draxx143/arduinoarm_robot/releases/tag/latest>

اجرا: `axis5-robot-control` (یا از منوی برنامه‌ها). لاگ اجرا: `~/.axis5/last-run.log`.

---

## Control GUIs / رابط‌های کنترل

دو GUI وجود دارد که هر دو **یک پروتکل** را حرف می‌زنند:

| | GUI وب (`gui/`) | اپ دسکتاپ (`desktop-app/`) |
|---|---|---|
| نیاز به نصب | ندارد (فقط Chrome/Edge) | `npm install` |
| اتصال سریال | Web Serial API | ماژول `serialport` در Node |
| بدون سخت‌افزار | حالت شبیه‌سازی دارد | حالت شبیه‌سازی دارد |

```bash
# GUI وب در مرورگر
python3 tools/preview_server.py 8080      # بعد http://localhost:8080/gui/

# اپ دسکتاپ
cd desktop-app && npm install && npm start
```

هر دو GUI بدون سخت‌افزار هم کار می‌کنند: دکمه‌ی **حالت شبیه‌سازی** را بزن تا
یک مدل از بازو در مرورگر/اپ اجرا شود و همه‌ی دستورها را همان‌طور که فریم‌ور
پاسخ می‌دهد پاسخ بدهد.

### اسلایدرها همیشه با برد هم‌زمان‌اند (کانال POS)

فریم‌ور یک دستور `pos` دارد که یک خط ماشین‌خوان برمی‌گرداند:

```text
>> POS 0.0,36.9,20.9,0.0,-90.0
```

GUI هر ~۳۳۰ میلی‌ثانیه آن را می‌پرسد و اسلایدرها را با موقعیت واقعی برد
به‌روز می‌کند — یعنی اگر حرکت را از جای دیگری بدهی (تایپ در کنسول سریال،
Teach، تایمر، ماکرو)، اسلایدرها دنبالش می‌روند. انتهای `status` هم همین خط می‌آید، پس poll موجودِ وضعیت هم کفایت
می‌کند. موقع درگ کردن اسلایدر، همگام‌سازی موقتاً متوقف می‌شود تا عدد زیر
دستت نپرد (drag-safe). بعد از `home` هم اسلایدرِ جوینت‌های هوم‌شده فوراً صفر
می‌شود.

**کنسول سریالِ GUI شلوغ نمی‌شود.** پرسش‌های خودکار (`status` با نرخِ انتخابی
و `pos` سه بار در ثانیه) فرستاده و پردازش می‌شوند، ولی نه اکویشان (`> pos`) و
نه پاسخشان در کنسول چاپ می‌شود — وگرنه دستوراتی که خودت تایپ می‌کنی در چند
ثانیه از دید خارج می‌رفت. هر دستوری را که **خودت** بفرستی (تایپ در کنسول یا
دکمه) کامل می‌بینی: `status` یک بلوکِ کاملِ همان لحظه و `pos` یک خطِ موقعیت.
پیام‌های خودِ برد (هومینگ، `!! خطا`، `>> Move complete`) همیشه چاپ می‌شوند و
هیچ‌وقت پنهان نمی‌مانند.

### برو به مختصات (Go to XYZ)

در تب Motion یک بخش «📍 برو به مختصات» هست: X/Y/Z نوک بازو را میلی‌متر
می‌دهی، زوایای پنج جوینت حل می‌شود، **اول** با محدوده‌ی درجه‌ی هر جوینت
چک می‌شود و بعد `ik x y z` می‌رود. اگر هدف قابل‌دسترس نباشد، دلیلش را
می‌گوید (مثلاً «آرنج بیش از ۵۵° خم می‌شود») و دکمه‌ی «↔ نزدیک‌ترین نقطه»
هدف را در همان جهت به بازه‌ی مجاز می‌آورد.

مدل هندسی در GUI و فریم‌ور **یکی** است (ساعد مؤثر `L2+L3`، چون مچ صفر
می‌ماند) و تست `tools/test_ik_parity.js` همین را ثابت می‌کند: همان نقطه‌ها
به باینری فریم‌ور داده می‌شود و خروجی‌اش با پیش‌محاسبه‌ی هر دو GUI مقایسه
می‌شود (بیشترین اختلاف مجاز ۰.۱۱° — فقط دقت چاپ یک رقم اعشار).

### نقطه‌ی صفرِ جوینت ۵

`Config.h` → `HOMING_ZERO_OFFSET_DEG {0,0,0,0,90}`: بعد از هومینگ، J5 نود
درجه جلو می‌رود و **همان‌جا صفر می‌شود** (پس endstop در ۹۰− درجه است و
دامنه‌ی مچ قرینه). در GUI هم کنار J5 نوشته شده «صفر ‎+90° از endstop».

### اگر عددی در GUI با فریم‌ور فرق داشت

```bash
python3 tools/sync_gui_config.py            # GUI را از Config.h بازنویسی می‌کند
python3 tools/sync_gui_config.py --check    # فقط بررسی (در CI هم اجرا می‌شود)
```


---

## اگر برد وسطِ کار قطع می‌شود: افتِ USB (EMI)

اگر در کنسول این را می‌بینی:

```
!! [Errno 5] Input/output error        (×20)
[RECONNECT] the link dropped — watching for the board to come back…
[RECONNECT] the kernel re-enumerated the board as /dev/ttyUSB1 (it was /dev/ttyUSB0)
```

و در `sudo dmesg | tail -30` این:

```
usb usb1-port2: disabled by hub (EMI?), re-enabling...
usb 1-2: USB disconnect, device number 13
usb 1-2: failed to send control message: -19
ch341-uart ttyUSB0: ch341-uart converter now disconnected from ttyUSB0
```

یعنی برد **از BUSِ یو‌اس‌بی بیرون می‌افتد و برمی‌گردد**. این الکتریکی است،
نه نرم‌افزاری — خودِ کرنل می‌نویسد «EMI?». شایع‌ترین علت‌ها در بازوی
رباتیک: نویزِ موتورِ استپ روی کابلِ یو‌اس‌بی، نبودِ **زمینِ مشترک** بین
تغذیه‌ی موتورها و آردوینو، کابلِ بلند/نازک، پورتِ پنلِ جلو یا هاب، و افتِ
ولتاژ هنگامِ حرکتِ موتورها.

به همین ترتیب درستش کن:

1. کابلِ **کوتاه و شیلددار** (کمتر از ۱ متر) — نه کابلِ شارژرِ تلفن.
2. پورتِ **پشتِ مادربرد**، مستقیم — بدونِ هاب و بدونِ پنلِ جلو.
3. **زمینِ مشترک**: GNDِ منبعِ تغذیه‌ی موتورها را به GNDِ آردوینو وصل کن.
4. کابلِ یو‌اس‌بی را از سیم‌کشیِ موتورها **دور** نگه دار (دسته‌بندی نکن؛ اگر
   مجبوری، با زاویه‌ی ۹۰ درجه رد کن).
5. خازنِ بزرگ (۴۷۰–۱۰۰۰µF) روی ریلِ تغذیه‌ی موتورها، نزدیکِ درایورها.
6. هسته‌ی فریت روی کابلِ یو‌اس‌بی — و اگر باز هم افت داشت، **ایزولاتورِ USB**.

اپ در این وضعیت خودش کار درست را می‌کند: منتظرِ برگشتِ برد می‌ماند، گره‌ی
تازه‌ای که کرنل می‌سازد را **پیدا می‌کند** (چون اسمش بین `ttyUSB0` و
`ttyUSB1` عوض می‌شود) و با همان سرعتِ قبلی وصل می‌شود. خطای تکراریِ
`[Errno 5]` هم در کنسول جمع می‌شود (`×N`) تا سیلِ پیام، علتِ اصلی را پنهان
نکند.

---

## اگر موتورها سفت می‌شوند ولی هیچ جوابی نمی‌آید

این نشانه خیلی خاص است و یک معنی دارد. در فریم‌ور، `Axis::init()` موتورها را
**غیرفعال** می‌کند (`ENABLE = HIGH`) و فقط دستورِ `enable` / `home` سفتشان
می‌کند؛ اپ هم هنگامِ اتصال تنها `status` می‌فرستد. پس اگر با زدنِ «اتصال»
موتورها سفت یا وزوز‌کنان شدند و یک بایت هم نیامد، یعنی **AVR اصلاً اجرا
نمی‌شود**: در ریست نگه داشته شده یا brown-out می‌کند، پین‌هایش شناور
می‌مانند و همان شناوری، درایورها را فعال می‌کند. بردی که اجرا نمی‌شود نه
بنرِ بوت می‌فرستد نه به دستوری جواب می‌دهد — و هیچ نرم‌افزاری نمی‌تواند
جایش حرف بزند.

**آزمونِ ۳۰ ثانیه‌ای که این را قطعی می‌کند:** تغذیه‌ی موتورها را بکش (فقط
USB بماند) → برد را یک بار خاموش/روشن کن → «اتصال» را بزن. اگر وصل شد،
یعنی موتورها ریلِ ۵ ولت را پایین می‌کشیدند: تغذیه‌ی موتورها را از USB جدا
نگه دار و GNDِ منبعِ موتورها را به GNDِ آردوینو ببند.

اگر با موتورِ بی‌برق هم ساکت بود، برد/کابل/پورت مقصر است: یک پورتِ دیگر،
یک کابلِ **دیتا**ِ کوتاه، و `sudo dmesg -w` را موقعِ وصل‌کردن نگاه کن.

---

## اگر برد وصل نمی‌شود

اپ از نسخه‌ی ۱.۰.۴۹ هیچ ابزارِ تشخیصیِ جداگانه‌ای ندارد — چون خودِ آن
ابزارها (کاوشِ پشتِ سرِ همِ baud، باز و بسته‌کردنِ مکررِ پورت) روی CH340
باعثِ افتِ تغذیه و بیرون‌افتادنِ دستگاه از BUS می‌شدند، یعنی مشکل را بدتر
می‌کردند. به‌جایش اپ **خودش** این سه کار را می‌کند:

1. دکمه‌ی **اتصال** همیشه از **پلِ سیستمی** می‌رود (ترموسِ خام + پالسِ ریستِ
   درست)، حتی وقتی کشوی پورت خالی است — در آن حالت خودش تنها پورتِ واقعیِ
   سیستم را برمی‌دارد. پورت‌های شبحیِ `/dev/ttyS*` هم از فهرست حذف
   می‌شوند (قبلاً کاربر «۳۳ دستگاه» می‌دید درحالی‌که یکی واقعی بود).
2. مسیرِ وب‌سریال هم خطوطِ مودم را کنترل می‌کند (`setSignals`) — بدونِ آن،
   بردهای USB بومی (Leonardo/Micro/ESP32) «میزبان وصل نیست» فرض می‌کنند و هر
   `Serial.print` را بی‌صدا دور می‌ریزند.
3. اگر بعد از اتصال **RX صفر** بماند، **یک بار** می‌گوید «دکمه‌ی RESET روی
   برد را بزن» و منتظر می‌ماند — پورت را دوباره باز نمی‌کند. اگر بعد از
   RESET هم ساکت ماند، حکمِ روشن می‌دهد: برد از USB می‌افتد (EMI/تغذیه) و
   راهِ تأییدش `sudo dmesg | tail -30` است.
4. اگر داده می‌آید ولی **کاراکترِ بی‌معنی** است، یعنی سرعت غلط است — اپ
   صریح می‌گوید `BAUD RATE IS WRONG` و خودش به ۱۱۵۲۰۰ برمی‌گردد و دوباره
   وصل می‌شود (فقط یک بار، نه در یک نردبان).

اگر می‌خواهی بیرون از اپ بررسی کنی، اسکریپتِ ترمینال هست (بدونِ UI):

```bash
bash tools/diagnose-linux.sh              # خودش پورت را پیدا می‌کند
bash tools/diagnose-linux.sh /dev/ttyUSB0 # یا پورتِ مشخص
bash tools/diagnose-linux.sh /dev/ttyUSB0 9600   # اگر baud اشتباه باشد
```

خروجیِ بخشِ «دست‌دادنِ واقعی با برد» تعیین‌کننده است:

| چه دیدی | یعنی | کار |
|---|---|---|
| `AXIS-5 Firmware v1.0.41` + بلوکِ status | پورت، مجوز و فریم‌ور سالم‌اند | مشکل از اپ است؛ اپ را از ترمینال اجرا کن: `axis5-robot-control` |
| هیچ بایتی نیامد | برد ساکت است | دکمه‌ی **RESET** روی برد را بزن؛ بعد LED چشمک‌زن، کابلِ **دیتا** و تغذیه‌ی خارجی را چک کن |
| متنِ به‌هم‌ریخته | baud اشتباه | فریم‌ور روی ۱۱۵۲۰۰ است؛ اپ خودش برمی‌گرداند |
| `Permission denied` | گروهِ dialout | `sudo usermod -aG dialout $USER` + **logout/login** |
| `Resource busy` | خواننده‌ی دوم | Arduino IDE / Serial Monitor / اپِ دوم را ببند |
| `disabled by hub (EMI?), re-enabling` در dmesg | افتِ الکتریکیِ USB | بخشِ «افتِ USB (EMI)» بالای همین صفحه |
| جواب می‌دهد ولی نسخه ندارد | فریم‌ورِ قدیمی روی برد | `firmware/RobotArm_Firmware/` را دوباره فلش کن |

> **ریشه‌ی شایع‌ترین حالت («پورت شناسایی می‌شود، خطایی نمی‌آید، ولی RX صفر
> می‌ماند»)** در خودِ پلِ سریال بود و در نسخه‌ی ۱.۰.۴۴ اصلاح شد:
> برای ریستِ خودکارِ آردوینو یک پالسِ DTR می‌زنیم. در بردهای **Rev3**
> (Uno/Mega) خطِ RESET با یک **جفت ترانزیستور** از DTR و RTS هدایت می‌شود و
> تا وقتی این دو در **سطحِ متفاوت** باشند AVR در ریست **نگه داشته می‌شود**.
> پالسِ قبلی با `DTR=1, RTS=0` تمام می‌شد — یعنی برد برای کلِ نشست در ریست
> می‌ماند: پورت بدون خطا باز می‌شد، بایت‌های TX را کرنل می‌پذیرفت، و هیچ
> بایتی برنمی‌گشت. حالا پالس با **هر دو خط در یک سطح** (`DTR=RTS=1`) تمام
> می‌شود؛ همان وضعیتی که Arduino IDE و pyserial رها می‌کنند و برای بردهای
> USB بومی (32u4/ESP32) هم لازم است تا «میزبان وصل است» را ببینند و
> `Serial.print`شان دور ریخته نشود. تستِ `tools/test_reset_lines.py`
> (مرحله‌ی ۱۰/۱۰) همین را روی فایلِ واقعیِ پل پین می‌کند.


---

## Development

`tools/hosttest/run_tests.sh` runs twelve stages against the **real firmware and
GUI sources** (no hardware needed):

1. **Compile** every `.cpp` + the sketch with g++ against an Arduino stub.
2. **Link** them and feed **90 serial commands** through the actual handlers, so
   `undefined reference` and runtime crashes are caught before flashing.
3. **Simulate** the 20 kHz step ISR behaviourally: homing priority and backoff,
   trapezoid timing accuracy, speed ceilings, estop, soft limits, mid-move
   retargeting, the J5 zero-offset phase, IK/FK sanity — **75 assertions**.
4. **GUI ↔ firmware conformance**: `tools/gui_cmds.js` loads both GUIs' `Cmd`
   tables, generates every command they can send (**80 today**), and the firmware
   must recognise all of them — a GUI button can never silently send something
   the firmware answers with `Unknown command` again.
5. **POS sync channel**: exact `>> POS` format, no echo, no `nan`, present at the
   end of `status`, and the values follow a move.
6. **Kinematics**: the Go-to-XYZ reachable band + IK/FK round-trip
   (`tools/test_goto.js`) and GUI-vs-firmware IK parity over 9 points × 2 GUIs
   (`tools/test_ik_parity.js`).
7. **Both GUIs in a real DOM** (`tools/test_gui_dom.js`, jsdom): the slider rows
   keep exactly four grid children and no stray text node (a comment that slips
   into the row template silently squashes the slider), poll replies *and their
   echoes* never reach the serial console while a manual `status`/`pos` prints
   exactly once, the slider lands on 0 after homing, and it then follows the
   position the simulated board reports.
8. **Serial bridge** (`tools/test_pybridge.js`): opens `bridge/serial_bridge.py`
   on a **real pty** (`tools/pty_holder.py`) and checks open → RX → TX → close,
   plus every failure mode (missing port, non-tty file, no python3) — each must
   return `{err}` fast instead of hanging the Connect button forever.
9. **Reset pulse** (`tools/test_reset_lines.py`): runs the real
    `bridge/serial_bridge.py` on a pty with a stubbed `fcntl` and asserts the
    DTR/RTS sequence ends with **both lines at the same level**, so the board is
    left running instead of held in reset (the classic RX=0 cause). The same
    rule is checked in `tools/diagnose-linux.sh`.
10. **Connect paths** (`tools/test_connect_paths.js`): loads the desktop
    renderer in jsdom with a mock `electronAPI` and pins what actually fixes
    RX=0 — Web Serial must pulse DTR/RTS and end with both lines at the same
    level, the Connect button must use the **system bridge** even with an empty
    port dropdown, unreadable bytes must trigger exactly one automatic baud
    correction, a silent board must get **one** RESET prompt and **no** port
    re-open, a USB drop-out must auto-reconnect to the renamed node, and the
    diagnostic tools must stay deleted.
11. **Port ownership** (`tools/test_portnames.js`, 44 checks): the phantom
    `/dev/ttyS*` filter, the stable `/dev/axis5` name (substituted in both the
    plain list and the structured port list, never duplicated, and preferred
    even when the real node momentarily vanished), orphan-bridge detection and
    `SIGTERM` kill — including that the app **never** kills its own PIDs — and
    that `99-axis5-serial.rules` is really shipped in the package and installed
    by *both* installers, so the fix cannot silently disappear.
12. **Main-process chain end to end** (`tools/test_main_ipc.js`, 22 checks):
    the one place where bytes could silently vanish and which no test had ever
    covered — the *real* `main.js` + *real* `pybridge.js` + *real*
    `serial_bridge.py` against a fake board on a pty, with `electron` replaced
    by a stub. It proves `serialport:open` resolves, the board's boot banner
    really arrives at `webContents.send("serialport:data")` intact, a written
    command really reaches the board, `serialport:stats` counts it, close is
    reported, and the orphan-bridge killer never targets our own PIDs.

```bash
bash tools/hosttest/run_tests.sh     # همه‌ی دوازده مرحله
cd tools && npm install              # فقط برای مرحله‌ی ۷ (jsdom) — اختیاری
```

مرحله‌ی ۷ بدون jsdom **SKIP** می‌شود (نه FAIL)، پس اسکریپت بدون `npm install`
هم کامل اجرا می‌شود.

`tools/sim_motion.py` simulates the exact motion math (old vs. new firmware)
on a desktop, so speed regressions can be measured without hardware:

```bash
python3 tools/sim_motion.py
```

`tools/sync_gui_config.py` keeps the GUIs' numbers (speed, accel, backoff, soft
limits, degree ranges, homing order) identical to `Config.h`:

```bash
python3 tools/sync_gui_config.py --check   # exits 1 if a GUI drifted
```

---

## مجوز و نسبت‌دادن / License & Attribution — MIT

کلِ این پروژه — فریم‌ور، GUI وب، اپ دسکتاپ، ابزارها و مستندات — تحتِ مجوزِ
**MIT** منتشر شده است. متنِ کامل: [`LICENSE`](LICENSE).

یعنی هر کسی آزاد است از این فایل‌ها استفاده کند، تغییرشان بدهد، منتشر کند و
حتی بفروشد، **به یک شرط**: اعلانِ حقِ نشر همراهشان بماند:

> Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
> https://github.com/Draxx143/arduinoarm_robot

برای اینکه حتی اگر کسی **فقط یک فایل** را برداشت صاحبِ اثر و نشانیِ پروژه با
آن برود، سرِ همه‌ی ۴۹ فایلِ اصلیِ پروژه هم این دو خط آمده است:

```text
SPDX-License-Identifier: MIT
Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm · https://github.com/Draxx143/arduinoarm_robot
```

این پروژه «همان‌طور که هست» و بدون هیچ ضمانتی ارائه می‌شود (بندِ سلبِ
مسئولیتِ MIT را ببین).

اگر ترجیح می‌دهی استفاده‌ی دیگران **مشروط** شود — یعنی نسخه‌ی تغییر‌یافته هم
باید با همان مجوزِ باز منتشر شود (copyleft) — می‌شود مجوز را به **GPL-3.0**
عوض کرد؛ و اگر محافظتِ حقِ اختراع هم می‌خواهی، **Apache-2.0** گزینه‌ی بهتری است.
