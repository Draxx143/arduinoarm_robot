// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Draxx143 — AXIS-3 Robot Arm
// https://github.com/Draxx143/arm-3-axis
#ifndef IK_H
#define IK_H

#include <Arduino.h>
#include "Config.h"

class IK {
public:
    IK();
    // Inverse Kinematics - محاسبه زوایا از موقعیت XYZ
    // ورودی: X, Y, Z (میلی‌متر)
    // خروجی: زوایای ۴ محور (۳ جوینت + گریپر)
    bool solveIK(float x, float y, float z, float angles[]);
    
    // Forward Kinematics - محاسبه XYZ از زوایا
    bool solveFK(float angles[], float& x, float& y, float& z);
    
    // تنظیم ابعاد بازو (برای محاسبه IK)
    void setLinkLengths(float L1, float L2, float L3);
    
private:
    float _L1;  // طول لینک ۱ (بازو)
    float _L2;  // طول لینک ۲ (ساعد)
    float _L3;  // طول لینک ۳ (ابزار)
};

#endif