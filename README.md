# 🤖 AXIS-5 — کنترل بازوی رباتیک ۵ درجه (Arduino Mega 2560)

پروژه‌ی کامل کنترل بازوی رباتیک ۵ محوره: **فریم‌ور آردوینو** + **اپلیکیشن دسکتاپ صنعتی** (ویندوز و لینوکس) + **پنل وب فارسی**.

---

## 📁 ساختار پروژه

```
arduinoarm_robot/
├── firmware/
│   └── RobotArm_Firmware/      ← فریم‌ور آردوینو (اسکچ + تمام ماژول‌ها)
│       ├── RobotArm_Firmware.ino
│       ├── Config.h                تنظیمات پین‌ها و محدوده‌ها
│       ├── MotorController.*       کنترل ۵ استپر + وقفه ۱۰kHz
│       ├── Axis.*                  پروفایل حرکتی S-Curve و هومینگ
│       ├── IK.*                    کینماتیک معکوس/مستقیم
│       ├── TimerManager.*          تایمرهای حرکت خودکار
│       ├── TeachMode.* / PositionStore.*   یادگیری و ذخیره وضعیت
│       └── ...                     Logger, EnergyManager, Macro, Trajectory, SpeedProfile
├── desktop-app/                ← اپلیکیشن دسکتاپ «AXIS-5 Robot Control» (انگلیسی، تم صنعتی Steel & Amber)
│   ├── main.js / preload.js    هسته‌ی Electron
│   └── renderer/               رابط کاربری (کنسول، تب Motion، Event Feed، شبیه‌ساز داخلی)
├── gui/                        ← پنل وب فارسی (بدون نصب، از طریق Web Serial در Chrome/Edge)
└── README.md                   همین راهنما
```

> ⚠️ پوشه‌ی فریم‌ور **باید** هم‌نام فایل `.ino` باشد (`RobotArm_Firmware`) — این ساختار را تغییر ندهید وگرنه Arduino IDE آن را باز نمی‌کند.

---

## 📦 دانلود نصب‌کننده‌ها

آخرین نسخه همیشه در صفحه‌ی [**Releases**](https://github.com/Draxx143/arduinoarm_robot/releases/latest) موجود است:

| فایل | پلتفرم | نوع |
|---|---|---|
| `AXIS5-Robot-Control-1.0.30-amd64.deb` | Ubuntu / Debian | نصب‌کننده‌ی سیستم |
| `AXIS5-Robot-Control-1.0.30-x86_64.AppImage` | هر لینوکس ۶۴بیتی | قابل‌حمل، بدون نصب |
| `AXIS5-Robot-Control-Setup-1.0.30.exe` | Windows 10/11 | نصب‌کننده |
| `AXIS5-Robot-Control-Portable-1.0.30.exe` | Windows 10/11 | قابل‌حمل، بدون نصب |

---

## 🖥️ نصب روی Ubuntu (۳ روش)

### روش ۱ — نصب با بسته‌ی deb (پیشنهادی)

از طریق ترمینال:

```bash
# ۱) دانلود آخرین نسخه
wget -c https://github.com/Draxx143/arduinoarm_robot/releases/download/latest/AXIS5-Robot-Control-1.0.30-amd64.deb

# ۲) (اختیاری اما توصیه‌شده) بررسی سلامت فایل — خروجی این دستور باید
#    با SHA256 نمایش‌داده‌شده کنار فایل در صفحه‌ی Releases یکی باشد
sha256sum AXIS5-Robot-Control-1.0.30-amd64.deb

# ۳) نصب
sudo apt install ./AXIS5-Robot-Control-1.0.30-amd64.deb
```

پس از نصب، برنامه با نام **AXIS-5 Robot Control** در منوی برنامه‌ها ظاهر می‌شود، یا در ترمینال:

```bash
axis5-robot-control
```

> اگر فایل را از مرورگر دانلود کردید، فقط مسیر را عوض کنید: `sudo apt install ~/Downloads/AXIS5-Robot-Control-1.0.30-amd64.deb`

### روش ۲ — AppImage (بدون نصب، قابل‌حمل)

```bash
chmod +x AXIS5-Robot-Control-1.0.30-x86_64.AppImage
./AXIS5-Robot-Control-1.0.30-x86_64.AppImage
```

اگر روی توزیع‌های جدید خطای sandbox داد:

```bash
./AXIS5-Robot-Control-1.0.30-x86_64.AppImage --no-sandbox
```

### روش ۳ — اجرا از سورس

```bash
sudo apt install git nodejs npm     # Node.js 18 به بالا
git clone https://github.com/Draxx143/arduinoarm_robot.git
cd arduinoarm_robot/desktop-app
npm install
npm start
```

### 🔌 دسترسی به پورت سریال (مهم!)

کاربر باید عضو گروه `dialout` باشد وگرنه پورت COM نمایش داده نمی‌شود:

```bash
sudo usermod -aG dialout $USER
# سپس یک‌بار Logout/Login کنید
```

---

## 🗑️ حذف کامل از Ubuntu

بسته به روش نصب:

### اگر با deb نصب کرده‌اید:

```bash
# ۱) حذف بسته و تنظیمات آن
sudo apt purge axis5-robot-control
sudo apt autoremove

# ۲) فایل‌هایی که خارج از dpkg ساخته شده‌اند (wrapper و میان‌بر)
sudo rm -f /usr/bin/axis5-robot-control
sudo rm -f /usr/share/applications/axis5-robot-control.desktop

# ۳) پوشه‌های تنظیمات و لاگ کاربر
rm -rf ~/.config/AXIS5-Robot-Control
rm -rf ~/.axis5
```

### اگر با AppImage اجرا می‌کردید:

```bash
rm -f ~/AXIS5-Robot-Control-*.AppImage          # یا هرجا که فایل بود
rm -rf ~/.config/AXIS5-Robot-Control
```

### اگر از سورس اجرا می‌کردید:

```bash
rm -rf ~/arduinoarm_robot        # کل مخزن
rm -rf ~/.config/AXIS5-Robot-Control
```

### ✅ بررسی حذف کامل

```bash
dpkg -l | grep -i axis5          # باید خالی باشد
which axis5-robot-control        # باید خالی باشد
ls ~/.config | grep -i axis5     # باید خالی باشد
```

> 💡 گروه `dialout` را اگر لازم ندارید می‌توانید نگه دارید؛ برای سایر برنامه‌های سریال هم کاربرد دارد. برای حذف: `sudo deluser $USER dialout`

---

## 🪟 نصب روی Windows

### روش ۱ — نصب‌کننده‌ی Setup

1. فایل `AXIS5-Robot-Control-Setup-1.0.30.exe` را از [Releases](https://github.com/Draxx143/arduinoarm_robot/releases/latest) دانلود کنید.
2. روی آن دوبار کلیک کنید (اگر SmartGuard هشدار داد: **More info → Run anyway** — چون امضای دیجیتال خریداری نشده).
3. نصب پیش‌فرض: میان‌بر روی **دسکتاپ** و **Start Menu** ساخته می‌شود.

### روش ۲ — نسخه‌ی Portable (بدون نصب)

فایل `AXIS5-Robot-Control-Portable-1.0.30.exe` را دانلود و مستقیم اجرا کنید — نیازی به نصب ندارد و می‌توانید از فلش هم اجرایش کنید.

### روش ۳ — اجرا از سورس

[Node.js LTS](https://nodejs.org) را نصب کنید، سپس در PowerShell:

```powershell
git clone https://github.com/Draxx143/arduinoarm_robot.git
cd arduinoarm_robot\desktop-app
npm install
npm start
```

### 🗑️ حذف از Windows

- **نسخه‌ی Setup:** `Settings → Apps → Installed apps → AXIS-5 Robot Control → Uninstall`
- **نسخه‌ی Portable:** فقط فایل exe را Delete کنید.
- پاک‌سازی تنظیمات (هر دو حالت): پوشه‌ی `%APPDATA%\AXIS5-Robot-Control` را حذف کنید.

---

## ⚙️ فلش فریم‌ور روی آردوینو

1. **Arduino IDE 2.x** را از [arduino.cc](https://www.arduino.cc/en/software) نصب کنید.
2. فایل `firmware/RobotArm_Firmware/RobotArm_Firmware.ino` را باز کنید — همه‌ی ماژول‌های `.cpp/.h` به‌صورت تب‌های کناری باز می‌شوند.
3. `Tools → Board → Arduino AVR Boards → Arduino Mega or Mega 2560` و پورت صحیح را انتخاب کنید.
4. دکمه‌ی **Upload** را بزنید.
5. ⚠️ پس از آپلود، **Serial Monitor آردوینو را ببندید** — آن پورت باید آزاد بماند تا اپ دسکتاپ بتواند وصل شود.
6. اپ را باز کنید → **⚡ Connect Arduino** → پورت را انتخاب کنید → **⌂ Home All**.

بدون سخت‌افزار هم می‌توانید همه‌چیز را با **▦ Simulator داخلی** اپ تست کنید.

---

## 🌐 نسخه‌ی وب فارسی (بدون نصب)

پوشه‌ی [`gui/`](gui/) یک پنل تحت وبِ فارسی است: فایل `gui/index.html` را در **Chrome یا Edge** باز کنید (Web Serial فقط در این مرورگرها کار می‌کند) و مستقیم به برد وصل شوید.

---

## 🧰 عیب‌یابی سریع

| مشکل | راه‌حل |
|---|---|
| اپ بلافاصله بعد از باز شدن می‌میرد (لینوکس) | از ترمینال اجرا کنید: `axis5-robot-control` و بعد `~/.axis5/last-run.log` را ببینید |
| پنجره‌ی خالی/مخدوش در ماشین مجازی | اجرا با `AXIS5_SAFE=1 axis5-robot-control` |
| پورت سریال در لیست نیست | `sudo usermod -aG dialout $USER` + خروج/ورود |
| فایل deb خراب (`Invalid archive member header`) | دانلود ناقص بوده — با `wget -c` دوباره دانلود و با `dpkg-deb -I` بررسی کنید |
| AppImage اجرا نمی‌شود | `chmod +x` فراموش نشده؟ در صورت خطای sandbox: `--no-sandbox` |

---

## 📜 خلاصه‌ی دستورات سریال فریم‌ور

`home` / `home <1-5>` · `status` · `enable/disable [N]` · `estop` · `reset` · `demo` / `stopdemo` · `stop` · `deg <N> <val>` · `move/moveall` · `savepos/loadpos/listpos/clearpos` · `teach` / `play` · `timer <ms> <N>` / `timers` / `cleartimers` · `ik <x> <y> <z>` / `fk <a1..a5>` · `profile slow/normal/fast` · `log on/off/show/clear` · `sleep` / `wake` / `autosleep on/off` · `ack on/off` (تاییدیه اجرای هر دستور)

جزئیات کامل: [`desktop-app/README.md`](desktop-app/README.md)
