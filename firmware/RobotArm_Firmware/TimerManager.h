// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
// https://github.com/Draxx143/arduinoarm_robot
#ifndef TIMER_MANAGER_H
#define TIMER_MANAGER_H

#include <Arduino.h>
#include "Config.h"

// وقتی تایمر شلیک شد این تابع صدا زده می‌شود (axis, targetSteps)
typedef void (*TimerFireCallback)(uint8_t axis, int32_t target);

struct TimerEntry {
    bool active;
    unsigned long triggerTime;
    uint8_t axis;
    int32_t target;
    int32_t position;  // موقعیت فعلی
};

class TimerManager {
public:
    TimerManager();
    void update();
    bool addTimer(unsigned long delayMs, uint8_t axis, int32_t target);
    void clear();
    int getActiveCount();
    // BUGFIX: قبلاً تایمر فقط یک پیام چاپ می‌کرد و هیچ حرکتی انجام نمی‌شد
    void setCallback(TimerFireCallback cb);

private:
    static const int MAX_TIMERS = 5;
    TimerEntry _timers[MAX_TIMERS];
    TimerFireCallback _callback;
};

#endif