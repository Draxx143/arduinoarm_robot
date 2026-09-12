// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
// https://github.com/Draxx143/arduinoarm_robot
#ifndef SPEED_PROFILE_H
#define SPEED_PROFILE_H

#include <Arduino.h>

class MotorController;   // forward declaration

enum SpeedProfile {
    PROFILE_SLOW = 0,
    PROFILE_NORMAL = 1,
    PROFILE_FAST = 2,
    PROFILE_CUSTOM = 3
};

class SpeedProfileManager {
public:
    SpeedProfileManager();

    // اتصال به کنترل‌کننده‌ی موتورها — بدون این، پروفایل هیچ اثری نداره!
    void attach(MotorController* controller);

    void setProfile(SpeedProfile profile);
    SpeedProfile getProfile();

    // پروفایل دلخواه: ضریب سرعت و شتاب
    void setCustom(float speedMult, float accelMult);

    void setMaxSpeedMultiplier(float mult);
    float getMaxSpeedMultiplier();
    void setAccelMultiplier(float mult);
    float getAccelMultiplier();

    // اعمال ضریب‌های فعلی روی موتورها
    void apply();

    const char* getProfileName();

private:
    SpeedProfile _currentProfile;
    float _maxSpeedMult;
    float _accelMult;
    MotorController* _controller;
};

#endif
