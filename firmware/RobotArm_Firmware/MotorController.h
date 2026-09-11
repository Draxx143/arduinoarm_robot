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

    // Update all axes — فقط از داخل ISR تایمر صدا زده می‌شه
    void update();

    // Axis access
    Axis* getAxis(uint8_t index);

    // All axes control
    void enableAllMotors();
    void disableAllMotors();
    void emergencyStop();
    void clearEmergencyStop();
    bool emergencyStopActive() const { return _estopActive; }

    // Homing
    bool startHoming();
    bool startHomingAxis(uint8_t axis);
    void smartHoming();                    // هوم هوشمند همه
    void smartHomingAxis(uint8_t axis);    // هوم هوشمند یک محور
    void backoffAllFromEndstops();         // گزارش وضعیت endstop ها
    void processHoming();
    bool isHoming() const;
    bool allHomed() const;
    void abortHoming();
    bool homingFailed() const;

    // ---- اولویت هومینگ ----
    // ترتیب فعلی (ایندکس صفر‌بنیان) را چاپ می‌کند: J1 -> J2 -> J3 -> J4 -> J5
    void printHomingOrder() const;
    // تغییر ترتیب در زمان اجرا؛ order باید جایگشتی از 0..NUM_AXES-1 باشد
    bool setHomingOrder(const uint8_t* order, uint8_t count);
    const uint8_t* getHomingOrder() const { return _homingOrder; }

    // Single axis control
    void enableAxis(uint8_t axis);
    void disableAxis(uint8_t axis);

    // Move commands
    void moveTo(uint8_t axis, int32_t position);
    void moveRelative(uint8_t axis, int32_t delta);
    void moveAllAxes(const int32_t positions[]);
    // حرکت هماهنگ: همه‌ی محورها در durationMs به مقصد می‌رسن
    void moveAllAxesTimed(const int32_t positions[], uint32_t durationMs);
    // به‌روزرسانی زنده‌ی هدف همه‌ی محورها (برای trajectory)
    void streamAllAxes(const int32_t positions[]);
    bool isAnyMoving() const;
    bool isAnyActive() const;

    // Speed / profile — ضریب سرعت و شتاب همه‌ی محورها
    void setSpeedScale(float mult);
    void setAccelScale(float mult);
    float getSpeedScale() const;
    void setAxisSpeed(uint8_t axis, uint32_t stepsPerSec);
    void setAxisAcceleration(uint8_t axis, uint32_t stepsPerSec2);
    void setAxisHomingSpeed(uint8_t axis, uint32_t stepsPerSec);

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
    uint8_t _homingOrder[NUM_AXES];   // ترتیب اولویت هومینگ
    void printHomingFailure(uint8_t axis) const;

    volatile bool _estopActive;
    volatile uint8_t _estopDiv;
    volatile uint8_t _idleDiv;
    volatile bool _anyActive;   // هیچ محوری در حال حرکت/هومینگ هست؟
    volatile uint8_t* _estopReg;
    uint8_t _estopMask;
};

// Global instance used by the timer ISR
extern MotorController* globalController;

#endif // MOTOR_CONTROLLER_H
