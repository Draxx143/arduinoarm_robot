#ifndef TIMER_MANAGER_H
#define TIMER_MANAGER_H

#include <Arduino.h>
#include "Config.h"

struct TimerEntry {
    bool active;
    unsigned long triggerTime;
    uint8_t axis;
    int32_t target;
    int32_t position;  // موقعیت فعلی
};

class TimerManager {
public:
    // FIX: عمل اجرایی هنگام شلیک تایمر — در setup() به MotorController وصل می‌شود
    typedef void (*TimerFireFn)(uint8_t axis, int32_t target);
    
    TimerManager();
    void update();
    bool addTimer(unsigned long delayMs, uint8_t axis, int32_t target);
    void clear();
    int getActiveCount();
    void onFire(TimerFireFn fn) { _fireFn = fn; }
    
private:
    static const int MAX_TIMERS = 5;
    TimerEntry _timers[MAX_TIMERS];
    TimerFireFn _fireFn;
};

#endif