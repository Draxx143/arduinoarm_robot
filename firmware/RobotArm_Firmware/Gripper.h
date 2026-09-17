// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
// https://github.com/Draxx143/arduinoarm_robot
#ifndef GRIPPER_H
#define GRIPPER_H

// پنجه‌ی ربات: یک سرووی RC استاندارد که با درجه فرمان می‌گیرد.
// عمداً جدا از Axis/استپرهاست (سروو، شمارنده‌ی استپ و endstop ندارد) و
// حرکتش غیرمسدودکننده است: moveTo() فقط هدف را می‌گذارد و update() که
// هر دور loop() صدا زده می‌شود، زاویه را با سرعت GRIP_SPEED_DEG_S به
// هدف می‌رساند. همه‌ی عددها در Config.h (بلوک GRIP_*) قابل تنظیم‌اند.

#include <Arduino.h>
#include <Servo.h>
#include "Config.h"

class Gripper {
public:
    Gripper();

    void  begin();               // اتصال سروو + رفتن به GRIP_DEFAULT_DEG
    void  update();              // جلو بردن حرکت به‌سمت هدف (هر loop یک بار)

    void  moveTo(float degrees); // هدف تازه (کلمپ به بازه‌ی مجاز؛ وقتی
                                 // سروو آزاد است یا estop فعال است نادیده)
    void  open();                // = moveTo(GRIP_OPEN_DEG)
    void  close();               // = moveTo(GRIP_CLOSE_DEG)
    void  stop();                // توقف درجا (هدف = موقعیت فعلی)

    void  attach();              // برق دادن به سروو (enable/wake)
    void  detach();              // آزاد کردن سروو (disable/sleep)
    bool  isAttached() const;

    void  emergencyStop();       // توقف + لچ (تا reset حرکت نمی‌کند)
    void  clearEmergencyStop();
    bool  emergencyStopActive() const;

    float getCurrentDegrees() const;
    float getTargetDegrees() const;
    bool  isMoving() const;

private:
    Servo         _servo;
    float         _current;      // زاویه‌ی فعلی (درجه)
    float         _target;       // زاویه‌ی هدف (درجه)
    int           _lastWritten;  // آخرین زاویه‌ی فرستاده‌شده به سروو
    unsigned long _lastUpdate;   // millis() آخرین update
    bool          _estop;

    static float clampDeg(float d);
};

#endif // GRIPPER_H
