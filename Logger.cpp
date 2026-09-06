#include "Logger.h"

Logger::Logger() {
    _enabled = false;
    _count = 0;
    _index = 0;
}

void Logger::enable() {
    _enabled = true;
    Serial.println(">> Logging ENABLED");
}

void Logger::disable() {
    _enabled = false;
    Serial.println(">> Logging DISABLED");
}

bool Logger::isEnabled() {
    return _enabled;
}

void Logger::log(const char* message) {
    if (!_enabled) return;
    
    _logs[_index].time = millis();
    strncpy(_logs[_index].message, message, 63);
    _logs[_index].message[63] = '\0';
    
    _index = (_index + 1) % MAX_LOGS;
    if (_count < MAX_LOGS) _count++;
}

void Logger::show() {
    Serial.println(">> Log entries:");
    if (_count == 0) {
        Serial.println("  (no entries)");
        return;
    }
    
    int start = (_count < MAX_LOGS) ? 0 : _index;
    for (int i = 0; i < _count; i++) {
        int idx = (start + i) % MAX_LOGS;
        Serial.print("  [");
        Serial.print(_logs[idx].time);
        Serial.print("ms] ");
        Serial.println(_logs[idx].message);
    }
}

void Logger::clear() {
    _count = 0;
    _index = 0;
    Serial.println(">> Log cleared");
}

int Logger::getCount() {
    return _count;
}