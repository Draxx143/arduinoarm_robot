// =====================================================================
//  شبیه‌ساز رفتاری فریم‌ور روی host.
//  کد واقعی Axis/MotorController اجرا می‌شود؛ تیک تایمر 20kHz مجازی است
//  و استپ‌ها مستقل از کد فریم‌ور، از روی پین STEP شمرده می‌شوند.
//
//  تمرکز این فایل: اولویت هومینگ (J1 -> J5)، بک‌آف اجباری و تأیید
//  آزاد شدن endstop، به‌علاوه‌ی صحت پروفایل سرعت/زمان‌بندی حرکت.
// =====================================================================
#include "Arduino.h"
#include "MotorController.h"
#include "SpeedProfile.h"

static const uint8_t STEP_PIN[NUM_AXES] = {
    AXIS_X_STEP_PIN, AXIS_Y_STEP_PIN, AXIS_Z_STEP_PIN,
    AXIS_A_STEP_PIN, AXIS_B_STEP_PIN
};
static const uint8_t ENDSTOP_PIN[NUM_AXES] = {
    AXIS_X_ENDSTOP_PIN, AXIS_Y_ENDSTOP_PIN, AXIS_Z_ENDSTOP_PIN,
    AXIS_A_ENDSTOP_PIN, AXIS_B_ENDSTOP_PIN
};
static const int32_t AXIS_BACKOFF[NUM_AXES] = {
    AXIS_X_BACKOFF, AXIS_Y_BACKOFF, AXIS_Z_BACKOFF, AXIS_A_BACKOFF, AXIS_B_BACKOFF
};

static const uint64_t TICK_US = 1000000ULL / STEP_TICK_FREQ;

// ================= اندازه‌گیری مستقل =================
static uint64_t g_steps[NUM_AXES];          // کل استپ‌های صادرشده
static uint64_t g_backoffSteps[NUM_AXES];   // استپ‌های فاز بک‌آف
static uint64_t g_searchSteps[NUM_AXES];    // استپ‌های فاز جست‌وجو
static uint64_t g_firstStepTick[NUM_AXES];  // اولین استپ هر محور (شماره تیک)
static uint64_t g_tick;                     // شماره‌ی تیک مجازی
static uint64_t g_pulseWithoutPin;          // tick() گفت استپ ولی پین بالا نرفت!

// مدل فیزیکی endstop: موقعیت (در دستگاه مختصات قبل از هوم) که سوئیچ در آن
// فشرده می‌شود. هارنس بعد از هر تیک پین را بر اساس موقعیت محور ست می‌کند.
static int32_t g_switchAt[NUM_AXES];
static bool    g_switchStuck[NUM_AXES];      // سوئیچ خراب: همیشه فشرده
static bool    g_switchBroken[NUM_AXES];     // سوئیچ خراب: هیچ‌وقت فشرده نمی‌شود
static bool    g_emulateEndstops = true;

static void resetCounters() {
    for (int i = 0; i < NUM_AXES; i++) {
        g_steps[i] = g_backoffSteps[i] = g_searchSteps[i] = 0;
        g_firstStepTick[i] = 0;
    }
    g_pulseWithoutPin = 0;
}

static void updateEndstopModel() {
    if (!g_emulateEndstops) return;
    for (int i = 0; i < NUM_AXES; i++) {
        if (g_switchBroken[i]) { sim_set_input(ENDSTOP_PIN[i], true); continue; }
        if (g_switchStuck[i])  { sim_set_input(ENDSTOP_PIN[i], false); continue; }
        int32_t pos = globalController->getAxis(i)->getCurrentPosition();
        // سوئیچ در g_switchAt فشرده می‌شود (حرکت هوم به سمت منفی است)
        bool pressed = (pos <= g_switchAt[i]);
        sim_set_input(ENDSTOP_PIN[i], !pressed);
    }
}

// یک تیک ISR — دقیقاً کاری که MotorController::update() با محورها می‌کند،
// ولی با شمارش مستقل استپ‌ها از روی پین STEP.
static void isr_tick() {
    g_tick++;
    for (int i = 0; i < NUM_AXES; i++) {
        Axis* a = globalController->getAxis(i);
        if (a->tick()) {
            // بررسی مستقل: پین STEP باید همین حالا بالا رفته باشد
            if (sim_read_output(STEP_PIN[i])) {
                g_steps[i]++;
                if (g_firstStepTick[i] == 0) g_firstStepTick[i] = g_tick;
                uint8_t st = a->homeState();
                if (st == HOME_BACKOFF) g_backoffSteps[i]++;
                else if (st == HOME_SEARCH || st == HOME_RELEASE) g_searchSteps[i]++;
            } else {
                g_pulseWithoutPin++;
            }
            a->endPulse();
        }
    }
    updateEndstopModel();
    sim_micros += TICK_US;
}

static void runTicks(uint64_t n) { for (uint64_t i = 0; i < n; i++) isr_tick(); }

// اجرای حلقه‌ی اصلی (همان کاری که loop() می‌کند) همراه با تیک‌ها
static void runFor(double seconds) {
    uint64_t n = (uint64_t)(seconds * (double)STEP_TICK_FREQ);
    for (uint64_t i = 0; i < n; i++) {
        isr_tick();
        if ((i % (STEP_TICK_FREQ / 100)) == 0) globalController->processHoming();
    }
    globalController->processHoming();
}

static double elapsed() { return (double)g_tick / (double)STEP_TICK_FREQ; }

// ================= ابزار گزارش =================
static int g_pass = 0, g_fail = 0;
static void check(bool ok, const char* what) {
    if (ok) { g_pass++; printf("   [PASS] %s\n", what); }
    else    { g_fail++; printf("   [FAIL] %s\n", what); }
}
static void header(const char* t) {
    printf("\n================ %s ================\n", t);
}

// شروع fresh: همه‌چیز ریست
static void freshStart() {
    sim_reset_pins();
    sim_micros = 0;
    g_tick = 0;
    resetCounters();
    for (int i = 0; i < NUM_AXES; i++) {
        g_switchStuck[i] = false;
        g_switchBroken[i] = false;
        g_switchAt[i] = -2000 - 300 * i;   // هر سوئیچ در فاصله‌ی متفاوت
    }
    g_emulateEndstops = true;

    MotorController* mc = new MotorController();
    mc->init();
    mc->enableAllMotors();
    mc->clearEmergencyStop();
    // همه‌ی endstop ها آزاد
    for (int i = 0; i < NUM_AXES; i++) sim_set_input(ENDSTOP_PIN[i], true);
    runTicks(200);
    resetCounters();
}

// ترتیبی که محورها هوم شدن را تمام کردند
static int      g_doneOrder[NUM_AXES];
static int      g_doneCount = 0;
static double   g_doneTime[NUM_AXES];
static bool     g_wasHomed[NUM_AXES];

static void watchHomingOrder() {
    for (int i = 0; i < NUM_AXES; i++) {
        bool h = globalController->getAxis(i)->isHomed();
        if (h && !g_wasHomed[i]) {
            g_wasHomed[i] = true;
            if (g_doneCount < NUM_AXES) {
                g_doneOrder[g_doneCount] = i;
                g_doneTime[g_doneCount] = elapsed();
                g_doneCount++;
            }
        }
        if (!h) g_wasHomed[i] = false;
    }
}

// هومینگ کامل با ثبت ترتیب
static void runHomingWithOrder(double maxSeconds = 200.0) {
    g_doneCount = 0;
    for (int i = 0; i < NUM_AXES; i++) g_wasHomed[i] = false;
    globalController->smartHoming();
    uint64_t n = (uint64_t)(maxSeconds * (double)STEP_TICK_FREQ);
    for (uint64_t i = 0; i < n; i++) {
        isr_tick();
        if ((i % (STEP_TICK_FREQ / 100)) == 0) {
            globalController->processHoming();
            watchHomingOrder();
        }
        if (g_doneCount >= NUM_AXES) break;
        if (!globalController->isHoming() && i > 1000) break;
    }
    globalController->processHoming();
    watchHomingOrder();
}

// =====================================================================
int main() {
    printf("################################################################\n");
    printf("#  شبیه‌ساز فریم‌ور — اولویت هومینگ + بک‌آف اجباری + حرکت\n");
    printf("#  تیک مجازی: %u Hz   (%llu us)\n", (unsigned)STEP_TICK_FREQ, (unsigned long long)TICK_US);
    printf("################################################################\n");

    // ------------------------------------------------------------------
    header("تست ۱: ترتیب اولویت هومینگ = جوینت ۱، ۲، ۳، ۴، ۵");
    // ------------------------------------------------------------------
    freshStart();
    printf("   ترتیب پیکربندی‌شده: ");
    globalController->printHomingOrder();

    runHomingWithOrder();

    printf("   ترتیب واقعی تمام شدن هومینگ: ");
    for (int i = 0; i < g_doneCount; i++) {
        if (i) printf(" -> ");
        printf("J%d(%.1fs)", g_doneOrder[i] + 1, g_doneTime[i]);
    }
    printf("\n   زمان کل: %.2f ثانیه\n", elapsed());

    check(g_doneCount == NUM_AXES, "هر ۵ جوینت هوم شدند");
    bool orderOK = (g_doneCount == NUM_AXES);
    for (int i = 0; i < g_doneCount && orderOK; i++) if (g_doneOrder[i] != i) orderOK = false;
    check(orderOK, "ترتیب دقیقاً J1 -> J2 -> J3 -> J4 -> J5 است");

    // ترتیب شروع: اولین استپ هر محور باید به همان ترتیب باشد
    bool startOrderOK = true;
    for (int i = 1; i < NUM_AXES; i++) {
        if (g_firstStepTick[i] != 0 && g_firstStepTick[i] < g_firstStepTick[i-1]) startOrderOK = false;
    }
    printf("   اولین استپ هر محور در تیک: ");
    for (int i = 0; i < NUM_AXES; i++) printf("J%d=%llu ", i + 1, (unsigned long long)g_firstStepTick[i]);
    printf("\n");
    check(startOrderOK, "محورها به‌ترتیب اولویت شروع به حرکت کردند (نه هم‌زمان)");

    // ------------------------------------------------------------------
    header("تست ۲: بک‌آف اجباری برای هر محور + تأیید آزاد شدن endstop");
    // ------------------------------------------------------------------
    bool allBackoff = true, allVerified = true, enoughSteps = true;
    for (int i = 0; i < NUM_AXES; i++) {
        Axis* a = globalController->getAxis(i);
        printf("   J%d: استپ جست‌وجو=%llu  استپ بک‌آف=%llu  (حداقل لازم=%d)  "
               "backoffDone=%d  endstop آزاد=%d  موقعیت=%d\n",
               i + 1,
               (unsigned long long)g_searchSteps[i],
               (unsigned long long)g_backoffSteps[i],
               (int)abs(AXIS_BACKOFF[i]),
               (int)a->backoffDone(),
               (int)!a->endstopPressed(),
               (int)a->getCurrentPosition());
        if (g_backoffSteps[i] == 0) allBackoff = false;
        if (!a->backoffDone()) allVerified = false;
        if ((int32_t)g_backoffSteps[i] < abs(AXIS_BACKOFF[i])) enoughSteps = false;
    }
    check(allBackoff,   "هیچ محوری بدون بک‌آف صفر نشد");
    check(enoughSteps,  "بک‌آف هر محور حداقل به اندازه‌ی BACKOFF پیکربندی‌شده بود");
    check(allVerified,  "آزاد شدن endstop بعد از بک‌آف برای همه تأیید شد");

    bool endsReleased = true;
    for (int i = 0; i < NUM_AXES; i++)
        if (globalController->getAxis(i)->endstopPressed()) endsReleased = false;
    check(endsReleased, "در پایان هومینگ هیچ endstop ای فشرده نیست");

    bool posZero = true;
    for (int i = 0; i < NUM_AXES; i++)
        if (globalController->getAxis(i)->getCurrentPosition() != 0) posZero = false;
    check(posZero, "موقعیت همه‌ی محورها صفر شد");
    check(g_pulseWithoutPin == 0, "هر پالسی که tick() اعلام کرد واقعاً روی پین STEP رفت");

    // ------------------------------------------------------------------
    header("تست ۳: سوئیچ چسبیده حین بک‌آف -> هومینگ باید خطا بدهد");
    // ------------------------------------------------------------------
    freshStart();
    for (int i = 0; i < NUM_AXES; i++) g_switchStuck[i] = true;   // همیشه فشرده
    g_emulateEndstops = true;
    globalController->smartHoming();
    runFor(30.0);

    Axis* a0 = globalController->getAxis(0);
    printf("   J1: homed=%d  failed=%d  faultCode=%d (باید %d=BACKOFF_STUCK باشد)\n",
           (int)a0->isHomed(), (int)a0->homingFailed(),
           (int)a0->homingFaultCode(), (int)HOME_FAULT_BACKOFF_STUCK);
    check(a0->homingFailed(), "هومینگ با سوئیچ چسبیده شکست خورد (بی‌سروصدا صفر نشد)");
    check(!a0->isHomed(), "محور «هوم‌شده» علامت نخورد");
    check(!a0->backoffDone(), "بک‌آف تأیید‌شده ثبت نشد");
    check(a0->homingFaultCode() == HOME_FAULT_BACKOFF_STUCK, "کد خطا = BACKOFF_STUCK");
    check(!globalController->isHoming(), "توالی هومینگ متوقف شد (بی‌نهایت ادامه نیافت)");

    // ------------------------------------------------------------------
    header("تست ۴: endstop قطع/پیدا نشد -> NOT_FOUND");
    // ------------------------------------------------------------------
    freshStart();
    for (int i = 0; i < NUM_AXES; i++) g_switchBroken[i] = true;  // هیچ‌وقت فشرده نمی‌شود
    globalController->smartHoming();
    runFor(120.0);
    Axis* b0 = globalController->getAxis(0);
    printf("   J1: failed=%d faultCode=%d (باید %d=NOT_FOUND)  استپ جست‌وجو=%llu\n",
           (int)b0->homingFailed(), (int)b0->homingFaultCode(),
           (int)HOME_FAULT_NOT_FOUND, (unsigned long long)g_searchSteps[0]);
    check(b0->homingFailed(), "هومینگ با endstop خراب شکست خورد");
    check(b0->homingFaultCode() == HOME_FAULT_NOT_FOUND, "کد خطا = NOT_FOUND");
    check(!b0->isHomed(), "محور هوم‌شده علامت نخورد");

    // ------------------------------------------------------------------
    header("تست ۵: home دوباره روی محورهای قبلاً هوم‌شده (هومینگ اجباری)");
    // ------------------------------------------------------------------
    freshStart();
    runHomingWithOrder();
    double t1 = elapsed();
    check(g_doneCount == NUM_AXES, "هومینگ اول کامل شد");

    // بار دوم: باید دوباره همه از اول و به همان ترتیب هوم شوند
    resetCounters();
    runHomingWithOrder();
    printf("   هومینگ دوم: %d جوینت، %.2f ثانیه، ترتیب: ", g_doneCount, elapsed() - t1);
    for (int i = 0; i < g_doneCount; i++) printf("J%d ", g_doneOrder[i] + 1);
    printf("\n");
    check(g_doneCount == NUM_AXES, "home دوباره همه‌ی جوینت‌ها را هوم کرد (رد نکرد)");
    bool order2 = (g_doneCount == NUM_AXES);
    for (int i = 0; i < g_doneCount && order2; i++) if (g_doneOrder[i] != i) order2 = false;
    check(order2, "ترتیب در هومینگ دوم هم J1 -> J5 بود");
    bool bo2 = true;
    for (int i = 0; i < NUM_AXES; i++) if (g_backoffSteps[i] == 0) bo2 = false;
    check(bo2, "در هومینگ دوم هم بک‌آف برای همه انجام شد");

    // ------------------------------------------------------------------
    header("تست ۶: تغییر ترتیب در زمان اجرا (homeorder 3 2 1 4 5)");
    // ------------------------------------------------------------------
    freshStart();
    uint8_t custom[NUM_AXES] = {2, 1, 0, 3, 4};
    bool accepted = globalController->setHomingOrder(custom, NUM_AXES);
    check(accepted, "ترتیب سفارشی پذیرفته شد");
    printf("   ترتیب جدید: ");
    globalController->printHomingOrder();

    runHomingWithOrder();
    printf("   ترتیب واقعی: ");
    for (int i = 0; i < g_doneCount; i++) printf("J%d ", g_doneOrder[i] + 1);
    printf("\n");
    bool orderCustom = (g_doneCount == NUM_AXES);
    const uint8_t* ord = globalController->getHomingOrder();
    for (int i = 0; i < g_doneCount && orderCustom; i++)
        if (g_doneOrder[i] != ord[i]) orderCustom = false;
    check(orderCustom, "ترتیب اجرا مطابق ترتیب تنظیم‌شده بود (J3 -> J2 -> J1 -> J4 -> J5)");

    // ترتیب نامعتبر باید رد شود
    uint8_t bad1[NUM_AXES] = {0, 0, 1, 2, 3};        // تکراری
    uint8_t bad2[NUM_AXES] = {0, 1, 2, 3, 9};        // خارج از محدوده
    check(!globalController->setHomingOrder(bad1, NUM_AXES), "ترتیب با جوینت تکراری رد شد");
    check(!globalController->setHomingOrder(bad2, NUM_AXES), "ترتیب با جوینت نامعتبر رد شد");
    check(globalController->getHomingOrder()[0] == 2, "ترتیب معتبر قبلی دست‌نخورده ماند");

    // ------------------------------------------------------------------
    header("تست ۷: هوم وقتی endstop از قبل فشرده است (آزادسازی خودکار)");
    // ------------------------------------------------------------------
    freshStart();
    // محور 1 را جایی می‌گذاریم که سوئیچش فشرده باشد
    for (int i = 0; i < NUM_AXES; i++) g_switchAt[i] = 0;   // سوئیچ دقیقاً در موقعیت ۰
    updateEndstopModel();
    bool anyPressed = globalController->getAxis(0)->endstopPressed();
    printf("   قبل از هوم: endstop J1 فشرده=%d\n", (int)anyPressed);
    runHomingWithOrder();
    check(g_doneCount == NUM_AXES, "با endstop فشرده هم هومینگ کامل شد");
    bool allbo = true;
    for (int i = 0; i < NUM_AXES; i++) if (!globalController->getAxis(i)->backoffDone()) allbo = false;
    check(allbo, "بک‌آف برای همه تأیید شد");

    // ------------------------------------------------------------------
    header("تست ۸: دقت پروفایل حرکت (ذوزنقه‌ای بلند)");
    // ------------------------------------------------------------------
    freshStart();
    for (int i = 0; i < NUM_AXES; i++) g_switchAt[i] = -2000 - 300 * i;
    runHomingWithOrder();

    Axis* ax = globalController->getAxis(0);
    const int32_t TARGET = 4888;
    double t0 = elapsed();
    ax->moveTo(TARGET);
    uint64_t peak = 0;
    while (ax->isMoving() && (elapsed() - t0) < 30.0) {
        isr_tick();
        uint32_t sp = ax->getCurrentSpeed();
        if (sp > peak) peak = sp;
    }
    double dt = elapsed() - t0;
    // تئوری مطابق پروفایل واقعی فریم‌ور: رمپ‌ها تا RAMP_MIN_SPEED پایین
    // می‌آیند (نه تا صفر)، پس مسافت رمپ = (v^2 - vmin^2)/(2a) است.
    double v    = (double)ax->getMaxSpeed();
    double acc  = (double)ax->getAcceleration();
    double vmin = (double)RAMP_MIN_SPEED;
    double rampSteps = (v * v - vmin * vmin) / (2.0 * acc);
    double theory = ((double)TARGET - 2.0 * rampSteps) / v + 2.0 * (v - vmin) / acc;
    printf("   مسافت=%d  زمان=%.3f s  تئوری=%.3f s  خطا=%.1f%%  اوج سرعت=%llu (MAX=%u)  رمپ=%d استپ\n",
           (int)TARGET, dt, theory, 100.0 * fabs(dt - theory) / theory,
           (unsigned long long)peak, (unsigned)ax->getMaxSpeed(), (int)rampSteps);
    check(ax->getCurrentPosition() == TARGET, "دقیقاً به هدف رسید");
    check(fabs(dt - theory) / theory < 0.02, "زمان حرکت با تئوری زیر ۲٪ اختلاف دارد");
    check(peak >= (uint64_t)(v * 0.98) && peak <= (uint64_t)(v * 1.05),
          "به سرعت بیشینه‌ی پیکربندی‌شده رسید");

    // ------------------------------------------------------------------
    header("تست ۹: سقف سرعت — MAX_SPEED واقعاً اعمال می‌شود");
    // ------------------------------------------------------------------
    freshStart();
    for (int i = 0; i < NUM_AXES; i++) g_switchAt[i] = -2000 - 300 * i;
    runHomingWithOrder();
    Axis* ax2 = globalController->getAxis(0);
    const uint32_t SPEEDS[] = {1000, 2000, 4000, 8000};
    for (int k = 0; k < 4; k++) {
        globalController->setAxisSpeed(0, SPEEDS[k]);
        globalController->setAxisAcceleration(0, SPEEDS[k] * 2);
        int32_t from = (k % 2) ? 1999 : 0, to = (k % 2) ? 0 : 1999;
        double s0 = elapsed();
        ax2->moveTo(to);
        uint64_t pk = 0;
        while (ax2->isMoving() && (elapsed() - s0) < 30.0) {
            isr_tick();
            uint32_t sp = ax2->getCurrentSpeed();
            if (sp > pk) pk = sp;
        }
        (void)from;
        // اوج قابل دستیابی: برای مسیر کوتاه، پروفایل مثلثی است و هیچ‌وقت
        // به MAX_SPEED نمی‌رسد. ضمن اینکه تیک 20kHz سرعت را گسسته می‌کند:
        // تنها سرعت‌های 20000/t ممکن‌اند.
        double accd  = (double)(SPEEDS[k] * 2);
        double dist  = 1999.0;
        double ideal = (double)SPEEDS[k];
        double vtri  = sqrt(accd * dist);            // اوج مثلثی (تقریبی)
        if (vtri < ideal) ideal = vtri;
        uint32_t tt  = (uint32_t)ceil((double)STEP_TICK_FREQ / ideal);
        double achievable = (double)STEP_TICK_FREQ / (double)tt;

        printf("   MAX_SPEED=%5u ACCEL=%6u -> زمان=%.3f s  اوج=%llu steps/s"
               "  (ایده‌آل=%.0f  قابل‌دستیابی=%.0f)\n",
               (unsigned)SPEEDS[k], (unsigned)(SPEEDS[k] * 2), elapsed() - s0,
               (unsigned long long)pk, ideal, achievable);

        // ایمنی: هرگز سریع‌تر از سقف تنظیم‌شده نباشد
        check(pk <= (uint64_t)SPEEDS[k], "از سقف تنظیم‌شده سریع‌تر نرفت (ایمنی)");
        check(pk >= (uint64_t)(achievable * 0.97), "به سرعت قابل‌دستیابی رسید");
        check(ax2->getCurrentPosition() == to, "به هدف رسید");
    }

    // ------------------------------------------------------------------
    header("تست ۱۰: توقف اضطراری وسط حرکت");
    // ------------------------------------------------------------------
    globalController->clearEmergencyStop();
    Axis* ax3 = globalController->getAxis(0);
    int32_t estopTarget = ax3->getSoftMax() - 500;   // داخل محدوده‌ی مجاز
    ax3->moveTo(estopTarget);
    runTicks(4000);                      // کمی حرکت کند
    check(ax3->getCurrentPosition() != 0, "حرکت واقعاً شروع شد (وگرنه تست بی‌معنی است)");
    int32_t posAtEstop = ax3->getCurrentPosition();
    globalController->emergencyStop();
    runTicks(2000);
    printf("   موقعیت هنگام استپ=%d  بعد از ۰.۱ ثانیه=%d  estop=%d\n",
           (int)posAtEstop, (int)ax3->getCurrentPosition(),
           (int)globalController->emergencyStopActive());
    check(ax3->getCurrentPosition() == posAtEstop, "بلافاصله متوقف شد");
    check(!ax3->isMoving(), "حرکت متوقف علامت خورد");
    globalController->clearEmergencyStop();

    // ------------------------------------------------------------------
    header("تست ۱۱: soft limit — هدف خارج از محدوده رد می‌شود");
    // ------------------------------------------------------------------
    Axis* ax4 = globalController->getAxis(0);
    int32_t before = ax4->getCurrentPosition();
    ax4->moveTo(ax4->getSoftMax() + 5000);
    runTicks(1000);
    check(ax4->getCurrentPosition() == before, "حرکت خارج از محدوده رد شد");

    // ------------------------------------------------------------------
    header("تست ۱۲: retarget وسط حرکت (بدون ریست رمپ)");
    // ------------------------------------------------------------------
    freshStart();
    for (int i = 0; i < NUM_AXES; i++) g_switchAt[i] = -2000 - 300 * i;
    runHomingWithOrder();
    Axis* ax5 = globalController->getAxis(0);
    int32_t first  = ax5->getSoftMax() / 2;          // ~2444
    int32_t second = ax5->getSoftMax() - 200;        // ~4688
    ax5->moveTo(first);
    runTicks(20000);                     // وارد فاز cruise شود
    uint32_t spBefore = ax5->getCurrentSpeed();
    int32_t posAtRetarget = ax5->getCurrentPosition();
    ax5->moveTo(second);                 // تغییر هدف وسط حرکت
    runTicks(200);
    uint32_t spAfter = ax5->getCurrentSpeed();
    printf("   موقعیت هنگام retarget=%d  هدف اول=%d  هدف دوم=%d  سرعت قبل=%u بعد=%u\n",
           (int)posAtRetarget, (int)first, (int)second, (unsigned)spBefore, (unsigned)spAfter);
    check(posAtRetarget > 0 && posAtRetarget < first, "وسط حرکت بود (نه قبل و نه بعد از آن)");
    check(spAfter >= spBefore * 0.9, "سرعت حفظ شد (رمپ از نو شروع نشد)");
    while (ax5->isMoving() && elapsed() < 200.0) isr_tick();
    printf("   موقعیت نهایی=%d\n", (int)ax5->getCurrentPosition());
    check(ax5->getCurrentPosition() == second, "به هدف جدید رسید");

    // ------------------------------------------------------------------
    header("تست ۱۳: هومینگ وسط حرکت (حرکت قبلی تمیز متوقف می‌شود)");
    // ------------------------------------------------------------------
    freshStart();
    for (int i = 0; i < NUM_AXES; i++) g_switchAt[i] = -2000 - 300 * i;
    Axis* ax6 = globalController->getAxis(0);
    ax6->moveTo(3000);                   // داخل soft limit محور X (=4888)
    runTicks(2000);
    printf("   وسط حرکت (موقعیت=%d) دستور home داده می‌شود\n", (int)ax6->getCurrentPosition());
    runHomingWithOrder();
    check(g_doneCount == NUM_AXES, "هومینگ با وجود حرکت در جریان کامل شد");
    check(globalController->getAxis(0)->getCurrentPosition() == 0, "موقعیت J1 صفر شد");

    // ------------------------------------------------------------------
    header("تست ۱۴: پروفایل‌های سرعت (slow / normal / fast)");
    // ------------------------------------------------------------------
    freshStart();
    for (int i = 0; i < NUM_AXES; i++) g_switchAt[i] = -2000 - 300 * i;
    runHomingWithOrder();

    SpeedProfileManager spm;
    spm.attach(globalController);
    Axis* axp = globalController->getAxis(0);
    const SpeedProfile PROFS[3] = { PROFILE_SLOW, PROFILE_NORMAL, PROFILE_FAST };
    const char* NAMES[3] = { "slow", "normal", "fast" };
    double profTime[3] = {0, 0, 0};

    for (int k = 0; k < 3; k++) {
        spm.setProfile(PROFS[k]);
        int32_t from = (k % 2) ? 1999 : 0;
        int32_t to   = (k % 2) ? 0 : 1999;
        if (axp->getCurrentPosition() != from) {
            axp->moveTo(from);
            while (axp->isMoving() && elapsed() < 200.0) isr_tick();
        }
        double t0 = elapsed();
        axp->moveTo(to);
        uint64_t pk = 0;
        while (axp->isMoving() && elapsed() < 200.0) {
            isr_tick();
            uint32_t sp = axp->getCurrentSpeed();
            if (sp > pk) pk = sp;
        }
        profTime[k] = elapsed() - t0;
        printf("   profile %-7s -> MAX مؤثر=%5u steps/s  زمان=%.3f s  اوج=%llu\n",
               NAMES[k], (unsigned)axp->getMaxSpeed(), profTime[k],
               (unsigned long long)pk);
        check(pk <= (uint64_t)axp->getMaxSpeed(), "از سقف پروفایل سریع‌تر نرفت");
        check(axp->getCurrentPosition() == to, "به هدف رسید");
    }
    check(profTime[0] > profTime[1] && profTime[1] > profTime[2],
          "slow کندتر از normal و normal کندتر از fast است");

    // ------------------------------------------------------------------
    printf("\n################################################################\n");
    printf("#  نتیجه: %d PASS / %d FAIL\n", g_pass, g_fail);
    printf("################################################################\n");
    return g_fail ? 1 : 0;
}
