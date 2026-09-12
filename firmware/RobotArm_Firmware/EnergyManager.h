// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
// https://github.com/Draxx143/arduinoarm_robot
#ifndef ENERGY_MANAGER_H
#define ENERGY_MANAGER_H

#include <Arduino.h>

class EnergyManager {
public:
    EnergyManager();
    void setAutoSleepTimeout(unsigned long timeoutMs);
    void enableAutoSleep();
    void disableAutoSleep();
    void update(bool isMoving);
    void sleep();
    void wake();
    bool isSleeping();
    
private:
    bool _sleeping;
    bool _autoSleepEnabled;
    unsigned long _autoSleepTimeout;
    unsigned long _lastActivityTime;
    void (*_sleepCallback)();
    void (*_wakeCallback)();
};

#endif