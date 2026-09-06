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