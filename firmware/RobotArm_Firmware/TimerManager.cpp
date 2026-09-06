#include "TimerManager.h"
#include "SerialCLI.h"

TimerManager::TimerManager() {
    _fireFn = nullptr;
    for (int i = 0; i < MAX_TIMERS; i++) {
        _timers[i].active = false;
    }
}

void TimerManager::update() {
    unsigned long currentTime = millis();
    
    for (int i = 0; i < MAX_TIMERS; i++) {
        if (_timers[i].active && currentTime >= _timers[i].triggerTime) {
            C_PRINT(">> Timer fired: axis ");
            C_PRINT(_timers[i].axis + 1);
            C_PRINT(" to ");
            C_PRINTLN(_timers[i].target);
            
            // FIX: اجرای واقعی حرکت از طریق callback متصل‌شده
            // (قبلاً فقط پیام چاپ می‌شد و هیچ حرکتی انجام نمی‌شد!)
            if (_fireFn) {
                _fireFn(_timers[i].axis, _timers[i].target);
            }
            
            _timers[i].active = false;
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