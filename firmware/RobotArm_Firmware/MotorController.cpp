#include "MotorController.h"
#include "SerialCLI.h"
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
    // Create all axes
    _axes[0] = new Axis(
        AXIS_X_STEP_PIN, AXIS_X_DIR_PIN, AXIS_X_ENABLE_PIN,
        AXIS_X_ENDSTOP_PIN, AXIS_X_INVERT_DIR,
        AXIS_X_STEPS_PER_REV, AXIS_X_MICROSTEP, AXIS_X_GEAR_RATIO,
        AXIS_X_MAX_SPEED, AXIS_X_ACCELERATION, AXIS_X_BACKOFF,
        AXIS_X_SOFT_MIN, AXIS_X_SOFT_MAX
    );
    
    _axes[1] = new Axis(
        AXIS_Y_STEP_PIN, AXIS_Y_DIR_PIN, AXIS_Y_ENABLE_PIN,
        AXIS_Y_ENDSTOP_PIN, AXIS_Y_INVERT_DIR,
        AXIS_Y_STEPS_PER_REV, AXIS_Y_MICROSTEP, AXIS_Y_GEAR_RATIO,
        AXIS_Y_MAX_SPEED, AXIS_Y_ACCELERATION, AXIS_Y_BACKOFF,
        AXIS_Y_SOFT_MIN, AXIS_Y_SOFT_MAX
    );
    
    _axes[2] = new Axis(
        AXIS_Z_STEP_PIN, AXIS_Z_DIR_PIN, AXIS_Z_ENABLE_PIN,
        AXIS_Z_ENDSTOP_PIN, AXIS_Z_INVERT_DIR,
        AXIS_Z_STEPS_PER_REV, AXIS_Z_MICROSTEP, AXIS_Z_GEAR_RATIO,
        AXIS_Z_MAX_SPEED, AXIS_Z_ACCELERATION, AXIS_Z_BACKOFF,
        AXIS_Z_SOFT_MIN, AXIS_Z_SOFT_MAX
    );
    
    _axes[3] = new Axis(
        AXIS_A_STEP_PIN, AXIS_A_DIR_PIN, AXIS_A_ENABLE_PIN,
        AXIS_A_ENDSTOP_PIN, AXIS_A_INVERT_DIR,
        AXIS_A_STEPS_PER_REV, AXIS_A_MICROSTEP, AXIS_A_GEAR_RATIO,
        AXIS_A_MAX_SPEED, AXIS_A_ACCELERATION, AXIS_A_BACKOFF,
        AXIS_A_SOFT_MIN, AXIS_A_SOFT_MAX
    );
    
    _axes[4] = new Axis(
        AXIS_B_STEP_PIN, AXIS_B_DIR_PIN, AXIS_B_ENABLE_PIN,
        AXIS_B_ENDSTOP_PIN, AXIS_B_INVERT_DIR,
        AXIS_B_STEPS_PER_REV, AXIS_B_MICROSTEP, AXIS_B_GEAR_RATIO,
        AXIS_B_MAX_SPEED, AXIS_B_ACCELERATION, AXIS_B_BACKOFF,
        AXIS_B_SOFT_MIN, AXIS_B_SOFT_MAX
    );
    
    // Initialize all axes
    for (int i = 0; i < NUM_AXES; i++) {
        _axes[i]->init();
    }
    enableAllMotors();
    
    globalController = this;
    
    // Setup emergency stop pin
    #ifdef EMERGENCY_STOP_PIN
    pinMode(EMERGENCY_STOP_PIN, INPUT_PULLUP);
    #endif
}

void MotorController::update() {
    // Check emergency stop
    #ifdef EMERGENCY_STOP_PIN
    if (digitalRead(EMERGENCY_STOP_PIN) == LOW) {
        emergencyStop();
    }
    #endif
    
    // Update all axes
    for (int i = 0; i < NUM_AXES; i++) {
        _axes[i]->update();
    }
}

Axis* MotorController::getAxis(uint8_t index) {
    if (index < NUM_AXES) {
        return _axes[index];
    }
    return nullptr;
}

void MotorController::enableAllMotors() {
    for (int i = 0; i < NUM_AXES; i++) {
        _axes[i]->enableMotor();
    }
}

void MotorController::disableAllMotors() {
    for (int i = 0; i < NUM_AXES; i++) {
        _axes[i]->disableMotor();
    }
}

void MotorController::emergencyStop() {
    for (int i = 0; i < NUM_AXES; i++) {
        _axes[i]->setEmergencyStop(true);
        _axes[i]->stop();
    }
    _homingInProgress = false;
}

void MotorController::clearEmergencyStop() {
    for (int i = 0; i < NUM_AXES; i++) {
        _axes[i]->setEmergencyStop(false);
    }
}

bool MotorController::startHoming() {
    if (_homingInProgress) return false;
    
    enableAllMotors();
    
    _currentHomingAxis = 0;
    _allHomed = false;
    
    bool started = _axes[_homingOrder[0]]->startHoming();
    _homingInProgress = started;
    
    #if DEBUG_SERIAL
    if (!started) {
        C_PRINT("!! Axis ");
        C_PRINT(_homingOrder[0] + 1);
        C_PRINTLN(" refused to start homing (already _homing or _moving)");
    }
    #endif
    
    return started;
}

// FIX: هوم کردن یک محور خاص
bool MotorController::startHomingAxis(uint8_t axis) {
    if (axis >= NUM_AXES) return false;
    if (_homingInProgress) return false;
    
    enableAllMotors();
    
    _currentHomingAxis = 255;  // FIX: نشانگر حالت تک‌محوری
    _allHomed = false;
    
    bool started = _axes[axis]->startHoming();
    _homingInProgress = started;
    
    #if DEBUG_SERIAL
    if (!started) {
        C_PRINT("!! Axis ");
        C_PRINT(axis + 1);
        C_PRINTLN(" refused to start homing");
    } else {
        C_PRINT(">> Homing axis ");
        C_PRINTLN(axis + 1);
    }
    #endif
    
    return started;
}

// FIX: برگشت همه محورها از endstop
void MotorController::backoffAllFromEndstops() {
    C_PRINTLN(">> Checking endstops and backing off if needed...");
    
    for (int i = 0; i < NUM_AXES; i++) {
        if (_axes[i]->getEndstopState() == LOW) {
            C_PRINT("  Axis ");
            C_PRINT(i + 1);
            C_PRINT(": endstop ACTIVE, backing off...");
            _axes[i]->backoffFromEndstop();
            C_PRINTLN(" done");
        } else {
            C_PRINT("  Axis ");
            C_PRINT(i + 1);
            C_PRINTLN(": endstop free");
        }
    }
    
    C_PRINTLN(">> Endstop check complete");
}

// FIX: هوم هوشمند - اول عقب‌نشینی، بعد هوم
void MotorController::smartHoming() {
    if (_homingInProgress) return;
    
    enableAllMotors();
    
    // مرحله ۱: بررسی و عقب‌نشینی از endstop
    backoffAllFromEndstops();
    
    // مرحله ۲: شروع هوم معمولی
    _currentHomingAxis = 0;
    _allHomed = false;
    
    bool started = _axes[_homingOrder[0]]->startHoming();
    _homingInProgress = started;
    
    #if DEBUG_SERIAL
    if (!started) {
        C_PRINT("!! Axis ");
        C_PRINT(_homingOrder[0] + 1);
        C_PRINTLN(" refused to start homing");
    }
    #endif
}

// FIX: هوم هوشمند یک محور
void MotorController::smartHomingAxis(uint8_t axis) {
    if (axis >= NUM_AXES) return;
    if (_homingInProgress) return;
    
    enableAllMotors();
    
    C_PRINT(">> Smart homing axis ");
    C_PRINTLN(axis + 1);
    
    // بررسی endstop
    if (_axes[axis]->getEndstopState() == LOW) {
        C_PRINT("  Endstop ACTIVE, backing off...");
        _axes[axis]->backoffFromEndstop();
        C_PRINTLN(" done");
    } else {
        C_PRINTLN("  Endstop free");
    }
    
    // شروع هوم
    _currentHomingAxis = 255;  // حالت تک‌محوری
    _allHomed = false;
    
    bool started = _axes[axis]->startHoming();
    _homingInProgress = started;
    
    #if DEBUG_SERIAL
    if (!started) {
        C_PRINT("!! Axis ");
        C_PRINT(axis + 1);
        C_PRINTLN(" refused to start homing");
    }
    #endif
}

// FIX: فعال‌سازی یک محور
void MotorController::enableAxis(uint8_t axis) {
    if (axis < NUM_AXES) {
        _axes[axis]->enableMotor();
        C_PRINT(">> Axis ");
        C_PRINT(axis + 1);
        C_PRINTLN(" enabled");
    }
}

// FIX: غیرفعال‌سازی یک محور
void MotorController::disableAxis(uint8_t axis) {
    if (axis < NUM_AXES) {
        _axes[axis]->disableMotor();
        C_PRINT(">> Axis ");
        C_PRINT(axis + 1);
        C_PRINTLN(" disabled");
    }
}

void MotorController::processHoming() {
    if (!_homingInProgress) return;
    
    // FIX: حالت تک‌محوری
    if (_currentHomingAxis == 255) {
        // بررسی همه محورها
        for (int i = 0; i < NUM_AXES; i++) {
            if (_axes[i]->isHoming()) {
                return;  // هنوز در حال هوم شدنه
            }
        }
        // هیچ محوری در حال هوم شدن نیست
        _homingInProgress = false;
        _currentHomingAxis = 0;
        C_PRINTLN(">> Single axis homing complete!");
        return;
    }
    
    // حالت هومینگ کلی (همه محورها)
    uint8_t currentAxis = _homingOrder[_currentHomingAxis];
    
    if (!_axes[currentAxis]->isHoming() && _axes[currentAxis]->isHomed()) {
        _currentHomingAxis++;
        
        if (_currentHomingAxis >= NUM_AXES) {
            _homingInProgress = false;
            _allHomed = true;
            if (DEBUG_SERIAL) {
                C_PRINTLN("All axes homed successfully!");
            }
            return;
        }
        
        _axes[_homingOrder[_currentHomingAxis]]->startHoming();
    }
}

bool MotorController::isHoming() const {
    return _homingInProgress;
}

void MotorController::abortHoming() {
    for (int i = 0; i < NUM_AXES; i++) {
        _axes[i]->stop();
    }
    _homingInProgress = false;
    _currentHomingAxis = 0;
}

bool MotorController::allHomed() const {
    return _allHomed;
}

void MotorController::moveTo(uint8_t axis, int32_t position) {
    if (axis < NUM_AXES) {
        _axes[axis]->moveTo(position);
    }
}

void MotorController::moveRelative(uint8_t axis, int32_t delta) {
    if (axis < NUM_AXES) {
        _axes[axis]->moveRelative(delta);
    }
}

void MotorController::moveAllAxes(const int32_t positions[]) {
    // FIX: چک کردن soft limits قبل از حرکت
    bool allValid = true;
    
    for (int i = 0; i < NUM_AXES; i++) {
        int32_t softMin = _axes[i]->getSoftMin();
        int32_t softMax = _axes[i]->getSoftMax();
        
        if (positions[i] < softMin || positions[i] > softMax) {
            C_PRINT("!! moveAllAxes: Axis ");
            C_PRINT(i + 1);
            C_PRINT(" out of range: ");
            C_PRINT(positions[i]);
            C_PRINT(" (allowed: ");
            C_PRINT(softMin);
            C_PRINT(" to ");
            C_PRINT(softMax);
            C_PRINTLN("). Command REJECTED.");
            allValid = false;
            break;
        }
    }
    
    if (!allValid) {
        return;  // هیچ حرکتی نکن
    }
    
    // FIX: حرکت همزمان همه محورها
    for (int i = 0; i < NUM_AXES; i++) {
        if (_axes[i]->isEnabled()) {
            _axes[i]->moveTo(positions[i]);
        }
    }
}

void MotorController::getJointStates(float* positions, int32_t* rawPositions, 
                                      bool* moving, bool* homed, bool* endstopStates) {
    for (int i = 0; i < NUM_AXES; i++) {
        if (positions) positions[i] = _axes[i]->getCurrentPosition();
        if (rawPositions) rawPositions[i] = _axes[i]->getCurrentPosition();
        if (moving) moving[i] = _axes[i]->isMoving();
        if (homed) homed[i] = _axes[i]->isHomed();
        if (endstopStates) endstopStates[i] = _axes[i]->getEndstopState();
    }
}

void MotorController::startControlLoop() {
    cli();
    TCCR1A = 0;
    TCCR1B = 0;
    TCNT1 = 0;
    OCR1A = (TIMER_TICK_FREQ / CONTROL_LOOP_FREQ) - 1;
    TCCR1B |= (1 << WGM12);
    TCCR1B |= (1 << CS11) | (1 << CS10);
    TIMSK1 |= (1 << OCIE1A);
    sei();
}

void MotorController::stopControlLoop() {
    TIMSK1 &= ~(1 << OCIE1A);
}