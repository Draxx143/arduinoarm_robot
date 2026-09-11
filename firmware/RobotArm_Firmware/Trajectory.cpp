#include "Trajectory.h"

Trajectory::Trajectory() {
    _active = false;
    _progress = 0;
}

void Trajectory::setLinear(int32_t start[], int32_t end[], unsigned long durationMs) {
    _type = TRAJ_LINEAR;
    for (int i = 0; i < NUM_AXES; i++) {
        _start[i] = start[i];
        _end[i] = end[i];
    }
    _duration = durationMs;
}

void Trajectory::setCircular(int32_t center[], int32_t radius, unsigned long durationMs) {
    _type = TRAJ_CIRCULAR;
    for (int i = 0; i < NUM_AXES; i++) {
        _center[i] = center[i];
    }
    _radius = radius;
    _duration = durationMs;
}

void Trajectory::start() {
    _active = true;
    _startTime = millis();
    _progress = 0;
    Serial.println(">> Trajectory started");
}

void Trajectory::stop() {
    _active = false;
    Serial.println(">> Trajectory stopped");
}

void Trajectory::update(int32_t currentPos[]) {
    if (!_active) return;
    
    unsigned long elapsed = millis() - _startTime;
    if (elapsed >= _duration) {
        _active = false;
        for (int i = 0; i < NUM_AXES; i++) {
            currentPos[i] = _end[i];
        }
        Serial.println(">> Trajectory complete");
        return;
    }
    
    _progress = (float)elapsed / _duration;
    
    // S-curve interpolation
    float t = _progress;
    if (t < 0.15f) {
        t = sqrtf(t / 0.15f) * 0.15f;
    } else if (t > 0.85f) {
        float t2 = (t - 0.85f) / 0.15f;
        t = 0.85f + (1.0f - (1.0f - t2) * (1.0f - t2)) * 0.15f;
    }
    
    for (int i = 0; i < NUM_AXES; i++) {
        if (_type == TRAJ_LINEAR) {
            currentPos[i] = _start[i] + (_end[i] - _start[i]) * t;
        } else {
            // دایره‌ای - فقط X و Y
            if (i == 0) {
                currentPos[i] = _center[i] + _radius * cosf(t * 6.28318f);
            } else if (i == 1) {
                currentPos[i] = _center[i] + _radius * sinf(t * 6.28318f);
            } else {
                currentPos[i] = _center[i];
            }
        }
    }
}

bool Trajectory::isActive() {
    return _active;
}

float Trajectory::getProgress() {
    return _progress;
}