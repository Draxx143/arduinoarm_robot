// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
// https://github.com/Draxx143/arduinoarm_robot
#ifndef GRIPPER_H
#define GRIPPER_H

// پنجه‌ی ربات: یک سرووی RC استاندارد که با درجه فرمان می‌گیرد.
// عمداً جدا از Axis/استپرهاست (سروو، شمارنده‌ی استپ و endstop ندارد) و
// حرکتش غیرمسدودکننده است: moveTo() فقط هدف را می‌گذارد و update() که
// هر دور loop() صدا زده می‌شود، زاویه را به هدف می‌رساند — با سرعت ثابت
// یا با رمپ شتاب (GRIP_ACCEL_DEG_S2)، و با سرعت جداگانه برای بستن آرام
// (GRIP_CLOSE_SPEED_DEG_S). همه‌ی عددها در Config.h (بلوک GRIP_*).
//
// پالس ۵۰ هرتزی سروو با درایور اختصاصی خودمان (تایمر ۵، دو compare)
// ساخته می‌شود — کتابخانه‌ی Servo آردوینو استفاده نشده، چون روی Mega
// وکتور TIMER1_COMPA را هم می‌گیرد و با موتور حرکت (استپ انجین) لینک
// نمی‌شود (multiple definition of `__vector_17`).

#include <Arduino.h>
#include "Config.h"

class Gripper {
public:
    Gripper();

    void  begin();               // راه‌اندازی + رفتن به GRIP_DEFAULT_DEG
    void  update();              // جلو بردن حرکت به‌سمت هدف (هر loop یک بار)

    void  moveTo(float degrees); // هدف تازه (کلمپ به بازه‌ی مجاز؛ وقتی
                                 // سروو آزاد است یا estop فعال است نادیده)
    void  open();                // = moveTo(GRIP_OPEN_DEG)
    void  close();               // = moveTo(GRIP_CLOSE_DEG)
    void  stop();                // توقف درجا (هدف = موقعیت فعلی)

    void  attach();              // شروع پالس (enable/wake؛ با BOOT_DELAY)
    void  detach();              // قطع پالس (disable/sleep)
    bool  isAttached() const;    // منطقی: سروو در مدار است؟
    bool  isPulseActive() const; // فیزیکی: همین حالا پالس می‌فرستد؟

    void  emergencyStop();       // توقف + لچ (تا reset حرکت نمی‌کند)
    void  clearEmergencyStop();
    bool  emergencyStopActive() const;

    float getCurrentDegrees() const;
    float getTargetDegrees() const;
    float getVelocityDegS() const;
    int   getLastPulseUs() const;
    bool  isMoving() const;

    // نگاشت خالص درجه→پالس (µs) با INVERT — در تست host واحدتست می‌شود.
    // (تریم و ددبند موقع فرستادن اعمال می‌شوند، نه اینجا.)
    static int degreesToMicros(float degrees);

private:
    bool          _attached;     // در مدار بودن (منطقی)
    bool          _hwOn;         // پالس فعال (فیزیکی)
    bool          _booted;       // فاز تأخیر بوت گذشت؟ (تا خواب بیکاری با
                                 // «هنوز شروع‌نشده» قاطی نشود)
    float         _current;      // زاویه‌ی فعلی (درجه)
    float         _target;       // زاویه‌ی هدف (درجه)
    float         _vel;          // سرعت فعلی (درجه/ثانیه، علامت‌دار)
    int           _lastPulseUs;  // آخرین پالس فرستاده‌شده (µs)
    unsigned long _lastUpdate;   // millis() آخرین update
    unsigned long _attachAt;     // millis() آخرین attach (برای BOOT_DELAY)
    unsigned long _idleSince;    // شروع بی‌حرکتی (برای IDLE_RELEASE)
    bool          _estop;

    static float clampDeg(float d);
    static float baseSpeedForMove(float from, float to);
    void applyPulse();           // فرستادن موقعیت فعلی به درایور تایمر
    void hwOn();                 // روشن کردن پالس (با force-write)
    void hwOff();                // خاموش کردن پالس
};

#endif // GRIPPER_H
