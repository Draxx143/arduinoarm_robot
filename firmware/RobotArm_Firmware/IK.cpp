#include "IK.h"
#include <math.h>

IK::IK() {
    _L1 = 100.0f;  // پیش‌فرض: ۱۰ سانتی‌متر
    _L2 = 100.0f;
    _L3 = 50.0f;
}

void IK::setLinkLengths(float L1, float L2, float L3) {
    _L1 = L1;
    _L2 = L2;
    _L3 = L3;
}

bool IK::solveIK(float x, float y, float z, float angles[]) {
    // محاسبه ساده IK برای بازوی ۵ درجه
    // محور ۱: چرخش پایه (Yaw)
    // محور ۲: شانه (Pitch)
    // محور ۳: آرنج (Pitch)
    // محور ۴: مچ (Roll)
    // محور ۵: مچ (Pitch)
    
    // محور ۱: چرخش پایه
    angles[0] = atan2f(y, x) * 180.0f / 3.14159f;
    
    // فاصله افقی
    float r = sqrtf(x * x + y * y);
    
    // محور ۲: شانه
    // محور ۳: آرنج
    float L = sqrtf(r * r + z * z);
    
    if (L > _L1 + _L2 + _L3 || L < fabsf(_L1 - _L2 - _L3)) {
        return false;  // خارج از دسترس
    }
    
    // محاسبه زاویه شانه
    float cosElbow = (_L1 * _L1 + _L2 * _L2 - L * L) / (2.0f * _L1 * _L2);
    if (cosElbow < -1.0f || cosElbow > 1.0f) {
        cosElbow = constrain(cosElbow, -1.0f, 1.0f);
    }
    float elbow = acosf(cosElbow);
    angles[2] = 180.0f - (elbow * 180.0f / 3.14159f);
    
    // محاسبه زاویه شانه
    float alpha = atan2f(z, r);
    float beta = acosf((_L1 * _L1 + L * L - _L2 * _L2) / (2.0f * _L1 * L));
    angles[1] = (alpha + beta) * 180.0f / 3.14159f;
    
    // محور ۴ و ۵: مچ (صفر)
    angles[3] = 0;
    angles[4] = 0;
    
    return true;
}

bool IK::solveFK(float angles[], float& x, float& y, float& z) {
    // تبدیل درجه به رادیان
    float a0 = angles[0] * 3.14159f / 180.0f;
    float a1 = angles[1] * 3.14159f / 180.0f;
    float a2 = angles[2] * 3.14159f / 180.0f;
    
    // محاسبه موقعیت مچ
    float r = _L1 * cosf(a1) + _L2 * cosf(a1 - a2);
    z = _L1 * sinf(a1) + _L2 * sinf(a1 - a2);
    
    // محاسبه موقعیت پایه
    x = r * cosf(a0);
    y = r * sinf(a0);
    
    return true;
}