// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
// https://github.com/Draxx143/arduinoarm_robot
#include "Gripper.h"

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
// حالت CTC با TOP=39999 یعنی فریم 20ms (فرکانس 50Hz استاندارد سروو).
//   COMPA (سر فریم): پین HIGH + مسلح کردن COMPB با پهنای پالس
//   COMPB (پایان پالس): پین LOW
// پالس ۵۰۰..۲۵۰۰µs می‌شود ۱۰۰۰..۵۰۰۰ تیک — تفکیک ۰.۵µs (۰.۰۴۵ درجه).
// ---------------------------------------------------------------------
#define SERVO_FRAME_TICKS 40000UL

#ifdef __AVR__

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
    // نوشتن اتمیک: خواننده (ISR) نباید مقدار نصفه ببیند
    uint16_t ticks = (uint16_t)(pulseUs * 2);   // هر تیک = 0.5µs
    uint8_t sreg = SREG;
    cli();
    servoPulseTicks = ticks;
    SREG = sreg;
}

#else
// --- مدل host: رجیستر واقعی نیست؛ فقط آخرین پالس نگه داشته می‌شود ---
static int hostLastPulseUs = 1500;
static void servoHwAttach() {}
static void servoHwDetach() {}
static void servoHwWrite(int pulseUs) { hostLastPulseUs = pulseUs; }
#endif

// ---------------------------------------------------------------------

Gripper::Gripper()
    : _attached(false)
    , _current(GRIP_DEFAULT_DEG)
    , _target(GRIP_DEFAULT_DEG)
    , _lastPulseUs(-1)
    , _lastUpdate(0)
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
    float spanDeg = GRIP_MAX_DEG - GRIP_MIN_DEG;
    if (spanDeg <= 0.0f) return (GRIP_MIN_US + GRIP_MAX_US) / 2;
    float f = (d - GRIP_MIN_DEG) / spanDeg;
    return GRIP_MIN_US + (int)(f * (float)(GRIP_MAX_US - GRIP_MIN_US) + 0.5f);
}

void Gripper::begin() {
    _current = clampDeg(GRIP_DEFAULT_DEG);
    _target = _current;
    _lastUpdate = millis();
    attach();
}

void Gripper::attach() {
    if (!_attached) {
        _attached = true;
        servoHwAttach();
        _lastPulseUs = -1;   // وادار به نوشتن دوباره بعد از اتصال
        _lastUpdate = millis();
    }
    applyPulse();
}

void Gripper::detach() {
    if (_attached) {
        _attached = false;
        servoHwDetach();
    }
    _target = _current;      // بعد از آزاد شدن، هدفی باقی نماند
}

bool Gripper::isAttached() const {
    return _attached;
}

void Gripper::moveTo(float degrees) {
    if (_estop) return;
    if (!_attached) return;
    _target = clampDeg(degrees);
}

void Gripper::open() {
    moveTo(GRIP_OPEN_DEG);
}

void Gripper::close() {
    moveTo(GRIP_CLOSE_DEG);
}

void Gripper::stop() {
    _target = _current;
}

void Gripper::emergencyStop() {
    _estop = true;
    _target = _current;      // درجا بایست؛ پالس همچنان می‌ماند تا
                             // اگر چیزی گرفته، رها نکند
}

void Gripper::clearEmergencyStop() {
    _estop = false;
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

bool Gripper::isMoving() const {
    return _target != _current;
}

void Gripper::applyPulse() {
    if (!_attached) return;
    int us = degreesToMicros(_current);
    if (us != _lastPulseUs) {
        servoHwWrite(us);
        _lastPulseUs = us;
    }
}

void Gripper::update() {
    if (!_attached) {
        _lastUpdate = millis();
        return;
    }
    if (_target != _current) {
        unsigned long now = millis();
        unsigned long dt = now - _lastUpdate;
        _lastUpdate = now;
        if (dt > 0) {
            if (dt > 500) dt = 500;  // پرش زمانی بزرگ = یک قدم معقول
            // حرکت خطی با سرعت ثابت؛ قدم از فاصله بیشتر نمی‌شود
            float step = GRIP_SPEED_DEG_S * ((float)dt / 1000.0f);
            float diff = _target - _current;
            float adiff = (diff >= 0.0f) ? diff : -diff;
            if (step >= adiff) {
                _current = _target;
            } else {
                _current += (diff > 0.0f) ? step : -step;
            }
        }
    } else {
        _lastUpdate = millis();
    }
    applyPulse();
}
