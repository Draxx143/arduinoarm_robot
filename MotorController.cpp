#include "MotorController.h"
#include <Arduino.h>

// Global instance for timer interrupt
MotorController* globalController = nullptr;

ISR(TIMER1_COMPA_vect) {
    if (globalController) {
        globalController->update();
    }
}

MotorController::MotorController() {
    _allHomed = false;
    _homingInProgress = false;
    _currentHomingAxis = 0;
    _estopActive = false;
    _estopDiv = 0;
    _idleDiv = 0;
    _anyActive = false;
    _estopReg = nullptr;
    _estopMask = 0;

    // Define homing order
    uint8_t order[] = HOMING_ORDER;
    for (int i = 0; i < NUM_AXES; i++) {
        _homingOrder[i] = order[i];
    }
}

MotorController::~MotorController() {
    for (int i = 0; i < NUM_AXES; i++) {
        delete _axes[i];
    }
}

void MotorController::init() {
    _axes[0] = new Axis(
        AXIS_X_STEP_PIN, AXIS_X_DIR_PIN, AXIS_X_ENABLE_PIN,
        AXIS_X_ENDSTOP_PIN, AXIS_X_INVERT_DIR,
        AXIS_X_STEPS_PER_REV, AXIS_X_MICROSTEP, AXIS_X_GEAR_RATIO,
        AXIS_X_MAX_SPEED, AXIS_X_ACCELERATION, AXIS_X_BACKOFF,
        AXIS_X_SOFT_MIN, AXIS_X_SOFT_MAX, AXIS_X_HOMING_SPEED
    );

    _axes[1] = new Axis(
        AXIS_Y_STEP_PIN, AXIS_Y_DIR_PIN, AXIS_Y_ENABLE_PIN,
        AXIS_Y_ENDSTOP_PIN, AXIS_Y_INVERT_DIR,
        AXIS_Y_STEPS_PER_REV, AXIS_Y_MICROSTEP, AXIS_Y_GEAR_RATIO,
        AXIS_Y_MAX_SPEED, AXIS_Y_ACCELERATION, AXIS_Y_BACKOFF,
        AXIS_Y_SOFT_MIN, AXIS_Y_SOFT_MAX, AXIS_Y_HOMING_SPEED
    );

    _axes[2] = new Axis(
        AXIS_Z_STEP_PIN, AXIS_Z_DIR_PIN, AXIS_Z_ENABLE_PIN,
        AXIS_Z_ENDSTOP_PIN, AXIS_Z_INVERT_DIR,
        AXIS_Z_STEPS_PER_REV, AXIS_Z_MICROSTEP, AXIS_Z_GEAR_RATIO,
        AXIS_Z_MAX_SPEED, AXIS_Z_ACCELERATION, AXIS_Z_BACKOFF,
        AXIS_Z_SOFT_MIN, AXIS_Z_SOFT_MAX, AXIS_Z_HOMING_SPEED
    );

    _axes[3] = new Axis(
        AXIS_A_STEP_PIN, AXIS_A_DIR_PIN, AXIS_A_ENABLE_PIN,
        AXIS_A_ENDSTOP_PIN, AXIS_A_INVERT_DIR,
        AXIS_A_STEPS_PER_REV, AXIS_A_MICROSTEP, AXIS_A_GEAR_RATIO,
        AXIS_A_MAX_SPEED, AXIS_A_ACCELERATION, AXIS_A_BACKOFF,
        AXIS_A_SOFT_MIN, AXIS_A_SOFT_MAX, AXIS_A_HOMING_SPEED
    );

    _axes[4] = new Axis(
        AXIS_B_STEP_PIN, AXIS_B_DIR_PIN, AXIS_B_ENABLE_PIN,
        AXIS_B_ENDSTOP_PIN, AXIS_B_INVERT_DIR,
        AXIS_B_STEPS_PER_REV, AXIS_B_MICROSTEP, AXIS_B_GEAR_RATIO,
        AXIS_B_MAX_SPEED, AXIS_B_ACCELERATION, AXIS_B_BACKOFF,
        AXIS_B_SOFT_MIN, AXIS_B_SOFT_MAX, AXIS_B_HOMING_SPEED
    );

    for (int i = 0; i < NUM_AXES; i++) {
        _axes[i]->init();
    }

    #ifdef EMERGENCY_STOP_PIN
    pinMode(EMERGENCY_STOP_PIN, INPUT_PULLUP);
    _estopReg  = portInputRegister(digitalPinToPort(EMERGENCY_STOP_PIN));
    _estopMask = digitalPinToBitMask(EMERGENCY_STOP_PIN);
    #endif

    enableAllMotors();

    globalController = this;
}

// ============================================
// ISR — هر STEP_TICK_FREQ بار در ثانیه
// ============================================
// نکته‌ی مهم: قبلاً این حلقه 1kHz بود و در هر تیک فقط یک استپ صادر می‌شد،
// یعنی سقف سرعت کل دستگاه روی 1000 steps/s قفل بود و بالا بردن
// MAX_SPEED در Config.h هیچ اثری نداشت.
void MotorController::update() {
    // ----------------------------------------------------------
    // مسیر سبک: وقتی هیچ محوری فعال نیست، فقط هر 1ms یک‌بار بررسی
    // می‌کنیم. این‌طور تایمر 20kHz در حالت بی‌کاری CPU را نمی‌خورد.
    // (حرکت نهایتاً با 1ms تأخیر شروع می‌شود که محسوس نیست)
    // ----------------------------------------------------------
    if (!_anyActive) {
        if (++_idleDiv < TICKS_PER_CONTROL) return;
        _idleDiv = 0;

        #ifdef EMERGENCY_STOP_PIN
        if (_estopReg && ((*_estopReg & _estopMask) == 0)) {
            emergencyStop();
            return;
        }
        #endif

        for (uint8_t i = 0; i < NUM_AXES; i++) {
            if (_axes[i]->isActive()) { _anyActive = true; break; }
        }
        if (!_anyActive) return;
    }

    #ifdef EMERGENCY_STOP_PIN
    // بررسی استپ اضطراری با نرخ CONTROL_LOOP_FREQ (نه هر تیک) تا ISR سبک بماند
    if (++_estopDiv >= TICKS_PER_CONTROL) {
        _estopDiv = 0;
        if (_estopReg && ((*_estopReg & _estopMask) == 0)) {
            emergencyStop();
        }
    }
    #endif

    Axis* pulsed[NUM_AXES];
    uint8_t n = 0;
    bool any = false;

    for (uint8_t i = 0; i < NUM_AXES; i++) {
        Axis* a = _axes[i];
        if (a->tick()) {
            pulsed[n++] = a;
            any = true;
        } else if (a->isActive()) {
            any = true;
        }
    }
    _anyActive = any;

    if (n) {
        // یک پهنای پالس مشترک برای همه‌ی محورها (به‌جای delay برای هر محور)
        delayMicroseconds(STEP_PULSE_US);
        while (n) {
            pulsed[--n]->endPulse();
        }
    }
}

Axis* MotorController::getAxis(uint8_t index) {
    if (index < NUM_AXES) {
        return _axes[index];
    }
    return nullptr;
}

void MotorController::enableAllMotors() {
    for (int i = 0; i < NUM_AXES; i++) _axes[i]->enableMotor();
}

void MotorController::disableAllMotors() {
    for (int i = 0; i < NUM_AXES; i++) _axes[i]->disableMotor();
}

void MotorController::emergencyStop() {
    _estopActive = true;
    for (int i = 0; i < NUM_AXES; i++) {
        _axes[i]->setEmergencyStop(true);
    }
    _homingInProgress = false;
}

void MotorController::clearEmergencyStop() {
    _estopActive = false;
    for (int i = 0; i < NUM_AXES; i++) {
        _axes[i]->setEmergencyStop(false);
    }
}

// ============================================
// Homing
// ============================================
bool MotorController::startHoming() {
    if (_homingInProgress) return false;

    enableAllMotors();

    for (int i = 0; i < NUM_AXES; i++) _axes[i]->clearHomingFault();

    _currentHomingAxis = 0;
    _allHomed = false;

    bool started = _axes[_homingOrder[0]]->startHoming();
    _homingInProgress = started;

    if (!started) {
        Serial.print(F("!! Axis "));
        Serial.print(_homingOrder[0] + 1);
        Serial.println(F(" refused to start homing (already homing/moving)"));
    }
    return started;
}

bool MotorController::startHomingAxis(uint8_t axis) {
    if (axis >= NUM_AXES) return false;
    if (_homingInProgress) return false;

    enableAllMotors();
    _axes[axis]->clearHomingFault();

    _currentHomingAxis = 255;  // نشانگر حالت تک‌محوری
    _allHomed = false;

    bool started = _axes[axis]->startHoming();
    _homingInProgress = started;

    if (!started) {
        Serial.print(F("!! Axis "));
        Serial.print(axis + 1);
        Serial.println(F(" refused to start homing"));
    }
    return started;
}

// گزارش وضعیت endstop ها.
// آزادسازی واقعی endstop حالا داخل ماشین حالت هومینگ و به‌صورت
// غیرمسدودکننده انجام می‌شه (قبلاً اینجا با delayMicroseconds تا 5 ثانیه
// کل دستگاه قفل می‌شد).
void MotorController::backoffAllFromEndstops() {
    Serial.println(F(">> Endstop states:"));
    for (int i = 0; i < NUM_AXES; i++) {
        Serial.print(F("  Axis "));
        Serial.print(i + 1);
        if (_axes[i]->endstopPressed()) {
            Serial.println(F(": ACTIVE (homing will release it automatically)"));
        } else {
            Serial.println(F(": free"));
        }
    }
}

void MotorController::smartHoming() {
    if (_homingInProgress) return;

    enableAllMotors();
    backoffAllFromEndstops();
    Serial.println(F(">> Smart homing: all axes (order Z, Y, X, A, B)"));
    startHoming();
}

void MotorController::smartHomingAxis(uint8_t axis) {
    if (axis >= NUM_AXES) return;
    if (_homingInProgress) return;

    enableAllMotors();

    Serial.print(F(">> Smart homing axis "));
    Serial.print(axis + 1);
    Serial.print(F(" at "));
    Serial.print(_axes[axis]->getHomingSpeed());
    Serial.println(F(" steps/s"));

    if (_axes[axis]->endstopPressed()) {
        Serial.println(F("   Endstop ACTIVE - will release it first"));
    }

    startHomingAxis(axis);
}

void MotorController::processHoming() {
    if (!_homingInProgress) return;

    // ---- حالت تک‌محوری ----
    if (_currentHomingAxis == 255) {
        for (int i = 0; i < NUM_AXES; i++) {
            if (_axes[i]->isHoming()) return;   // هنوز در حال هوم شدن
        }
        _homingInProgress = false;
        _currentHomingAxis = 0;

        for (int i = 0; i < NUM_AXES; i++) {
            if (_axes[i]->homingFailed()) {
                Serial.print(F("!! Axis "));
                Serial.print(i + 1);
                Serial.println(F(" HOMING FAILED - endstop not reached (check wiring/limit)"));
                return;
            }
        }
        Serial.println(F(">> Single axis homing complete!"));
        return;
    }

    // ---- هومینگ کامل همه‌ی محورها ----
    uint8_t currentAxis = _homingOrder[_currentHomingAxis];

    if (_axes[currentAxis]->homingFailed()) {
        _homingInProgress = false;
        Serial.print(F("!! Axis "));
        Serial.print(currentAxis + 1);
        Serial.println(F(" HOMING FAILED - sequence aborted"));
        return;
    }

    if (!_axes[currentAxis]->isHoming() && _axes[currentAxis]->isHomed()) {
        _currentHomingAxis++;

        if (_currentHomingAxis >= NUM_AXES) {
            _homingInProgress = false;
            _allHomed = true;
            Serial.println(F(">> All axes homed successfully!"));
            return;
        }

        _axes[_homingOrder[_currentHomingAxis]]->startHoming();
    }
}

bool MotorController::isHoming() const {
    return _homingInProgress;
}

bool MotorController::homingFailed() const {
    for (int i = 0; i < NUM_AXES; i++) {
        if (_axes[i]->homingFailed()) return true;
    }
    return false;
}

void MotorController::abortHoming() {
    for (int i = 0; i < NUM_AXES; i++) _axes[i]->stop();
    _homingInProgress = false;
    _currentHomingAxis = 0;
}

bool MotorController::allHomed() const {
    return _allHomed;
}

// ============================================
// Move commands
// ============================================
void MotorController::moveTo(uint8_t axis, int32_t position) {
    if (axis < NUM_AXES) _axes[axis]->moveTo(position);
}

void MotorController::moveRelative(uint8_t axis, int32_t delta) {
    if (axis < NUM_AXES) _axes[axis]->moveRelative(delta);
}

void MotorController::moveAllAxes(const int32_t positions[]) {
    if (isHoming()) {
        Serial.println(F("!! moveAllAxes rejected: homing in progress"));
        return;
    }

    // چک کردن soft limits قبل از حرکت
    for (int i = 0; i < NUM_AXES; i++) {
        int32_t softMin = _axes[i]->getSoftMin();
        int32_t softMax = _axes[i]->getSoftMax();

        if (positions[i] < softMin || positions[i] > softMax) {
            Serial.print(F("!! moveAllAxes: Axis "));
            Serial.print(i + 1);
            Serial.print(F(" out of range: "));
            Serial.print(positions[i]);
            Serial.print(F(" (allowed: "));
            Serial.print(softMin);
            Serial.print(F(" to "));
            Serial.print(softMax);
            Serial.println(F("). Command REJECTED."));
            return;   // هیچ حرکتی نکن
        }
    }

    // حرکت همزمان همه‌ی محورها
    for (int i = 0; i < NUM_AXES; i++) {
        if (_axes[i]->isEnabled()) {
            _axes[i]->moveTo(positions[i]);
        }
    }
}

void MotorController::moveAllAxesTimed(const int32_t positions[], uint32_t durationMs) {
    if (isHoming()) {
        Serial.println(F("!! moveAllAxesTimed rejected: homing in progress"));
        return;
    }

    for (int i = 0; i < NUM_AXES; i++) {
        if (positions[i] < _axes[i]->getSoftMin() || positions[i] > _axes[i]->getSoftMax()) {
            Serial.print(F("!! moveAllAxesTimed: Axis "));
            Serial.print(i + 1);
            Serial.print(F(" out of range: "));
            Serial.println(positions[i]);
            return;
        }
    }

    // اول کوتاه‌ترین زمان ممکن را برای هر محور پیدا می‌کنیم تا همه‌ی محورها
    // با یک زمان مشترک (و هم‌زمان) به مقصد برسند
    uint32_t T = durationMs;
    for (int i = 0; i < NUM_AXES; i++) {
        if (!_axes[i]->isEnabled()) continue;
        uint32_t tmin = _axes[i]->minDurationMs(positions[i]);
        if (tmin > T) T = tmin;
    }
    if (T > durationMs) {
        Serial.print(F(">> Duration raised to "));
        Serial.print(T);
        Serial.println(F(" ms (limited by the slowest axis)"));
    }

    for (int i = 0; i < NUM_AXES; i++) {
        if (_axes[i]->isEnabled()) {
            _axes[i]->moveToTimed(positions[i], T);
        }
    }
}

void MotorController::streamAllAxes(const int32_t positions[]) {
    for (int i = 0; i < NUM_AXES; i++) {
        if (_axes[i]->isEnabled()) {
            _axes[i]->streamTo(positions[i]);
        }
    }
}

bool MotorController::isAnyMoving() const {
    for (int i = 0; i < NUM_AXES; i++) {
        if (_axes[i]->isMoving()) return true;
    }
    return false;
}

bool MotorController::isAnyActive() const {
    for (int i = 0; i < NUM_AXES; i++) {
        if (_axes[i]->isActive()) return true;
    }
    return false;
}

// ============================================
// Speed profile — حالا واقعاً روی محورها اعمال می‌شه
// ============================================
// (قبلاً SpeedProfileManager فقط ضریب‌ها را در حافظه نگه می‌داشت و هیچ‌وقت
//  به موتورها نمی‌رسوند، برای همین دستور `profile fast` هیچ اثری نداشت.)
void MotorController::setSpeedScale(float mult) {
    for (int i = 0; i < NUM_AXES; i++) _axes[i]->setSpeedScale(mult);
}

void MotorController::setAccelScale(float mult) {
    for (int i = 0; i < NUM_AXES; i++) _axes[i]->setAccelScale(mult);
}

float MotorController::getSpeedScale() const {
    if (_axes[0] && _axes[0]->getBaseMaxSpeed() > 0) {
        return (float)_axes[0]->getMaxSpeed() / (float)_axes[0]->getBaseMaxSpeed();
    }
    return 1.0f;
}

void MotorController::setAxisSpeed(uint8_t axis, uint32_t stepsPerSec) {
    if (axis < NUM_AXES) _axes[axis]->setSpeed(stepsPerSec);
}

void MotorController::setAxisAcceleration(uint8_t axis, uint32_t stepsPerSec2) {
    if (axis < NUM_AXES) _axes[axis]->setAcceleration(stepsPerSec2);
}

void MotorController::setAxisHomingSpeed(uint8_t axis, uint32_t stepsPerSec) {
    if (axis < NUM_AXES) _axes[axis]->setHomingSpeed(stepsPerSec);
}

// ============================================
// Status
// ============================================
void MotorController::getJointStates(float* positions, int32_t* rawPositions,
                                     bool* moving, bool* homed, bool* endstopStates) {
    for (int i = 0; i < NUM_AXES; i++) {
        int32_t raw = _axes[i]->getCurrentPosition();
        if (positions)      positions[i] = (float)raw;
        if (rawPositions)   rawPositions[i] = raw;
        if (moving)         moving[i] = _axes[i]->isMoving();
        if (homed)          homed[i] = _axes[i]->isHomed();
        if (endstopStates)  endstopStates[i] = _axes[i]->getEndstopState();
    }
}

// ============================================
// Timer — تایمر ۱ در مد CTC
// ============================================
void MotorController::startControlLoop() {
    cli();
    TCCR1A = 0;
    TCCR1B = 0;
    TCNT1  = 0;
    OCR1A  = TIMER_OCR_VALUE;          // 99 → 20kHz با prescaler=8
    TCCR1B |= (1 << WGM12);            // CTC mode
    TCCR1B |= TIMER_OCR_BITS;          // prescaler = 8
    TIMSK1 |= (1 << OCIE1A);
    sei();

    Serial.print(F(">> Step engine: "));
    Serial.print((long)STEP_TICK_FREQ);
    Serial.print(F(" Hz tick, OCR1A="));
    Serial.print((int)TIMER_OCR_VALUE);
    Serial.print(F(", pulse="));
    Serial.print((int)STEP_PULSE_US);
    Serial.println(F("us"));
}

void MotorController::stopControlLoop() {
    TIMSK1 &= ~(1 << OCIE1A);
}
