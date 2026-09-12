// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
// https://github.com/Draxx143/arduinoarm_robot
#ifndef AXIS_H
#define AXIS_H

#include <Arduino.h>
#include "Config.h"

// تعداد خانه‌های جدول رمپ (شتاب / کاهش سرعت).
// جدول یک‌بار موقع شروع حرکت (خارج از ISR، با ممیز شناور) ساخته می‌شه و
// بعد ISR فقط با جمع/تفریق صحیح و یک اشاره به آرایه، فاصله‌ی استپ بعدی
// رو پیدا می‌کنه. این‌طوری هیچ sqrtf / تقسیم شناور / micros() داخل
// interrupt نمی‌مونه و سرعت واقعاً به MAX_SPEED می‌رسه.
#define RAMP_TABLE_SIZE   64
#define RAMP_Q16_SHIFT    16

// فازهای پروفایل حرکت
enum AxisPhase : uint8_t {
    PHASE_IDLE = 0,
    PHASE_ACCEL,
    PHASE_CRUISE,
    PHASE_DECEL,
    PHASE_STREAM    // حالت جریان پیوسته (trajectory) با سرعت ثابت
};

// ماشین حالت هومینگ (کاملاً غیرمسدودکننده — هیچ delay ای داخل ISR نیست)
enum HomingState : uint8_t {
    HOME_IDLE = 0,
    HOME_RELEASE,   // endstop از قبل فشرده بود → با سرعت کم دور می‌شیم
    HOME_SEARCH,    // حرکت به سمت endstop
    HOME_BACKOFF,   // عقب‌نشینی به اندازه‌ی BACKOFF و صفر کردن موقعیت
    HOME_DONE,
    HOME_FAILED
};

// کد دلیل شکست هومینگ.
// نکته: ماشین حالت هومینگ داخل ISR تایمر اجرا می‌شود، پس آنجا هیچ
// Serial.print ای زده نمی‌شود (روی AVR اگر بافر TX پر شود و interrupt
// هم‌سطح باشد، بن‌بست می‌کند). دلیل را با این کد بیرون می‌دهیم و
// MotorController از حلقه‌ی اصلی چاپش می‌کند.
enum HomingFaultCode : uint8_t {
    HOME_FAULT_NONE = 0,
    HOME_FAULT_ESTOP,           // استپ اضطراری فعال بود
    HOME_FAULT_NOT_FOUND,       // endstop در محدوده‌ی جست‌وجو پیدا نشد
    HOME_FAULT_BACKOFF_STUCK,   // سوئیچ حین بک‌آف آزاد نشد (چسبیده/خراب)
    HOME_FAULT_BACKOFF_PRESSED  // بک‌آف تمام شد ولی سوئیچ هنوز فشرده بود
};

class Axis {
public:
    // Constructor
    Axis(uint8_t stepPin, uint8_t dirPin, uint8_t enablePin,
         uint8_t endstopPin, bool invertDir, uint16_t stepsPerRev,
         uint8_t microstep, float gearRatio, uint32_t maxSpeed,
         uint32_t acceleration, int32_t backoff,
         int32_t softMin, int32_t softMax, uint32_t homingSpeed = 0);

    // Initialize
    void init();

    // ---- Motor enable ----
    void enableMotor();
    void disableMotor();
    bool isEnabled() const;

    // ---- Movement Commands ----
    void moveTo(int32_t targetPosition);      // Absolute move
    void moveRelative(int32_t deltaPosition); // Relative move
    // حرکت زمان‌بندی‌شده: طوری حرکت می‌کنه که در durationMs برسه
    // (برای هماهنگ شدن هم‌زمان چند محور)
    void moveToTimed(int32_t targetPosition, uint32_t durationMs);
    // به‌روزرسانی زنده‌ی هدف بدون ساخت مجدد رمپ (برای trajectory)
    void streamTo(int32_t targetPosition);
    // کوتاه‌ترین زمان ممکن برای رسیدن به هدف (میلی‌ثانیه)
    uint32_t minDurationMs(int32_t target) const;
    float estimateMoveSeconds(uint32_t dist, float vmax) const;
    void stop();                              // توقف فوری

    // ---- Homing ----
    bool startHoming();
    bool isHoming() const;
    bool isHomed() const;
    bool homingFailed() const;
    void clearHomingFault();
    // پاک کردن پرچم «هوم‌شده» بدون حرکت دادن موتور. وقتی توالی هومینگ
    // کامل شروع می‌شود، همه‌ی محورها از نو مرجع می‌گیرند، پس وضعیت باید
    // همان لحظه «هوم‌نشده» گزارش شود (نه بعد از رسیدن نوبتشان).
    void clearHomed() { _homed = false; }
    void backoffFromEndstop();   // غیرمسدودکننده: فقط endstop رو آزاد می‌کنه

    // کد دلیل شکست هومینگ (HOME_FAULT_*) — برای چاپ از حلقه‌ی اصلی
    uint8_t homingFaultCode() const { return _homeFaultCode; }
    // بک‌آف کامل شد و آزاد شدن endstop هم تأیید شد؟
    bool    backoffDone()   const { return _backoffDone; }
    // وضعیت ماشین حالت هومینگ (HOME_*) و تعداد استپ‌های فاز فعلی
    uint8_t  homeState() const { return _homeState; }
    uint32_t homeSteps() const { return _homeSteps; }

    // ---- Status ----
    int32_t  getCurrentPosition() const;
    int32_t  getTargetPosition() const;
    int32_t  getSoftMin() const { return _softMin; }
    int32_t  getSoftMax() const { return _softMax; }
    bool     isMoving() const;
    bool     isActive() const { return _active; }
    bool     isAtTarget() const;
    bool     getEndstopState() const;   // HIGH = آزاد، LOW = فشرده
    bool     endstopPressed() const;    // true = فشرده
    uint32_t getCurrentSpeed() const;   // steps/s لحظه‌ای (از روی interval)
    uint32_t getMaxSpeed() const { return _maxSpeed; }
    uint32_t getBaseMaxSpeed() const { return _baseMaxSpeed; }
    uint32_t getAcceleration() const { return _acceleration; }
    uint32_t getHomingSpeed() const { return _homingSpeed; }
    float    getStepsPerDegree() const;

    // ---- موتور حرکت: فقط از داخل ISR صدا زده می‌شه ----
    // true یعنی پین STEP همین تیک بالا رفت (باید بعد از پهنای پالس پایین بیاد)
    bool tick();
    void endPulse();          // پایین آوردن پین STEP (tick + endPulse)

    // ---- Set parameters ----
    void setSpeed(uint32_t speed);            // MAX_SPEED مؤثر (steps/s)
    void setBaseSpeed(uint32_t speed);        // مقدار پایه‌ی Config.h
    void setAcceleration(uint32_t acceleration);
    void setBaseAcceleration(uint32_t acceleration);
    void setHomingSpeed(uint32_t speed);
    void setSpeedScale(float mult);           // ضریب پروفایل سرعت
    void setAccelScale(float mult);
    void setPosition(int32_t position);
    void setDirectionInverted(bool invert);
    void setEnabled(bool enabled);
    void setEmergencyStop(bool enabled);

private:
    void planMove(int32_t target, uint32_t vmax);
    void buildProfile(uint32_t startSpeed, uint32_t totalSteps, uint32_t vmax);
    void advanceProfile();
    void finishMove();
    void applyScales();
    void writeDirection(int8_t sign);
    void setMoveDirection(int8_t sign);
    bool homingTick();
    void beginSearch();
    void beginBackoff();
    void completeHoming();
    void failHoming(uint8_t code);
    static uint16_t intervalTicks(float speed, float minSpeed, float maxSpeed);

    // ---- Pin configuration ----
    uint8_t _stepPin;
    uint8_t _dirPin;
    uint8_t _enablePin;
    uint8_t _endstopPin;

    // رجیسترهای پورت (پیش‌محاسبه در init → ISR بدون digitalWrite/digitalRead)
    volatile uint8_t* _stepPort;
    uint8_t _stepMask;
    volatile uint8_t* _dirPort;
    uint8_t _dirMask;
    volatile uint8_t* _enablePort;
    uint8_t _enableMask;
    volatile uint8_t* _endstopReg;   // رجیستر ورودی
    uint8_t _endstopMask;

    // ---- Motor parameters ----
    bool _invertDir;
    uint16_t _stepsPerRev;
    uint8_t _microstep;
    float _gearRatio;

    uint32_t _baseMaxSpeed;      // مقدار Config.h (بدون ضریب)
    uint32_t _baseAcceleration;
    float _speedScale;           // ضریب پروفایل سرعت
    float _accelScale;
    uint32_t _maxSpeed;          // مؤثر = base × scale
    uint32_t _acceleration;      // مؤثر = base × scale
    uint32_t _homingSpeed;
    uint32_t _homingReleaseSpeed;
    int32_t _backoff;
    int32_t _softMin;
    int32_t _softMax;

    // ---- State (مشترک بین ISR و حلقه‌ی اصلی) ----
    volatile int32_t _currentPosition;
    volatile int32_t _targetPosition;
    volatile bool _moving;
    volatile bool _active;      // حرکت یا هومینگ در جریان است
    volatile bool _homing;
    volatile bool _homed;
    volatile bool _enabled;
    volatile bool _emergencyStop;

    // ---- Motion control (فقط ISR می‌نویسه، مگر داخل بلوک cli/sei) ----
    volatile uint16_t _counter;        // تیک‌های باقی‌مانده تا استپ بعدی
    volatile uint16_t _interval;       // فاصله‌ی استپ بعدی (تیک)
    volatile uint16_t _cruiseInterval;
    volatile uint8_t  _phase;
    volatile uint32_t _phaseStepsLeft;
    volatile uint32_t _rampQ16;
    volatile uint32_t _rampIncQ16;
    volatile uint32_t _stepsToGo;
    volatile int8_t   _dirSign;

    uint32_t _accelSteps;
    uint32_t _decelSteps;
    uint32_t _cruiseSteps;
    uint32_t _peakSpeed;
    volatile uint32_t _accelIncQ16;
    volatile uint32_t _decelIncQ16;
    uint16_t _accelTable[RAMP_TABLE_SIZE];
    uint16_t _decelTable[RAMP_TABLE_SIZE];

    // ---- Homing state ----
    volatile uint8_t  _homeState;
    volatile uint32_t _homeSteps;
    volatile bool     _homeFault;
    volatile uint8_t  _homeFaultCode;   // دلیل شکست (HomingFaultCode)
    volatile bool     _backoffDone;     // بک‌آف انجام و تأیید شد
    volatile bool     _releaseOnly;   // فقط آزادسازی endstop (بدون صفر کردن)
    uint32_t _homeSearchLimit;
    uint32_t _homeReleaseLimit;
    uint16_t _homeSearchTicks;
    uint16_t _homeBackoffTicks;
    uint16_t _homeReleaseTicks;
};

#endif // AXIS_H
