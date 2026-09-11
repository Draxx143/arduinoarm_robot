#ifndef CONFIG_H
#define CONFIG_H

// ============================================
// ROBOT ARM CONFIGURATION
// ============================================

// Number of Joints
#define NUM_AXES 5

// ============================================
// موتور حرکت (Motion Engine)
// ============================================
// مهم‌ترین تنظیم سرعت کل دستگاه!
//
// قبلاً حلقه‌ی کنترل روی 1kHz بود و در هر تیک فقط «یک» استپ صادر می‌شد،
// برای همین سقف واقعی سرعت روی 1000 steps/s قفل شده بود و بالا بردن
// MAX_SPEED هیچ اثری نداشت. حالا تایمر روی STEP_TICK_FREQ کار می‌کنه.
//
//   سقف سرعت هر محور = STEP_TICK_FREQ استپ بر ثانیه
//   تفکیک زمانی       = 1 / STEP_TICK_FREQ  (50µs برای 20kHz)
//
// اگه خواستی سریع‌تر بشی، اول MAX_SPEED/ACCELERATION محورها رو ببر بالا؛
// فقط وقتی این عدد لازم می‌شه که MAX_SPEED بالای ~8000 بذاری.
#define STEP_TICK_FREQ         20000L   // Hz — تیک تولید استپ

// پهنای پالس STEP (میکروثانیه). برای A4988/DRV8825 حداقل 1µs،
// برای درایورهای اپتوکوپلر دار مثل TB6600 بهتره 3 تا 5µs باشه.
#define STEP_PULSE_US          3

// تایمر ۱ (تولیدکننده‌ی تیک استپ)
#define TIMER_FREQUENCY        16000000L
#define TIMER_PRESCALER        8                             // باید با TIMER_OCR_BITS یکی باشه
#define TIMER_TICK_FREQ        (TIMER_FREQUENCY / TIMER_PRESCALER)   // 2MHz
#define TIMER_OCR_VALUE        ((TIMER_TICK_FREQ / STEP_TICK_FREQ) - 1)
#define TIMER_OCR_BITS         (1 << CS11)                   // prescaler = 8

#if (TIMER_PRESCALER != 8)
  #error "TIMER_PRESCALER بايد 8 باشه يا TIMER_OCR_BITS متناسب باهاش اصلاح بشه"
#endif

// حلقه‌ی کنترل/نظارت (بررسی estop و ...) — با تقسیم تیک استپ ساخته می‌شه
#define CONTROL_LOOP_FREQ      1000     // Hz
#define TICKS_PER_CONTROL      (STEP_TICK_FREQ / CONTROL_LOOP_FREQ)   // 20

// ============================================
// پروفایل سرعت (شتاب/رمپ)
// ============================================
// سرعت شروع و پایان هر حرکت (steps/s). هر چه بالاتر = حرکت سریع‌تر
// شروع می‌شه، ولی اگه خیلی بالا باشه موتور ممکنه استپ از دست بده.
// (در کد قبلی این عدد 200 بود و منحنی سرعت هم تا نزدیکی صفر افت می‌کرد،
//  برای همین اول و آخر هر حرکت بازو می‌خزید)
#define RAMP_MIN_SPEED         350    // steps/s

// ضریب کلی سرعت کل دستگاه (درصد). با دستور `speed <percent>` هم عوض می‌شه.
#define SPEED_SCALE_PERCENT    100

// ضریب پروفایل‌ها
#define PROFILE_SLOW_PERCENT   50
#define PROFILE_FAST_PERCENT   150

// سقف ضریب سرعت — اجازه نمی‌ده از MAX_SPEED تعریف‌شده‌ی هر محور بالاتر بره
#define MAX_SPEED_LIMIT        12000  // steps/s

// ============================================
// هومینگ
// ============================================
// سرعت هوم هر محور پایین‌تر به‌صورت جداگانه تعریف شده (AXIS_x_HOMING_SPEED).
#define HOMING_RELEASE_PERCENT    25    // سرعت آزادسازی endstop (% سرعت هوم)
#define HOMING_RELEASE_MAX_STEPS  1500  // حداکثر استپ برای آزاد کردن endstop
#define HOMING_DWELL_MS           25    // مکث بعد از برخورد به endstop
#define HOMING_MARGIN_PERCENT     25    // حاشیه‌ی ایمنی روی مسافت جستجو
#define HOMING_MIN_SPEED          120   // کف سرعت هوم (steps/s)

// ---- ترتیب اولویت هومینگ ----
// هومینگ کاملاً ترتیبی است: اول جوینت ۱، بعد جوینت ۲، بعد ۳، ۴ و ۵.
// هر جوینت باید جست‌وجو + بک‌آف را کامل تمام کند تا نوبت به بعدی برسد.
// (ایندکس‌ها صفر‌بنیان‌اند: 0=جوینت۱/X  1=جوینت۲/Y  2=جوینت۳/Z  3=A  4=B)
// با دستور سریال «homeorder 1 2 3 4 5» در زمان اجرا هم قابل تغییر است.
#define HOMING_ORDER         {0, 1, 2, 3, 4}

// ---- بک‌آف اجباری ----
// هیچ محوری بدون بک‌آف «صفر» نمی‌شود. بعد از پایان بک‌آف، آزاد شدن
// endstop بررسی می‌شود؛ اگر سوئیچ هنوز فشرده بود هومینگ با خطا تمام
// می‌شود (قبلاً بی‌سروصدا موقعیت صفر می‌شد در حالی که سوئیچ زیر فشار بود).
#define HOMING_VERIFY_BACKOFF      true
// حداکثر استپ اضافه‌ای که برای آزاد شدن سوئیچ، بک‌آف کشیده می‌شود
#define HOMING_BACKOFF_EXTRA_STEPS 400

// ============================================
// AXIS X (Joint 1)
// ============================================
#define AXIS_X_STEP_PIN     A0    // Digital 54
#define AXIS_X_DIR_PIN      A1    // Digital 55
#define AXIS_X_ENABLE_PIN   38
#define AXIS_X_ENDSTOP_PIN  3
// هر 4000 استپ = ۹۰ درجه  (200 * 16 * 5 / 360 = 44.44 استپ بر درجه)
#define AXIS_X_STEPS_PER_REV  200    // NEMA17 200 steps/rev
#define AXIS_X_MICROSTEP      16     // 1/16 microstepping
#define AXIS_X_GEAR_RATIO     5      // Gear ratio
#define AXIS_X_INVERT_DIR     true
#define AXIS_X_MAX_SPEED      2000   // steps/second  (= 45°/s)
// شتاب: با 700 قبلی، رمپ شتاب ۶۴ درجه طول می‌کشید! یعنی هیچ حرکتی
// هیچ‌وقت به سرعت بیشینه نمی‌رسید. مقدار زیر رمپ را به ~۷ درجه (۰.۳ ثانیه)
// می‌رساند. اگر موتور صدا داد یا استپ جا انداخت، همین عدد را کم کن.
#define AXIS_X_ACCELERATION   6000   // steps/s²
#define AXIS_X_HOMING_SPEED   900    // steps/s هنگام هوم (= 20°/s)
#define AXIS_X_BACKOFF        5200   // steps to back off after homing

// ============================================
// AXIS Y (Joint 2)
// ============================================
#define AXIS_Y_STEP_PIN     A6    // Digital 60
#define AXIS_Y_DIR_PIN      A7    // Digital 61
#define AXIS_Y_ENABLE_PIN   A2    // Digital 56
#define AXIS_Y_ENDSTOP_PIN  14
// هر 4800 استپ = ۹۰ درجه  (200 * 16 * 6 / 360 = 53.33 استپ بر درجه)
#define AXIS_Y_STEPS_PER_REV  200
#define AXIS_Y_MICROSTEP      16     // 1/16 microstepping
#define AXIS_Y_GEAR_RATIO     6
#define AXIS_Y_INVERT_DIR     true
#define AXIS_Y_MAX_SPEED      2000   // steps/second  (= 37.5°/s)
#define AXIS_Y_ACCELERATION   5000   // steps/s²  (رمپ ~۰.۳۳ ثانیه)
#define AXIS_Y_HOMING_SPEED   900    // steps/s
#define AXIS_Y_BACKOFF        300

// ============================================
// AXIS Z (Joint 3)
// ============================================
#define AXIS_Z_STEP_PIN     46
#define AXIS_Z_DIR_PIN      48
#define AXIS_Z_ENABLE_PIN   A8    // Digital 62
#define AXIS_Z_ENDSTOP_PIN  18
// هر 6400 استپ = ۹۰ درجه  (200 * 16 * 8 / 360 = 71.11 استپ بر درجه)
#define AXIS_Z_STEPS_PER_REV  200
#define AXIS_Z_MICROSTEP      16
#define AXIS_Z_GEAR_RATIO     8
#define AXIS_Z_INVERT_DIR     true
#define AXIS_Z_MAX_SPEED      1000   // steps/second  (= 14°/s)
#define AXIS_Z_ACCELERATION   3000   // steps/s²  (رمپ ~۰.۲۲ ثانیه)
#define AXIS_Z_HOMING_SPEED   600    // steps/s
#define AXIS_Z_BACKOFF        200

// ============================================
// AXIS A (Joint 4)
// ============================================
#define AXIS_A_STEP_PIN     26
#define AXIS_A_DIR_PIN      28
#define AXIS_A_ENABLE_PIN   24
#define AXIS_A_ENDSTOP_PIN  2
// هر 2400 استپ = ۹۰ درجه  (200 * 16 * 3 / 360 = 26.67 استپ بر درجه)
#define AXIS_A_STEPS_PER_REV  200
#define AXIS_A_MICROSTEP      16
#define AXIS_A_GEAR_RATIO     3
#define AXIS_A_INVERT_DIR     true
#define AXIS_A_MAX_SPEED      1000   // steps/second  (= 37.5°/s)
#define AXIS_A_ACCELERATION   4000   // steps/s²  (رمپ ~۰.۱۶ ثانیه)
#define AXIS_A_HOMING_SPEED   700    // steps/s
#define AXIS_A_BACKOFF        3000

// ============================================
// AXIS B (Joint 5)
// ============================================
#define AXIS_B_STEP_PIN     36
#define AXIS_B_DIR_PIN      34
#define AXIS_B_ENABLE_PIN   30
#define AXIS_B_ENDSTOP_PIN  15
// هر 2000 استپ = ۹۰ درجه  (200 * 16 * 2.5 / 360 = 22.22 استپ بر درجه)
#define AXIS_B_STEPS_PER_REV  200
#define AXIS_B_MICROSTEP      16
#define AXIS_B_GEAR_RATIO     2.5
#define AXIS_B_INVERT_DIR     true
#define AXIS_B_MAX_SPEED      1000   // steps/second  (= 45°/s)
#define AXIS_B_ACCELERATION   4000   // steps/s²  (رمپ ~۰.۱۶ ثانیه)
#define AXIS_B_HOMING_SPEED   700    // steps/s
#define AXIS_B_BACKOFF        200

// ============================================
// ROS Communication
// ============================================
#define ROS_BAUDRATE         57600

// Emergency Stop Pin (optional)
#define EMERGENCY_STOP_PIN   22

// ============================================
// Software Limits (in steps from home)
// ============================================
// فرمول: steps = degrees * (STEPS_PER_REV * MICROSTEP * GEAR_RATIO / 360)
#define AXIS_X_SOFT_MIN      -4888   // -110° × 44.44 (محور 1: +110/-110)
#define AXIS_X_SOFT_MAX       4888   // +110° × 44.44

#define AXIS_Y_SOFT_MIN          0   //   0° (محور 2: فقط مثبت)
#define AXIS_Y_SOFT_MAX       5333   // +100° × 53.33
// NOTE: قبلاً اینجا 8889 نوشته شده بود که معادل 166° می‌شد و با
//       53.33 استپ/درجه‌ی خود محور Y نمی‌خوند → محدوده‌ی نرم‌افزاری
//       عملاً باز بود و خطر برخورد داشت. اصلاح شد به 100° واقعی.

#define AXIS_Z_SOFT_MIN          0   //   0° (محور 3: فقط مثبت)
#define AXIS_Z_SOFT_MAX       3911   // +55° × 71.11

#define AXIS_A_SOFT_MIN      -2400   // -90° × 26.67 (محور 4)
#define AXIS_A_SOFT_MAX       2400   // +90° × 26.67

#define AXIS_B_SOFT_MIN      -2000   // -90° × 22.22 (محور 5)
#define AXIS_B_SOFT_MAX       2000   // +90° × 22.22

// ============================================
// DEBUG
// ============================================
#define DEBUG_SERIAL         false
#define DEBUG_ROS            false

#endif // CONFIG_H
