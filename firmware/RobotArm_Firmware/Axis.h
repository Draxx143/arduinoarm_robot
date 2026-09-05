#ifndef AXIS_H
#define AXIS_H

#include <Arduino.h>

class Axis {
public:
    // Constructor
    Axis(uint8_t stepPin, uint8_t dirPin, uint8_t enablePin, 
         uint8_t endstopPin, bool invertDir, uint16_t stepsPerRev,
         uint8_t microstep, float gearRatio, uint32_t maxSpeed,
         uint32_t acceleration, int32_t backoff, 
         int32_t softMin, int32_t softMax);
    
    // Initialize
    void init();
    
    // Motor Control
    void enableMotor();
    void disableMotor();
    bool isEnabled() const;
    
    // Movement Commands
    void moveTo(int32_t targetPosition);      // Absolute move
    void moveRelative(int32_t deltaPosition); // Relative move
    void stop();                               // Emergency stop
    
    // Homing
    bool startHoming();
    void processHoming();
    bool isHoming() const;
    bool isHomed() const;
    
    // FIX: برگشت از endstop
    void backoffFromEndstop();
    
    // Status
    int32_t getCurrentPosition() const;
    int32_t getTargetPosition() const;
    
    // FIX: getter برای soft limits
    int32_t getSoftMin() const { return _softMin; }
    int32_t getSoftMax() const { return _softMax; }
    
    bool isMoving() const;
    bool isAtTarget() const;
    bool getEndstopState() const;
    
    // Update (called by timer interrupt)
    void update();
    
    // Set parameters
    void setSpeed(uint32_t speed);
    void setAcceleration(uint32_t acceleration);
    void setPosition(int32_t position); // For homing reset
    
    // Configuration
    void setDirectionInverted(bool invert);
    void setEnabled(bool enabled);
    
    // Emergency stop flag
    void setEmergencyStop(bool enabled);
    
private:
    // Pin configuration
    uint8_t _stepPin;
    uint8_t _dirPin;
    uint8_t _enablePin;
    uint8_t _endstopPin;
    
    // Motor parameters
    bool _invertDir;
    uint16_t _stepsPerRev;
    uint8_t _microstep;
    float _gearRatio;
    uint32_t _maxSpeed;
    uint32_t _acceleration;
    int32_t _backoff;
    int32_t _softMin;
    int32_t _softMax;
    
    // State variables
    volatile int32_t _currentPosition;
    volatile int32_t _targetPosition;
    volatile int32_t _stepCount;
    volatile uint32_t _currentSpeed;
    volatile uint32_t _targetSpeed;
    volatile bool _moving;
    volatile bool _homing;
    volatile bool _homed;
    volatile bool _enabled;
    volatile bool _emergencyStop;
    volatile bool _endstopTriggered;
    volatile int32_t _backoffDone;  // FIX: شمارنده عقب‌نشینی غیرمسدودساز
    
    // Motion control
    volatile uint32_t _stepInterval;
    volatile uint32_t _lastStepTime;
    volatile int32_t _remainingSteps;
    volatile uint32_t _accelSteps;
    volatile uint32_t _decelSteps;
    volatile uint32_t _cruiseSteps;
    volatile uint32_t _accelStepCount;
    volatile uint32_t _decelStepCount;
    volatile bool _accelerationPhase;
    volatile bool _decelerationPhase;
    volatile bool _cruisePhase;
    
    // Trapezoidal motion profile
    uint32_t calculateAccelerationSteps();
    void updateSpeedProfile();
    
    // Step generation
    void generateStep();
    void setDirection(int32_t target);
};

#endif // AXIS_H