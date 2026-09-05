#ifndef MOTOR_CONTROLLER_H
#define MOTOR_CONTROLLER_H

#include "Axis.h"
#include "Config.h"

class MotorController {
public:
    MotorController();
    ~MotorController();
    
    // Initialize all axes
    void init();
    
    // Update all axes (called by timer interrupt)
    void update();
    
    // Axis access
    Axis* getAxis(uint8_t index);
    
    // All axes control
    void enableAllMotors();
    void disableAllMotors();
    void emergencyStop();
    void clearEmergencyStop();
    
    // Homing
    bool startHoming();
    bool startHomingAxis(uint8_t axis);
    void smartHoming();                    // FIX: هوم هوشمند همه
    void smartHomingAxis(uint8_t axis);    // FIX: هوم هوشمند یک محور
    void backoffAllFromEndstops();         // FIX: برگشت از endstop
    void processHoming();
    bool isHoming() const;
    bool allHomed() const;
    void abortHoming();
    
    // Single axis control
    void enableAxis(uint8_t axis);         // FIX: فعال‌سازی یک محور
    void disableAxis(uint8_t axis);        // FIX: غیرفعال‌سازی یک محور
    
    // Move commands
    void moveTo(uint8_t axis, int32_t position);
    void moveRelative(uint8_t axis, int32_t delta);
    void moveAllAxes(const int32_t positions[]);
    
    // Status
    void getJointStates(float* positions, int32_t* rawPositions, 
                        bool* moving, bool* homed, bool* endstopStates);
    
    // Timer setup
    void startControlLoop();
    void stopControlLoop();
    
private:
    Axis* _axes[NUM_AXES];
    bool _allHomed;
    bool _homingInProgress;
    uint8_t _currentHomingAxis;
    uint8_t _homingOrder[NUM_AXES];
};

// Timer interrupt handler (global)
void timerInterruptHandler();

#endif // MOTOR_CONTROLLER_H