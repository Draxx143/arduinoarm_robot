#include "TimerManager.h"

TimerManager::TimerManager() {
    for (int i = 0; i < MAX_TIMERS; i++) {
        _timers[i].active = false;
    }
    _callback = nullptr;
}

void TimerManager::setCallback(TimerFireCallback cb) {
    _callback = cb;
}

void TimerManager::update() {
    unsigned long currentTime = millis();
    
    for (int i = 0; i < MAX_TIMERS; i++) {
        if (_timers[i].active && currentTime >= _timers[i].triggerTime) {
            Serial.print(F(">> Timer fired: axis "));
            Serial.print(_timers[i].axis + 1);
            Serial.print(F(" -> "));
            Serial.print(_timers[i].target);
            Serial.println(F(" steps"));

            _timers[i].active = false;
            if (_callback) {
                _callback(_timers[i].axis, _timers[i].target);
            }
        }
    }
}

bool TimerManager::addTimer(unsigned long delayMs, uint8_t axis, int32_t target) {
    for (int i = 0; i < MAX_TIMERS; i++) {
        if (!_timers[i].active) {
            _timers[i].active = true;
            _timers[i].triggerTime = millis() + delayMs;
            _timers[i].axis = axis;
            _timers[i].target = target;
            return true;
        }
    }
    return false;
}

void TimerManager::clear() {
    for (int i = 0; i < MAX_TIMERS; i++) {
        _timers[i].active = false;
    }
}

int TimerManager::getActiveCount() {
    int count = 0;
    for (int i = 0; i < MAX_TIMERS; i++) {
        if (_timers[i].active) count++;
    }
    return count;
}