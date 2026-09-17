// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
// https://github.com/Draxx143/arduinoarm_robot
#include "Gripper.h"
#include <math.h>

// ---------------------------------------------------------------------
// درایور پالس سروو — تایمر ۵، دو compare (جایگزین کتابخانه‌ی Servo)
//
// چرا کتابخانه‌ی استاندارد نه: Servo آردوینو روی Mega وکتورهای COMPA هر
// چهار تایمر ۱۶ بیتی (از جمله تایمر ۱) را تعریف می‌کند و با موتور حرکت
// که روی TIMER1_COMPA سوار است لینک نمی‌شود:
//     multiple definition of `__vector_17'
// این درایور فقط تایمر ۵ را می‌گیرد که هیچ مصرف‌کننده‌ی دیگری ندارد.
//
// زمان‌بندی: کلاک 16MHz با prescaler=8 می‌شود 2MHz (هر تیک = 0.5µs).
// حالت CTC با TOP = فریم-۱؛ طول فریم از GRIP_REFRESH_HZ می‌آید
// (۵۰Hz → فریم 20ms = چهل‌هزار تیک).
//   COMPA (سر فریم): پین HIGH + مسلح کردن COMPB با پهنای پالس
//   COMPB (پایان پالس): پین LOW
// پالس ۵۰۰..۲۵۰۰µs می‌شود ۱۰۰۰..۵۰۰۰ تیک — تفکیک ۰.۵µs (۰.۰۴۵ درجه).
//
// همین کد روی host هم کامپایل می‌شود (رجیسترها استاب‌اند و ISRها به
// تابع بدل تبدیل می‌شوند) تا منطق حرکت و نگاشت واحدتست شود.
// ---------------------------------------------------------------------

// طول فریم به تیک (۰.۵µs) — با نگهبان برای مقدارهای نامعتبر کانفیگ
static const unsigned long SERVO_FRAME_TICKS =
    (GRIP_REFRESH_HZ >= 20) ? (2000000UL / (unsigned long)GRIP_REFRESH_HZ)
                            : 40000UL;
// سقف پهنای پالس: دست‌کم ۱۰۰µs از فریم برای سطح LOW بماند
static const unsigned long SERVO_MAX_PULSE_TICKS = 40000UL - 200UL;

static volatile bool     servoRunning = false;
static volatile uint16_t servoPulseTicks = 3000;   // 1500µs وسط

ISR(TIMER5_COMPA_vect) {
    if (!servoRunning) return;
    digitalWrite(GRIP_PIN, HIGH);
    OCR5B = servoPulseTicks;
}

ISR(TIMER5_COMPB_vect) {
    digitalWrite(GRIP_PIN, LOW);
}

static void servoHwAttach() {
    pinMode(GRIP_PIN, OUTPUT);
    digitalWrite(GRIP_PIN, LOW);
    TCCR5A = 0;
    TCCR5B = 0;
    TCNT5  = 0;
    OCR5A  = (uint16_t)(SERVO_FRAME_TICKS - 1);
    OCR5B  = servoPulseTicks;
    TIFR5  = (1 << OCF5A) | (1 << OCF5B);   // پاک کردن فلگ‌های معوق
    TCCR5B |= (1 << WGM52);                 // CTC، سقف = OCR5A
    TCCR5B |= (1 << CS51);                  // prescaler = 8
    TIMSK5 |= (1 << OCIE5A) | (1 << OCIE5B);
    servoRunning = true;
}

static void servoHwDetach() {
    servoRunning = false;
    TIMSK5 &= ~((1 << OCIE5A) | (1 << OCIE5B));
    TCCR5B = 0;                             // توقف کلاک تایمر
    digitalWrite(GRIP_PIN, LOW);
}

static void servoHwWrite(int pulseUs) {
    unsigned long ticks = (unsigned long)pulseUs * 2UL;   // هر تیک = 0.5µs
    if (ticks < 200UL) ticks = 200UL;                     // کف ۱۰۰µs
    if (ticks > SERVO_MAX_PULSE_TICKS) ticks = SERVO_MAX_PULSE_TICKS;
    // نوشتن اتمیک: خواننده (ISR) نباید مقدار نصفه ببیند
    uint8_t sreg = SREG;
    cli();
    servoPulseTicks = (uint16_t)ticks;
    SREG = sreg;
}

// ---------------------------------------------------------------------

Gripper::Gripper()
    : _attached(false)
    , _hwOn(false)
    , _booted(false)
    , _current(GRIP_DEFAULT_DEG)
    , _target(GRIP_DEFAULT_DEG)
    , _vel(0.0f)
    , _lastPulseUs(-1)
    , _lastUpdate(0)
    , _attachAt(0)
    , _idleSince(0)
    , _estop(false)
{
}

float Gripper::clampDeg(float d) {
    if (d < GRIP_MIN_DEG) return GRIP_MIN_DEG;
    if (d > GRIP_MAX_DEG) return GRIP_MAX_DEG;
    return d;
}

int Gripper::degreesToMicros(float degrees) {
    float d = clampDeg(degrees);
    if (GRIP_INVERT) d = GRIP_MIN_DEG + GRIP_MAX_DEG - d;
    float spanDeg = GRIP_MAX_DEG - GRIP_MIN_DEG;
    if (spanDeg <= 0.0f) return (GRIP_MIN_US + GRIP_MAX_US) / 2;
    float f = (d - GRIP_MIN_DEG) / spanDeg;
    return GRIP_MIN_US + (int)(f * (float)(GRIP_MAX_US - GRIP_MIN_US) + 0.5f);
}

// سرعت پایه‌ی یک حرکت: اگر به‌سمت «بسته» می‌رویم و برای بستن سرعت
// جداگانه‌ای داده شده، همان؛ وگرنه سرعت پایه.
float Gripper::baseSpeedForMove(float from, float to) {
    if (GRIP_CLOSE_SPEED_DEG_S <= 0.0f) return GRIP_SPEED_DEG_S;
    // فاصله‌ی مقصد تا «بسته» کمتر از فاصله‌ی مبدأ است؟ یعنی به‌سمت بستن.
    float aTo = (to - GRIP_CLOSE_DEG) >= 0.0f ? (to - GRIP_CLOSE_DEG)
                                              : (GRIP_CLOSE_DEG - to);
    float aFrom = (from - GRIP_CLOSE_DEG) >= 0.0f ? (from - GRIP_CLOSE_DEG)
                                                  : (GRIP_CLOSE_DEG - from);
    if (aTo < aFrom) return GRIP_CLOSE_SPEED_DEG_S;
    return GRIP_SPEED_DEG_S;
}

void Gripper::begin() {
    _current = clampDeg(GRIP_DEFAULT_DEG);
    _target = _current;
    _vel = 0.0f;
    _lastUpdate = millis();
    attach();
}

void Gripper::hwOn() {
    if (_hwOn) return;
    servoHwAttach();
    _hwOn = true;
    _lastPulseUs = -1;   // وادار به نوشتن دوباره
    applyPulse();
}

void Gripper::hwOff() {
    if (!_hwOn) return;
    servoHwDetach();
    _hwOn = false;
}

void Gripper::attach() {
    _attached = true;
    _booted = false;             // فاز بوت از نو (BOOT_DELAY دوباره اعمال شود)
    _attachAt = millis();
    _idleSince = _attachAt;
    _lastUpdate = _attachAt;
    // پالس را update() بعد از BOOT_DELAY روشن می‌کند (اگر صفر باشد بی‌درنگ)
}

void Gripper::detach() {
    _attached = false;
    hwOff();
    _target = _current;      // بعد از آزاد شدن، هدفی باقی نماند
    _vel = 0.0f;
}

bool Gripper::isAttached() const {
    return _attached;
}

bool Gripper::isPulseActive() const {
    return _attached && _hwOn;
}

void Gripper::moveTo(float degrees) {
    if (_estop) return;
    if (!_attached) return;
    _target = clampDeg(degrees);
    _idleSince = millis();
    // بیدار کردن پالس اگر در خواب بیکاری است (ولی احترام به BOOT_DELAY)
    if (!_hwOn) {
#if GRIP_BOOT_DELAY_MS > 0
        if (millis() - _attachAt >= (unsigned long)GRIP_BOOT_DELAY_MS) hwOn();
#else
        hwOn();
#endif
    }
}

void Gripper::open() {
    moveTo(GRIP_OPEN_DEG);
}

void Gripper::close() {
    moveTo(GRIP_CLOSE_DEG);
}

void Gripper::stop() {
    _target = _current;
    _vel = 0.0f;
    _idleSince = millis();
}

void Gripper::emergencyStop() {
    _estop = true;
    _target = _current;      // درجا بایست؛ پالس همچنان می‌ماند تا
    _vel = 0.0f;             // اگر چیزی گرفته، رها نکند
}

void Gripper::clearEmergencyStop() {
    _estop = false;
    _idleSince = millis();   // ساعت بیکاری از نو (آزادسازی ناگهانی نشود)
}

bool Gripper::emergencyStopActive() const {
    return _estop;
}

float Gripper::getCurrentDegrees() const {
    return _current;
}

float Gripper::getTargetDegrees() const {
    return _target;
}

float Gripper::getVelocityDegS() const {
    return _vel;
}

int Gripper::getLastPulseUs() const {
    return _lastPulseUs;
}

bool Gripper::isMoving() const {
    return _target != _current;
}

void Gripper::applyPulse() {
    if (!_attached || !_hwOn) return;
    int us = degreesToMicros(_current) + GRIP_TRIM_US;
    if (_lastPulseUs >= 0) {
        int diff = us - _lastPulseUs;
        if (diff < 0) diff = -diff;
        if (diff < GRIP_DEADBAND_US) return;   // تغییر ناچیز: ولش کن
    }
    servoHwWrite(us);
    _lastPulseUs = us;
}

void Gripper::update() {
    if (!_attached) {
        _lastUpdate = millis();
        return;
    }
    unsigned long now = millis();
    // تأخیر بوت: فقط یک بار بعد از attach — پالس دیرتر شروع می‌شود تا
    // تغذیه پایدار شود. بعد از قطعِ بیکاری (IDLE_RELEASE) خودبه‌خود
    // برنمی‌گردد؛ فقط فرمان تازه (moveTo) بیدارش می‌کند.
    if (!_hwOn && !_booted) {
#if GRIP_BOOT_DELAY_MS > 0
        if (now - _attachAt < (unsigned long)GRIP_BOOT_DELAY_MS) {
            _lastUpdate = now;
            return;
        }
#endif
        hwOn();
        _booted = true;
        _idleSince = now;
    }

    if (_target != _current && !_estop) {
        unsigned long dt = now - _lastUpdate;
        _lastUpdate = now;
        if (dt > 0) {
            if (dt > 500) dt = 500;  // پرش زمانی بزرگ = یک قدم معقول
            float dtS = (float)dt / 1000.0f;
            float diff = _target - _current;
            float dir = (diff > 0.0f) ? 1.0f : -1.0f;
            float adiff = (diff >= 0.0f) ? diff : -diff;
            float vmax = baseSpeedForMove(_current, _target);
            if (GRIP_ACCEL_DEG_S2 > 0.0f) {
                // رمپ ذوزنقه‌ای: شتاب گرفتن به‌سمت vmax و ترمز روی منحنی
                // v²=2·a·d تا دقیقاً سر هدف بایستد (بدون رد شدن).
                float accel = GRIP_ACCEL_DEG_S2;
                float vAllow = sqrtf(2.0f * accel * adiff);
                float want = dir * (vmax < vAllow ? vmax : vAllow);
                float dv = want - _vel;
                float maxDv = accel * dtS;
                if (dv > maxDv) dv = maxDv;
                else if (dv < -maxDv) dv = -maxDv;
                _vel += dv;
                _current += _vel * dtS;
                if ((dir > 0.0f && _current >= _target) ||
                    (dir < 0.0f && _current <= _target)) {
                    _current = _target;
                    _vel = 0.0f;
                }
            } else {
                // حالت خطی (پیش‌فرض): سرعت ثابت تا هدف
                float step = vmax * dtS;
                if (step >= adiff) {
                    _current = _target;
                    _vel = 0.0f;
                } else {
                    _current += dir * step;
                    _vel = dir * vmax;
                }
            }
        }
        _idleSince = now;
        applyPulse();
    } else {
        _lastUpdate = now;
        _vel = 0.0f;
        // قطع پالس در بیکاری طولانی (فقط وقتی estop نیست — زیر بار ول نکن)
#if GRIP_IDLE_RELEASE_MS > 0
        if (!_estop && _hwOn &&
            now - _idleSince >= (unsigned long)GRIP_IDLE_RELEASE_MS) {
            hwOff();
        }
#endif
    }
}
