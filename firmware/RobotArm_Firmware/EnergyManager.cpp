#include "EnergyManager.h"
#include "SerialCLI.h"

EnergyManager::EnergyManager() {
    _sleeping = false;
    _autoSleepEnabled = false;
    _autoSleepTimeout = 600000;  // ۱۰ دقیقه پیش‌فرض
    _lastActivityTime = millis();
    _sleepCallback = nullptr;
    _wakeCallback = nullptr;
}

void EnergyManager::setAutoSleepTimeout(unsigned long timeoutMs) {
    _autoSleepTimeout = timeoutMs;
}

void EnergyManager::enableAutoSleep() {
    _autoSleepEnabled = true;
    C_PRINTLN(">> Auto-sleep ENABLED");
}

void EnergyManager::disableAutoSleep() {
    _autoSleepEnabled = false;
    C_PRINTLN(">> Auto-sleep DISABLED");
}

void EnergyManager::update(bool isMoving) {
    if (isMoving) {
        _lastActivityTime = millis();
        if (_sleeping) wake();
        return;
    }
    
    if (_autoSleepEnabled && !_sleeping) {
        if (millis() - _lastActivityTime > _autoSleepTimeout) {
            sleep();
        }
    }
}

void EnergyManager::sleep() {
    if (_sleeping) return;
    _sleeping = true;
    C_PRINTLN(">> Going to SLEEP");
    if (_sleepCallback) _sleepCallback();
}

void EnergyManager::wake() {
    if (!_sleeping) return;
    _sleeping = false;
    _lastActivityTime = millis();
    C_PRINTLN(">> Waking up");
    if (_wakeCallback) _wakeCallback();
}

bool EnergyManager::isSleeping() {
    return _sleeping;
}