// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
// https://github.com/Draxx143/arduinoarm_robot
#include "Gripper.h"

Gripper::Gripper()
    : _current(GRIP_DEFAULT_DEG)
    , _target(GRIP_DEFAULT_DEG)
    , _lastWritten(-1)
    , _lastUpdate(0)
    , _estop(false)
{
}

float Gripper::clampDeg(float d) {
    if (d < GRIP_MIN_DEG) return GRIP_MIN_DEG;
    if (d > GRIP_MAX_DEG) return GRIP_MAX_DEG;
    return d;
}

void Gripper::begin() {
    _current = clampDeg(GRIP_DEFAULT_DEG);
    _target = _current;
    _lastUpdate = millis();
    attach();
}

void Gripper::attach() {
    if (!_servo.attached()) {
        _servo.attach(GRIP_PIN, GRIP_MIN_US, GRIP_MAX_US);
        _lastWritten = -1;   // وادار به نوشتن دوباره بعد از اتصال
        _lastUpdate = millis();
    }
}

void Gripper::detach() {
    if (_servo.attached()) {
        _servo.detach();
    }
    _target = _current;      // بعد از آزاد شدن، هدفی باقی نماند
}

bool Gripper::isAttached() const {
    return _servo.attached();
}

void Gripper::moveTo(float degrees) {
    if (_estop) return;
    if (!_servo.attached()) return;
    _target = clampDeg(degrees);
}

void Gripper::open() {
    moveTo(GRIP_OPEN_DEG);
}

void Gripper::close() {
    moveTo(GRIP_CLOSE_DEG);
}

void Gripper::stop() {
    _target = _current;
}

void Gripper::emergencyStop() {
    _estop = true;
    _target = _current;      // درجا بایست؛ سروو همچنان متصل می‌ماند تا
                             // اگر چیزی گرفته، رها نکند
}

void Gripper::clearEmergencyStop() {
    _estop = false;
}

bool Gripper::emergencyStopActive() const {
    return _estop;
}

float Gripper::getCurrentDegrees() const {
    return _current;
}

float Gripper::getTargetDegrees() const {
    return _target;
}

bool Gripper::isMoving() const {
    return _target != _current;
}

void Gripper::update() {
    if (!_servo.attached()) {
        _lastUpdate = millis();
        return;
    }
    if (_target == _current) {
        _lastUpdate = millis();
        // حتی در سکون، یک بار بنویس تا بعد از attach موقعیت اعمال شود
        int w = (int)(_current + 0.5f);
        if (w != _lastWritten) {
            _servo.write(w);
            _lastWritten = w;
        }
        return;
    }

    unsigned long now = millis();
    unsigned long dt = now - _lastUpdate;
    _lastUpdate = now;
    if (dt == 0) return;
    if (dt > 500) dt = 500;  // پرش زمانی بزرگ (مثلاً بعد از delay) = یک قدم معقول

    // حرکت خطی با سرعت ثابت + کمی نرمی نزدیک هدف (قدم، از فاصله بیشتر نمی‌شود)
    float step = GRIP_SPEED_DEG_S * ((float)dt / 1000.0f);
    float diff = _target - _current;
    float adiff = (diff >= 0.0f) ? diff : -diff;
    if (step >= adiff) {
        _current = _target;
    } else {
        _current += (diff > 0.0f) ? step : -step;
    }

    int w = (int)(_current + 0.5f);
    if (w != _lastWritten) {
        _servo.write(w);
        _lastWritten = w;
    }
}
