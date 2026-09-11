#include "Axis.h"
#include <Arduino.h>
#include <math.h>

#ifndef DEBUG_SERIAL
#define DEBUG_SERIAL false
#endif

// ============================================
// کمک‌تابع‌ها
// ============================================

// تبدیل سرعت (steps/s) به تعداد تیک تایمر.
//
// تیک تایمر 20kHz است، پس فاصله‌ی استپ یک عدد صحیح از تیک‌هاست و سرعت
// قابل دستیابی گسسته است: 20000/t. دو نکته مهم:
//   ۱) در محدوده‌ی کاری معمول (interval >= 8 یعنی تا ~2500 steps/s) به
//      نزدیک‌ترین عدد گرد می‌کنیم -> دقیق‌ترین زمان‌بندی ممکن.
//   ۲) در سرعت‌های بالا (interval < 8) همیشه به بالا گرد می‌کنیم، یعنی
//      سرعت واقعی هرگز از مقدار درخواستی بیشتر نمی‌شود. با گرد کردن به
//      پایین، مثلاً درخواست 8000 steps/s به 10000 steps/s واقعی تبدیل
//      می‌شد (۲۵٪ سریع‌تر!) که روی سخت‌افزار باعث جا ماندن استپ می‌شود.
static inline uint16_t speedToTicks(uint32_t speed) {
    if (speed < 1) speed = 1;
    if (speed > (uint32_t)STEP_TICK_FREQ) speed = (uint32_t)STEP_TICK_FREQ;

    uint32_t t   = (uint32_t)STEP_TICK_FREQ / speed;
    uint32_t rem = (uint32_t)STEP_TICK_FREQ - t * speed;

    if (rem) {
        if (t >= 8) { if (rem * 2 >= speed) t++; }   // گرد کردن به نزدیک‌ترین
        else        { t++; }                         // ایمن: هرگز سریع‌تر از درخواست
    }
    if (t < 1) t = 1;
    if (t > 65535UL) t = 65535UL;
    return (uint16_t)t;
}

// ============================================
// Constructor
// ============================================
Axis::Axis(uint8_t stepPin, uint8_t dirPin, uint8_t enablePin,
           uint8_t endstopPin, bool invertDir, uint16_t stepsPerRev,
           uint8_t microstep, float gearRatio, uint32_t maxSpeed,
           uint32_t acceleration, int32_t backoff,
           int32_t softMin, int32_t softMax, uint32_t homingSpeed)
    : _stepPin(stepPin), _dirPin(dirPin), _enablePin(enablePin),
      _endstopPin(endstopPin), _invertDir(invertDir),
      _stepsPerRev(stepsPerRev), _microstep(microstep),
      _gearRatio(gearRatio), _backoff(backoff),
      _softMin(softMin), _softMax(softMax) {

    _baseMaxSpeed     = maxSpeed;
    _baseAcceleration = acceleration;
    _speedScale       = (float)SPEED_SCALE_PERCENT / 100.0f;
    _accelScale       = 1.0f;

    // سرعت هوم: اگه مقدار اختصاصی داده نشده، درصدی از MAX_SPEED
    if (homingSpeed == 0) {
        _homingSpeed = maxSpeed / 2;
    } else {
        _homingSpeed = homingSpeed;
    }
    _homingReleaseSpeed = _homingSpeed;

    // رجیسترهای پورت در init() پر می‌شن
    _stepPort    = nullptr;
    _dirPort     = nullptr;
    _enablePort  = nullptr;
    _endstopReg  = nullptr;
    _stepMask = _dirMask = _enableMask = _endstopMask = 0;

    _currentPosition = 0;
    _targetPosition  = 0;
    _moving          = false;
    _active          = false;
    _homing          = false;
    _homed           = false;
    _enabled         = false;
    _emergencyStop   = false;

    _counter         = 0;
    _interval        = 0;
    _cruiseInterval  = 0;
    _phase           = PHASE_IDLE;
    _phaseStepsLeft  = 0;
    _rampQ16         = 0;
    _rampIncQ16      = 0;
    _stepsToGo       = 0;
    _dirSign         = 1;

    _accelSteps  = 0;
    _decelSteps  = 0;
    _cruiseSteps = 0;
    _peakSpeed   = 0;
    _accelIncQ16 = 0;
    _decelIncQ16 = 0;
    for (uint8_t i = 0; i < RAMP_TABLE_SIZE; i++) {
        _accelTable[i] = 1;
        _decelTable[i] = 1;
    }

    _homeState        = HOME_IDLE;
    _homeSteps        = 0;
    _homeFault        = false;
    _homeFaultCode    = HOME_FAULT_NONE;
    _backoffDone      = false;
    _homeSearchLimit  = 0;
    _homeReleaseLimit = HOMING_RELEASE_MAX_STEPS;
    _homeSearchTicks  = 1;
    _homeBackoffTicks = 1;
    _homeReleaseTicks = 1;
    _releaseOnly      = false;
}

// ============================================
// init
// ============================================
void Axis::init() {
    pinMode(_stepPin, OUTPUT);
    pinMode(_dirPin, OUTPUT);
    pinMode(_enablePin, OUTPUT);
    pinMode(_endstopPin, INPUT_PULLUP);

    // پیش‌محاسبه‌ی رجیستر پورت‌ها تا ISR هیچ‌وقت
    // digitalWrite / digitalRead / micros صدا نزنه
    _stepPort    = portOutputRegister(digitalPinToPort(_stepPin));
    _stepMask    = digitalPinToBitMask(_stepPin);
    _dirPort     = portOutputRegister(digitalPinToPort(_dirPin));
    _dirMask     = digitalPinToBitMask(_dirPin);
    _enablePort  = portOutputRegister(digitalPinToPort(_enablePin));
    _enableMask  = digitalPinToBitMask(_enablePin);
    _endstopReg  = portInputRegister(digitalPinToPort(_endstopPin));
    _endstopMask = digitalPinToBitMask(_endstopPin);

    *_stepPort   &= ~_stepMask;
    *_dirPort    &= ~_dirMask;
    *_enablePort |= _enableMask;    // HIGH = موتور غیرفعال

    _enabled = false;
    _homed   = false;

    // اعمال ضریب‌ها روی سرعت مؤثر (شامل سرعت آزادسازی هومینگ)
    applyScales();
}

// ============================================
// Enable / Disable
// ============================================
void Axis::enableMotor() {
    if (_enablePort) *_enablePort &= ~_enableMask;   // LOW = فعال
    _enabled = true;
}

void Axis::disableMotor() {
    if (_enablePort) *_enablePort |= _enableMask;    // HIGH = غیرفعال
    _enabled = false;
}

bool Axis::isEnabled() const {
    return _enabled;
}

// ============================================
// Endstop
// ============================================
bool Axis::endstopPressed() const {
    if (!_endstopReg) return false;
    return ((*_endstopReg & _endstopMask) == 0);   // LOW = فشرده (INPUT_PULLUP)
}

bool Axis::getEndstopState() const {
    if (!_endstopReg) return HIGH;
    return (*_endstopReg & _endstopMask) ? HIGH : LOW;
}

// ============================================
// جهت
// ============================================
// جهت را هم روی پین DIR می‌گذارد و هم علامت شمارش موقعیت را تنظیم می‌کند.
// (این دو باید همیشه با هم عوض شوند، وگرنه موتور یک‌طرف می‌رود ولی
//  موقعیت برعکس شمرده می‌شود)
void Axis::setMoveDirection(int8_t sign) {
    _dirSign = sign;
    writeDirection(sign);
}

void Axis::writeDirection(int8_t sign) {
    if (!_dirPort) return;
    bool high = (sign > 0);
    if (_invertDir) high = !high;
    if (high) *_dirPort |= _dirMask;
    else      *_dirPort &= ~_dirMask;
}

// ============================================
// حرکت
// ============================================
void Axis::moveTo(int32_t targetPosition) {
    if (!_enabled || _homing || _emergencyStop) return;

    if (targetPosition < _softMin || targetPosition > _softMax) {
        Serial.print(F("!! ERROR: Target position "));
        Serial.print(targetPosition);
        Serial.print(F(" is OUT OF RANGE. Soft limits: "));
        Serial.print(_softMin);
        Serial.print(F(" to "));
        Serial.print(_softMax);
        Serial.println(F(" steps. Command REJECTED."));
        return;
    }

    planMove(targetPosition, _maxSpeed);
}

void Axis::moveRelative(int32_t deltaPosition) {
    if (!_enabled || _homing || _emergencyStop) return;
    moveTo(getCurrentPosition() + deltaPosition);
}

void Axis::moveToTimed(int32_t targetPosition, uint32_t durationMs) {
    if (!_enabled || _homing || _emergencyStop) return;

    if (targetPosition < _softMin || targetPosition > _softMax) {
        Serial.print(F("!! ERROR: Target position "));
        Serial.print(targetPosition);
        Serial.println(F(" is OUT OF RANGE. Command REJECTED."));
        return;
    }

    int32_t delta = targetPosition - getCurrentPosition();
    uint32_t dist = (uint32_t)((delta > 0) ? delta : -delta);

    uint32_t vmax = _maxSpeed;
    if (dist > 0 && durationMs > 0) {
        // جست‌وجوی دودویی روی سرعت بیشینه تا زمان حرکت به durationMs برسد.
        // این‌طور همه‌ی محورها می‌توانند هم‌زمان به مقصد برسند.
        float wantT = (float)durationMs / 1000.0f;
        float lo = (float)RAMP_MIN_SPEED;
        float hi = (float)_maxSpeed;
        if (hi < lo) hi = lo;

        if (estimateMoveSeconds(dist, hi) <= wantT) {
            for (uint8_t i = 0; i < 24; i++) {
                float mid = 0.5f * (lo + hi);
                if (estimateMoveSeconds(dist, mid) > wantT) lo = mid;
                else                                        hi = mid;
            }
            vmax = (uint32_t)hi;
        }
        // در غیر این صورت: حتی با سرعت بیشینه هم به زمان خواسته نمی‌رسیم
        // → با حداکثر توان حرکت می‌کنیم
        if (vmax < (uint32_t)RAMP_MIN_SPEED) vmax = RAMP_MIN_SPEED;
    }

    planMove(targetPosition, vmax);
}

// زمان تقریبی یک حرکت ذوزنقه‌ای/مثلثی (ثانیه)
float Axis::estimateMoveSeconds(uint32_t dist, float vmax) const {
    float a = (float)_acceleration;
    if (a < 1.0f) a = 1.0f;
    float vmin = (float)RAMP_MIN_SPEED;
    if (!(vmax > vmin)) vmax = vmin;

    float rampDist = (vmax * vmax - vmin * vmin) / a;   // مسافت شتاب + کاهش
    if ((float)dist >= rampDist) {
        return 2.0f * (vmax - vmin) / a + ((float)dist - rampDist) / vmax;
    }
    float vpeak = sqrtf(vmin * vmin + a * (float)dist);
    return 2.0f * (vpeak - vmin) / a;
}

// کوتاه‌ترین زمانی که این محور می‌تواند تا target برود (میلی‌ثانیه)
uint32_t Axis::minDurationMs(int32_t target) const {
    int32_t delta = target - getCurrentPosition();
    uint32_t dist = (uint32_t)((delta > 0) ? delta : -delta);
    if (dist == 0) return 0;
    float t = estimateMoveSeconds(dist, (float)_maxSpeed);
    if (t < 0.001f) t = 0.001f;
    return (uint32_t)(t * 1000.0f);
}

// به‌روزرسانی زنده‌ی هدف — بدون ساخت مجدد جدول رمپ (سبک و بدون ممیز شناور)
void Axis::streamTo(int32_t targetPosition) {
    if (!_enabled || _homing || _emergencyStop) return;
    if (targetPosition < _softMin || targetPosition > _softMax) return;

    int32_t delta = targetPosition - getCurrentPosition();

    uint8_t sreg = SREG;
    cli();
    _targetPosition = targetPosition;

    if (delta == 0) {
        _stepsToGo = 0;
        SREG = sreg;
        return;
    }

    _stepsToGo = (uint32_t)((delta > 0) ? delta : -delta);
    setMoveDirection((delta > 0) ? 1 : -1);

    if (!_active) {
        _interval = speedToTicks(RAMP_MIN_SPEED);
        _counter  = 0;
    }
    _phase          = PHASE_STREAM;
    _phaseStepsLeft = 0;
    _moving         = true;
    _active         = true;
    SREG = sreg;
}

void Axis::planMove(int32_t target, uint32_t vmax) {
    int32_t cur = getCurrentPosition();      // خواندن اتمیک

    if (target == cur) {
        _targetPosition = target;
        stop();
        return;
    }

    // اگه حرکتی در جریان بود، سرعت فعلی حفظ می‌شه تا retarget نرم باشه
    // (جلوگیری از ریست شدن رمپ و خزیدن مجدد از سرعت صفر)
    uint32_t v0 = _active ? getCurrentSpeed() : 0;

    // ISR موقع ساخت جدول‌ها نباید به متغیرها دست بزنه
    stop();

    int32_t delta = target - cur;
    int8_t  sign  = (delta > 0) ? 1 : -1;
    uint32_t total = (uint32_t)((delta > 0) ? delta : -delta);

    // ساخت پروفایل (ممیز شناور) — خارج از بلوک اتمیک، چون _active خاموشه
    buildProfile(v0, total, vmax);

    uint8_t sreg = SREG;
    cli();
    _targetPosition = target;
    _stepsToGo      = total;
    setMoveDirection(sign);
    _counter = 0;
    _moving  = true;
    _active  = true;
    SREG = sreg;
}

void Axis::stop() {
    uint8_t sreg = SREG;
    cli();
    _active         = false;
    _moving         = false;
    _homing         = false;
    _phase          = PHASE_IDLE;
    _phaseStepsLeft = 0;
    _counter        = 0;
    _interval       = 0;
    _stepsToGo      = 0;
    _homeState      = HOME_IDLE;
    SREG = sreg;
}

// ============================================
// ساخت پروفایل سرعت (فقط از حلقه‌ی اصلی صدا زده می‌شه)
// ============================================
uint16_t Axis::intervalTicks(float speed, float minSpeed, float maxSpeed) {
    if (!(speed > 0.0f)) speed = minSpeed;      // محافظت در برابر NaN
    if (speed < minSpeed) speed = minSpeed;
    if (speed > maxSpeed) speed = maxSpeed;
    if (speed < 1.0f)     speed = 1.0f;

    // همان قاعده‌ی speedToTicks (نگاه نک. توضیح آنجا)
    return speedToTicks((uint32_t)(speed + 0.5f));
}

void Axis::buildProfile(uint32_t startSpeed, uint32_t totalSteps, uint32_t maxSpeed) {
    float a    = (float)_acceleration;
    float vmin = (float)RAMP_MIN_SPEED;
    float vmax = (float)maxSpeed;
    if (vmax > (float)_maxSpeed) vmax = (float)_maxSpeed;
    if (a < 1.0f)      a = 1.0f;
    if (vmax < vmin)   vmax = vmin;

    float v0 = (float)startSpeed;
    if (v0 < vmin) v0 = vmin;
    if (v0 > vmax) v0 = vmax;

    if (totalSteps == 0) {
        _accelSteps = _decelSteps = _cruiseSteps = 0;
        _phase = PHASE_IDLE;
        _interval = intervalTicks(vmin, vmin, vmax);
        _peakSpeed = 0;
        return;
    }

    // استپ‌های لازم برای رسیدن از v0 تا vmax  (v² = v0² + 2as)
    uint32_t accelFull = (v0 >= vmax) ? 0
                         : (uint32_t)((vmax * vmax - v0 * v0) / (2.0f * a));
    // استپ‌های لازم برای توقف از vmax تا vmin
    uint32_t decelFull = (uint32_t)((vmax * vmax - vmin * vmin) / (2.0f * a));
    if (decelFull < 1) decelFull = 1;

    float vpeak;

    if (accelFull + decelFull <= totalSteps) {
        // ---- ذوزنقه‌ای: به سرعت بیشینه می‌رسیم ----
        _accelSteps  = accelFull;
        _decelSteps  = decelFull;
        _cruiseSteps = totalSteps - _accelSteps - _decelSteps;
        vpeak        = vmax;
    } else {
        // ---- مثلثی: مسیر کوتاه است، به سرعت بیشینه نمی‌رسیم ----
        float ratio = (float)accelFull / (float)(accelFull + decelFull);
        if (!(ratio > 0.0f)) ratio = 0.0f;
        if (ratio > 1.0f)    ratio = 1.0f;

        _accelSteps = (uint32_t)((float)totalSteps * ratio);
        if (_accelSteps >= totalSteps) _accelSteps = totalSteps - 1;
        _decelSteps  = totalSteps - _accelSteps;
        _cruiseSteps = 0;

        float vp = sqrtf(v0 * v0 + 2.0f * a * (float)_accelSteps);
        vpeak = (vp < vmax) ? vp : vmax;
        if (vpeak < vmin) vpeak = vmin;
    }

    if (_decelSteps < 1) _decelSteps = 1;
    _peakSpeed = (uint32_t)vpeak;

    // ---- جدول شتاب: خانه‌ی ۰ = v0، خانه‌ی آخر = vpeak ----
    for (uint8_t i = 0; i < RAMP_TABLE_SIZE; i++) {
        float frac = (float)i / (float)(RAMP_TABLE_SIZE - 1);
        float v = sqrtf(v0 * v0 + 2.0f * a * frac * (float)_accelSteps);
        _accelTable[i] = intervalTicks(v, vmin, vpeak);
    }

    // ---- جدول کاهش سرعت: خانه‌ی ۰ = vmin، خانه‌ی آخر = vpeak ----
    //      (در فاز کاهش، از خانه‌ی آخر به سمت صفر پیمایش می‌شود)
    for (uint8_t i = 0; i < RAMP_TABLE_SIZE; i++) {
        float frac = (float)i / (float)(RAMP_TABLE_SIZE - 1);
        float v = sqrtf(vmin * vmin + 2.0f * a * frac * (float)_decelSteps);
        _decelTable[i] = intervalTicks(v, vmin, vpeak);
    }

    _accelIncQ16 = _accelSteps ? ((uint32_t)RAMP_TABLE_SIZE << RAMP_Q16_SHIFT) / _accelSteps : 0;
    _decelIncQ16 = _decelSteps ? ((uint32_t)RAMP_TABLE_SIZE << RAMP_Q16_SHIFT) / _decelSteps : 0;
    if (_accelIncQ16 == 0 && _accelSteps) _accelIncQ16 = 1;
    if (_decelIncQ16 == 0 && _decelSteps) _decelIncQ16 = 1;

    _cruiseInterval = intervalTicks(vpeak, vmin, vpeak);

    // ---- فاز اولیه ----
    if (_accelSteps > 0) {
        _phase          = PHASE_ACCEL;
        _phaseStepsLeft = _accelSteps;
        _rampQ16        = 0;
        _rampIncQ16     = _accelIncQ16;
        _interval       = _accelTable[0];
    } else if (_cruiseSteps > 0) {
        _phase          = PHASE_CRUISE;
        _phaseStepsLeft = _cruiseSteps;
        _rampIncQ16     = 0;
        _interval       = _cruiseInterval;
    } else {
        _phase          = PHASE_DECEL;
        _phaseStepsLeft = _decelSteps;
        _rampQ16        = (uint32_t)RAMP_TABLE_SIZE << RAMP_Q16_SHIFT;
        _rampIncQ16     = _decelIncQ16;
        _interval       = _decelTable[RAMP_TABLE_SIZE - 1];
    }
}

// ============================================
// ISR — قلب موتور حرکت
// ============================================
bool Axis::tick() {
    if (!_active) return false;

    if (_homing) {
        if (homingTick()) return false;   // هومینگ تمام/خطا → غیرفعال شد
    } else if (_stepsToGo == 0) {
        finishMove();
        return false;
    }

    if (_counter) { _counter--; return false; }

    // ---- صدور پالس STEP (بالا بردن پین) ----
    *_stepPort |= _stepMask;

    _currentPosition += _dirSign;

    if (_homing) {
        _homeSteps++;
    } else {
        if (_stepsToGo) _stepsToGo--;
        advanceProfile();
        if (_stepsToGo == 0) finishMove();
    }

    // اگر _counter = _interval گذاشته شود، دوره‌ی واقعیِ استپ
    // (_interval + 1) تیک می‌شود و سرعت حدود ۹٪ کمتر از مقدار تنظیم‌شده
    // خواهد بود. شمارنده «تعداد تیک‌های بین دو استپ» است، پس منهای یک.
    _counter = (_interval > 0) ? (uint16_t)(_interval - 1) : 0;
    return true;
}

void Axis::endPulse() {
    *_stepPort &= ~_stepMask;
}

void Axis::advanceProfile() {
    switch (_phase) {

    case PHASE_ACCEL: {
        uint32_t q = _rampQ16 + _rampIncQ16;
        _rampQ16 = q;
        uint16_t idx = (uint16_t)(q >> RAMP_Q16_SHIFT);
        if (idx >= RAMP_TABLE_SIZE) idx = RAMP_TABLE_SIZE - 1;
        _interval = _accelTable[idx];

        if (_phaseStepsLeft) _phaseStepsLeft--;
        if (_phaseStepsLeft == 0) {
            if (_cruiseSteps > 0) {
                _phase          = PHASE_CRUISE;
                _phaseStepsLeft = _cruiseSteps;
                _interval       = _cruiseInterval;
            } else if (_decelSteps > 0) {
                _phase          = PHASE_DECEL;
                _phaseStepsLeft = _decelSteps;
                _rampQ16        = (uint32_t)RAMP_TABLE_SIZE << RAMP_Q16_SHIFT;
                _rampIncQ16     = _decelIncQ16;
                _interval       = _decelTable[RAMP_TABLE_SIZE - 1];
            }
        }
        break;
    }

    case PHASE_CRUISE:
        _interval = _cruiseInterval;
        if (_phaseStepsLeft) _phaseStepsLeft--;
        if (_phaseStepsLeft == 0 && _decelSteps > 0) {
            _phase          = PHASE_DECEL;
            _phaseStepsLeft = _decelSteps;
            _rampQ16        = (uint32_t)RAMP_TABLE_SIZE << RAMP_Q16_SHIFT;
            _rampIncQ16     = _decelIncQ16;
            _interval       = _decelTable[RAMP_TABLE_SIZE - 1];
        }
        break;

    case PHASE_DECEL: {
        uint32_t q = (_rampQ16 > _rampIncQ16) ? (_rampQ16 - _rampIncQ16) : 0;
        _rampQ16 = q;
        uint16_t idx = (uint16_t)(q >> RAMP_Q16_SHIFT);
        if (idx >= RAMP_TABLE_SIZE) idx = RAMP_TABLE_SIZE - 1;
        _interval = _decelTable[idx];

        if (_phaseStepsLeft) _phaseStepsLeft--;
        break;
    }

    case PHASE_STREAM:
        // سرعت ثابت می‌مونه — هدف به‌صورت زنده از بیرون به‌روز می‌شه
        break;

    default:
        break;
    }
}

void Axis::finishMove() {
    _active         = false;
    _moving         = false;
    _phase          = PHASE_IDLE;
    _phaseStepsLeft = 0;
    _counter        = 0;
    _interval       = 0;
}

// ============================================
// هومینگ — ماشین حالت غیرمسدودکننده
// ============================================
bool Axis::startHoming() {
    if (_emergencyStop) {
        _homeFault     = true;
        _homeFaultCode = HOME_FAULT_ESTOP;
        return false;
    }
    if (_homing) return false;
    if (!_enabled) enableMotor();

    // اگر حرکتی در جریان است، اول تمیز متوقفش کن (هومینگ مرجع موقعیت را
    // از نو می‌سازد، پس ادامه‌ی حرکت قبلی معنی ندارد)
    if (_moving) stop();

    uint32_t hs = _homingSpeed;
    if (hs < HOMING_MIN_SPEED) hs = HOMING_MIN_SPEED;
    if (hs > MAX_SPEED_LIMIT)  hs = MAX_SPEED_LIMIT;

    uint32_t rs = _homingReleaseSpeed;
    if (rs < HOMING_MIN_SPEED) rs = HOMING_MIN_SPEED;
    if (rs > hs) rs = hs;

    // محدودیت مسافت جستجو (ایمنی: اگه endstop خراب باشه تا ابد حرکت نکنه)
    uint32_t travel = (uint32_t)(_softMax - _softMin) + (uint32_t)abs(_backoff);
    uint32_t limit  = travel + (travel * HOMING_MARGIN_PERCENT / 100) + 500;

    _homeSearchTicks  = speedToTicks(hs);
    _homeBackoffTicks = speedToTicks(hs);
    _homeReleaseTicks = speedToTicks(rs);
    _homeSearchLimit  = limit;
    _homeReleaseLimit = HOMING_RELEASE_MAX_STEPS;

    uint8_t sreg = SREG;
    cli();
    _homing         = true;
    _homeFault      = false;
    _homeFaultCode  = HOME_FAULT_NONE;
    _backoffDone    = false;      // بک‌آف باید از نو انجام و تأیید شود
    _homeSteps      = 0;
    _homed          = false;
    _releaseOnly    = false;
    _phase          = PHASE_IDLE;
    _stepsToGo      = 0;
    _counter        = 0;

    if (endstopPressed()) {
        // اول باید از روی endstop بلند بشیم
        _homeState = HOME_RELEASE;
        _interval  = _homeReleaseTicks;
        setMoveDirection(+1);
    } else {
        _homeState = HOME_SEARCH;
        _interval  = _homeSearchTicks;
        setMoveDirection(-1);
    }
    _moving = true;
    _active = true;
    SREG = sreg;

    return true;
}

// آزادسازی endstop بدون هوم کردن (غیرمسدودکننده)
void Axis::backoffFromEndstop() {
    if (_homing || _emergencyStop) return;
    if (!endstopPressed()) return;              // چیزی برای آزاد کردن نیست
    if (!_enabled) enableMotor();

    uint32_t rs = _homingReleaseSpeed;
    if (rs < HOMING_MIN_SPEED) rs = HOMING_MIN_SPEED;
    _homeReleaseTicks = speedToTicks(rs);
    _homeReleaseLimit = HOMING_RELEASE_MAX_STEPS;

    uint8_t sreg = SREG;
    cli();
    _homing        = true;
    _releaseOnly   = true;
    _homeState     = HOME_RELEASE;
    _homeSteps     = 0;
    _homeFault     = false;
    _homeFaultCode = HOME_FAULT_NONE;
    _phase       = PHASE_IDLE;
    _stepsToGo   = 0;
    _counter     = 0;
    _interval    = _homeReleaseTicks;
    setMoveDirection(+1);
    _moving      = true;
    _active      = true;
    SREG = sreg;
}

bool Axis::homingTick() {
    switch (_homeState) {

    case HOME_RELEASE:
        if (!endstopPressed() || _homeSteps >= _homeReleaseLimit) {
            if (_releaseOnly) {
                _homeState = HOME_DONE;
                _homing = false; _moving = false; _active = false;
                _counter = 0; _interval = 0;
                return true;
            }
            beginSearch();
        }
        break;

    case HOME_SEARCH:
        if (endstopPressed()) {
            // سوئیچ پیدا شد -> بک‌آف اجباری شروع می‌شود
            beginBackoff();
        } else if (_homeSteps >= _homeSearchLimit) {
            failHoming(HOME_FAULT_NOT_FOUND);
            return true;
        }
        break;

    case HOME_BACKOFF: {
        // ==== بک‌آف اجباری ====
        // ۱) حداقل abs(_backoff) استپ حتماً طی می‌شود (هیچ محوری بدون
        //    بک‌آف صفر نمی‌شود).
        // ۲) در پایان، آزاد شدن endstop بررسی می‌شود. اگر سوئیچ هنوز
        //    فشرده بود، تا HOMING_BACKOFF_EXTRA_STEPS استپ اضافه‌تر هم
        //    عقب می‌رویم تا آزاد شود.
        // ۳) اگر باز هم آزاد نشد -> هومینگ با خطا تمام می‌شود. قبلاً در
        //    این حالت بی‌سروصدا «صفر» ثبت می‌شد در حالی که سوئیچ زیر فشار
        //    بود و کل مرجع موقعیت غلط می‌شد.
        const uint32_t need    = (uint32_t)abs(_backoff);
        const uint32_t hardMax = need + (uint32_t)HOMING_BACKOFF_EXTRA_STEPS;
        const bool pressed     = endstopPressed();

        if (_homeSteps >= need && (!HOMING_VERIFY_BACKOFF || !pressed)) {
            completeHoming();          // بک‌آف کامل + سوئیچ آزاد ✓
            return true;
        }
        if (_homeSteps >= hardMax) {
            // حتی با استپ‌های اضافه هم سوئیچ آزاد نشد
            failHoming(pressed ? HOME_FAULT_BACKOFF_STUCK
                               : HOME_FAULT_BACKOFF_PRESSED);
            return true;
        }
        break;
    }

    default:
        _homing = false; _moving = false; _active = false;
        return true;
    }
    return false;
}

void Axis::beginSearch() {
    _homeState = HOME_SEARCH;
    _homeSteps = 0;
    _interval  = _homeSearchTicks;
    _counter   = 0;
    setMoveDirection(-1);   // حرکت به سمت endstop = منفی
}

void Axis::beginBackoff() {
    _homeState = HOME_BACKOFF;
    _homeSteps = 0;
    _interval  = _homeBackoffTicks;
    // مکث کوتاه تا مکانیک آروم بشه (بدون delay — با شمارنده‌ی تیک)
    _counter   = (uint16_t)(((uint32_t)STEP_TICK_FREQ / 1000UL) * HOMING_DWELL_MS);
    setMoveDirection(+1);   // عقب‌نشینی از endstop = مثبت
}

void Axis::completeHoming() {
    _homeState = HOME_DONE;
    _backoffDone     = true;          // بک‌آف انجام و آزاد شدن سوئیچ تأیید شد
    _homeFaultCode   = HOME_FAULT_NONE;
    _currentPosition = 0;
    _targetPosition  = 0;
    _homed   = true;
    _homing  = false;
    _moving  = false;
    _active  = false;
    _counter = 0;
    _interval = 0;
}

void Axis::failHoming(uint8_t code) {
    _homeState     = HOME_FAILED;
    _homeFault     = true;
    _homeFaultCode = code;
    _backoffDone   = false;
    _homed     = false;
    _homing    = false;
    _moving    = false;
    _active    = false;
    _counter   = 0;
    _interval  = 0;
}

// ============================================
// Status
// ============================================
bool Axis::isHoming() const { return _homing; }
bool Axis::isHomed()  const { return _homed; }
bool Axis::isMoving() const { return _moving; }
bool Axis::homingFailed() const { return _homeFault; }

void Axis::clearHomingFault() { _homeFault = false; }

int32_t Axis::getCurrentPosition() const {
    uint8_t sreg = SREG;
    cli();
    int32_t v = _currentPosition;
    SREG = sreg;
    return v;
}

int32_t Axis::getTargetPosition() const {
    uint8_t sreg = SREG;
    cli();
    int32_t v = _targetPosition;
    SREG = sreg;
    return v;
}

bool Axis::isAtTarget() const {
    return (getCurrentPosition() == _targetPosition) && !_active;
}

uint32_t Axis::getCurrentSpeed() const {
    uint16_t iv = _interval;              // خواندن uint16 روی AVR اتمیک است
    if (iv == 0) return 0;
    return (uint32_t)STEP_TICK_FREQ / iv;
}

float Axis::getStepsPerDegree() const {
    return ((float)_stepsPerRev * (float)_microstep * _gearRatio) / 360.0f;
}

// ============================================
// Setters
// ============================================
void Axis::applyScales() {
    // سرعت مؤثر = مقدار پایه × ضریب پروفایل
    uint32_t ms = (uint32_t)((float)_baseMaxSpeed * _speedScale);
    if (ms < (uint32_t)RAMP_MIN_SPEED) ms = RAMP_MIN_SPEED;
    if (ms > (uint32_t)MAX_SPEED_LIMIT) ms = MAX_SPEED_LIMIT;
    // سقف فیزیکی: تایمر نمی‌تونه سریع‌تر از STEP_TICK_FREQ استپ بده
    if (ms > (uint32_t)(STEP_TICK_FREQ / 2)) ms = (uint32_t)(STEP_TICK_FREQ / 2);
    _maxSpeed = ms;

    uint32_t ac = (uint32_t)((float)_baseAcceleration * _accelScale);
    if (ac < 1) ac = 1;
    _acceleration = ac;

    uint32_t hs = _homingSpeed;
    if (hs > _maxSpeed) hs = _maxSpeed;
    if (hs < HOMING_MIN_SPEED) hs = HOMING_MIN_SPEED;
    _homingReleaseSpeed = (hs * HOMING_RELEASE_PERCENT) / 100;
    if (_homingReleaseSpeed < HOMING_MIN_SPEED) _homingReleaseSpeed = HOMING_MIN_SPEED;
}

void Axis::setSpeed(uint32_t speed) {
    _baseMaxSpeed = speed;
    applyScales();
}

void Axis::setBaseSpeed(uint32_t speed) {
    setSpeed(speed);
}

void Axis::setAcceleration(uint32_t acceleration) {
    _baseAcceleration = acceleration;
    applyScales();
}

void Axis::setBaseAcceleration(uint32_t acceleration) {
    setAcceleration(acceleration);
}

void Axis::setHomingSpeed(uint32_t speed) {
    if (speed < HOMING_MIN_SPEED) speed = HOMING_MIN_SPEED;
    _homingSpeed = speed;
    applyScales();
}

// ضریب پروفایل سرعت — روی حرکت بعدی اعمال می‌شه
void Axis::setSpeedScale(float mult) {
    if (!(mult > 0.0f)) mult = 1.0f;
    if (mult < 0.05f) mult = 0.05f;
    if (mult > 4.0f)  mult = 4.0f;
    _speedScale = mult;
    _accelScale = mult;      // شتاب هم همراه سرعت مقیاس می‌شه تا شکل رمپ حفظ بشه
    applyScales();
}

void Axis::setAccelScale(float mult) {
    if (!(mult > 0.0f)) mult = 1.0f;
    if (mult < 0.05f) mult = 0.05f;
    if (mult > 8.0f)  mult = 8.0f;
    _accelScale = mult;
    applyScales();
}

void Axis::setPosition(int32_t position) {
    uint8_t sreg = SREG;
    cli();
    _currentPosition = position;
    _targetPosition  = position;
    SREG = sreg;
}

void Axis::setDirectionInverted(bool invert) {
    _invertDir = invert;
}

void Axis::setEnabled(bool enabled) {
    if (enabled) enableMotor();
    else         disableMotor();
}

void Axis::setEmergencyStop(bool enabled) {
    _emergencyStop = enabled;
    if (enabled) stop();
}
