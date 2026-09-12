// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
// https://github.com/Draxx143/arduinoarm_robot
#ifndef LOGGER_H
#define LOGGER_H

#include <Arduino.h>

class Logger {
public:
    Logger();
    void enable();
    void disable();
    bool isEnabled();
    void log(const char* message);
    void show();
    void clear();
    int getCount();
    
private:
    static const int MAX_LOGS = 10;
    struct LogEntry {
        unsigned long time;
        char message[64];
    };
    LogEntry _logs[MAX_LOGS];
    bool _enabled;
    int _count;
    int _index;
};

#endif