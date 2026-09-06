#include "Axis.h"
#include <Arduino.h>
#include <math.h>

#ifndef DEBUG_SERIAL
#define DEBUG_SERIAL false
#endif

// Constructor
Axis::Axis(uint8_t stepPin, uint8_t dirPin, uint8_t enablePin,
           uint8_t endstopPin, bool invertDir, uint16_t stepsPerRev,
           uint8_t microstep, float gearRatio, uint32_t maxSpeed,
           uint32_t acceleration, int32_t backoff,
           int32_t softMin, int32_t softMax)
    : _stepPin(stepPin), _dirPin(dirPin), _enablePin(enablePin),
      _endstopPin(endstopPin), _invertDir(invertDir),
      _stepsPerRev(stepsPerRev), _microstep(microstep),
      _gearRatio(gearRatio), _maxSpeed(maxSpeed),
      _acceleration(acceleration), _backoff(backoff),
      _softMin(softMin), _softMax(softMax) {
    
    _currentPosition = 0;
    _targetPosition = 0;
    _stepCount = 0;
    _currentSpeed = 0;
    _targetSpeed = 0;
    _moving = false;
    _homing = false;
    _homed = false;
    _enabled = false;
    _emergencyStop = false;
    _endstopTriggered = false;
    _stepInterval = 0;
    _lastStepTime = 0;
    _remainingSteps = 0;
    _accelSteps = 0;
    _decelSteps = 0;
    _cruiseSteps = 0;
    _accelStepCount = 0;
    _decelStepCount = 0;
    _accelerationPhase = false;
    _decelerationPhase = false;
    _cruisePhase = false;
}

void Axis::init() {
    pinMode(_stepPin, OUTPUT);
    pinMode(_dirPin, OUTPUT);
    pinMode(_enablePin, OUTPUT);
    pinMode(_endstopPin, INPUT_PULLUP);
    
    digitalWrite(_stepPin, LOW);
    digitalWrite(_dirPin, LOW);
    digitalWrite(_enablePin, HIGH);
    
    _enabled = false;
    _homed = false;
}

void Axis::enableMotor() {
    digitalWrite(_enablePin, LOW);
    _enabled = true;
}

void Axis::disableMotor() {
    digitalWrite(_enablePin, HIGH);
    _enabled = false;
}

bool Axis::isEnabled() const {
    return _enabled;
}

void Axis::moveTo(int32_t targetPosition) {
    if (!_enabled || _homing || _emergencyStop) return;
    
    // FIX: اگه خارج از محدوده بود، رد کن و اخطار بده
    if (targetPosition < _softMin || targetPosition > _softMax) {
        Serial.print("!! ERROR: Target position ");
        Serial.print(targetPosition);
        Serial.print(" is OUT OF RANGE. Soft limits: ");
        Serial.print(_softMin);
        Serial.print(" to ");
        Serial.print(_softMax);
        Serial.println(" steps. Command REJECTED.");
        return;
    }
    
    // FIX: اگه target == current، کاری نکن (جلوگیری از حرکت اشتباه)
    if (targetPosition == _currentPosition) {
        _moving = false;
        return;
    }
    
    _targetPosition = targetPosition;
    _remainingSteps = _targetPosition - _currentPosition;
    
    if (_remainingSteps == 0) {
        _moving = false;
        return;
    }
    
    setDirection(_targetPosition);
    
    uint32_t absSteps = abs(_remainingSteps);
    _accelSteps = calculateAccelerationSteps();
    _decelSteps = _accelSteps;
    _cruiseSteps = absSteps - _accelSteps - _decelSteps;
    
    if ((int32_t)_cruiseSteps < 0) {
        _accelSteps = absSteps / 2;
        _decelSteps = absSteps - _accelSteps;
        _cruiseSteps = 0;
    }
    
    _accelStepCount = 0;
    _decelStepCount = 0;
    _accelerationPhase = true;
    _decelerationPhase = false;
    _cruisePhase = false;
    _currentSpeed = 0;
    _stepInterval = 0;
    _moving = true;
    _stepCount = 0;
    _lastStepTime = micros();
}

void Axis::moveRelative(int32_t deltaPosition) {
    moveTo(_currentPosition + deltaPosition);
}

void Axis::stop() {
    _moving = false;
    _homing = false;
    _currentSpeed = 0;
    _stepInterval = 0;
}

void Axis::setDirection(int32_t target) {
    // FIX: اگه target == current، تغییر نکن
    if (target == _currentPosition) {
        return;
    }
    
    // FIX: منطق صحیح برای INVERT_DIR
    bool dir = (target > _currentPosition);
    if (_invertDir) {
        dir = !dir;
    }
    digitalWrite(_dirPin, dir ? HIGH : LOW);
}

bool Axis::startHoming() {
    if (_homing || _moving) return false;
    
    if (!_enabled) enableMotor();
    
    _homing = true;
    _homed = false;
    _endstopTriggered = false;
    
    setDirection(_currentPosition - 1);
    
    _currentSpeed = 100;
    _stepInterval = 1000000UL / _currentSpeed;
    _lastStepTime = micros();
    _moving = true;
    
    return true;
}

void Axis::processHoming() {
    if (!_homing) return;
    
    if (digitalRead(_endstopPin) == LOW) {
        _endstopTriggered = true;
        _moving = false;
        _homing = false;
        
        delay(10);
        
        setDirection(_currentPosition + 1);
        
        for (int32_t i = 0; i < _backoff; i++) {
            digitalWrite(_stepPin, HIGH);
            delayMicroseconds(500);
            digitalWrite(_stepPin, LOW);
            delayMicroseconds(500);
            _currentPosition++;
        }
        
        _currentPosition = 0;
        _targetPosition = 0;
        _homed = true;
        return;
    }
    
    if (_moving) {
        uint32_t currentMicros = micros();
        if (_stepInterval > 0 && currentMicros - _lastStepTime >= _stepInterval) {
            digitalWrite(_stepPin, HIGH);
            delayMicroseconds(10);
            digitalWrite(_stepPin, LOW);
            
            _currentPosition--;
            _lastStepTime = currentMicros;
        }
    }
}

bool Axis::isHoming() const {
    return _homing;
}

bool Axis::isHomed() const {
    return _homed;
}

int32_t Axis::getCurrentPosition() const {
    return _currentPosition;
}

int32_t Axis::getTargetPosition() const {
    return _targetPosition;
}

bool Axis::isMoving() const {
    return _moving;
}

bool Axis::isAtTarget() const {
    return (_currentPosition == _targetPosition);
}

bool Axis::getEndstopState() const {
    return digitalRead(_endstopPin);
}

void Axis::update() {
    if (_emergencyStop) {
        stop();
        return;
    }
    
    if (!_moving && !_homing) return;
    
    if (_homing) {
        processHoming();
        return;
    }
    
    if (_currentPosition == _targetPosition) {
        _moving = false;
        _currentSpeed = 0;
        _stepInterval = 0;
        return;
    }
    
    if (_stepInterval == 0) {
        generateStep();
        _lastStepTime = micros();
        updateSpeedProfile();
        return;
    }
    
    uint32_t currentMicros = micros();
    if (currentMicros - _lastStepTime >= _stepInterval) {
        generateStep();
        _lastStepTime = currentMicros;
        updateSpeedProfile();
    }
}

void Axis::updateSpeedProfile() {
    if (!_moving) return;
    
    const uint32_t MIN_SPEED = 200;    // FIX: افزایش
    
    if (_accelerationPhase) {
        _accelStepCount++;
        
        float t = (float)_accelStepCount / _accelSteps;
        if (t > 1.0f) t = 1.0f;
        
        float sCurve;
        if (t < 0.15f) {
            sCurve = sqrtf(t / 0.15f) * 0.7f;
        } else {
            float t2 = (t - 0.15f) / 0.85f;
            sCurve = 0.7f + 0.3f * (1.0f - (1.0f - t2) * (1.0f - t2));
        }
        
        _currentSpeed = (uint32_t)(_maxSpeed * sCurve);
        if (_currentSpeed < MIN_SPEED) _currentSpeed = MIN_SPEED;
        _stepInterval = 1000000UL / _currentSpeed;
        
        if (_accelStepCount >= _accelSteps) {
            _accelerationPhase = false;
            _cruisePhase = true;
            _currentSpeed = _maxSpeed;
            _stepInterval = 1000000UL / _maxSpeed;
        }
    } else if (_cruisePhase) {
        if (_cruiseSteps > 0) _cruiseSteps--;
        _stepInterval = 1000000UL / _currentSpeed;
        if (_cruiseSteps == 0) {
            _cruisePhase = false;
            _decelerationPhase = true;
            _decelStepCount = 0;
        }
    } else if (_decelerationPhase) {
        _decelStepCount++;
        
        float t = (float)_decelStepCount / _decelSteps;
        if (t > 1.0f) t = 1.0f;
        
        float sCurve;
        if (t < 0.85f) {
            float t2 = t / 0.85f;
            sCurve = 1.0f - 0.7f * t2 * t2;
        } else {
            float t2 = (t - 0.85f) / 0.15f;
            sCurve = 0.3f * (1.0f - t2) * (1.0f - t2);
        }
        
        _currentSpeed = (uint32_t)(_maxSpeed * sCurve);
        if (_currentSpeed < MIN_SPEED) _currentSpeed = MIN_SPEED;
        _stepInterval = 1000000UL / _currentSpeed;
        
        if (_decelStepCount >= _decelSteps) {
            _decelerationPhase = false;
            _moving = false;
            _currentSpeed = 0;
            _stepInterval = 0;
        }
    }
}

void Axis::generateStep() {
    // FIX: استفاده از PORT برای سرعت بالا
    volatile uint8_t* stepPort = portOutputRegister(digitalPinToPort(_stepPin));
    uint8_t stepMask = digitalPinToBitMask(_stepPin);
    
    *stepPort |= stepMask;      // HIGH
    delayMicroseconds(3);
    *stepPort &= ~stepMask;     // LOW
    
    _currentPosition += (_remainingSteps > 0) ? 1 : -1;
    _remainingSteps = _targetPosition - _currentPosition;
}

uint32_t Axis::calculateAccelerationSteps() {
    if (_acceleration == 0) return 1;
    float steps = (float)_maxSpeed * _maxSpeed / (2.0f * _acceleration);
    return (uint32_t)steps;
}

void Axis::setSpeed(uint32_t speed) {
    _maxSpeed = speed;
}

void Axis::setAcceleration(uint32_t acceleration) {
    _acceleration = acceleration;
}

void Axis::setPosition(int32_t position) {
    _currentPosition = position;
}

void Axis::setDirectionInverted(bool invert) {
    _invertDir = invert;
}

void Axis::setEnabled(bool enabled) {
    if (enabled) {
        enableMotor();
    } else {
        disableMotor();
    }
}

void Axis::setEmergencyStop(bool enabled) {
    _emergencyStop = enabled;
    if (enabled) {
        stop();
    }
}

// FIX: برگشت از endstop
void Axis::backoffFromEndstop() {
    if (!_enabled) enableMotor();
    
    // تنظیم جهت به سمت مثبت (دور از endstop)
    setDirection(_currentPosition + 1);
    
    // عقب‌نشینی تا آزاد شدن endstop
    int backoffCount = 0;
    const int MAX_BACKOFF_STEPS = 10000;
    
    while (digitalRead(_endstopPin) == LOW && backoffCount < MAX_BACKOFF_STEPS) {
        digitalWrite(_stepPin, HIGH);
        delayMicroseconds(500);
        digitalWrite(_stepPin, LOW);
        delayMicroseconds(500);
        _currentPosition++;
        backoffCount++;
    }
    
    if (backoffCount >= MAX_BACKOFF_STEPS) {
        Serial.print("!! Axis (pin ");
        Serial.print(_stepPin);
        Serial.println("): backoff timeout");
    }
}