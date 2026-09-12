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
    // محاسبه IK برای بازوی ۵ درجه
    //
    // بازو سه لینک دارد: L1 (بازو)، L2 (ساعد)، L3 (مچ/ابزار). چون این حل
    // مچ را صفر نگه می‌دارد (J4 = J5 = 0)، ابزار در امتداد ساعد است؛ پس
    // برای اینکه **نوک** به هدف برسد، ساعد مؤثر L2 + L3 است.
    //
    // باگ قبلی: ریاضی با L2 حل می‌شد ولی تستِ «در دسترس» تا L1+L2+L3 اجازه
    // می‌داد. در نتیجه برای هدف‌های بین ۲۰۰ تا ۲۵۰ میلی‌متر، آرگومان acos
    // از ۱ بیشتر می‌شد و زاویه‌ی شانه «nan» درمی‌آمد (حرکت غیرقابل پیش‌بینی).
    // حالا یک مدل واحد است و هر دو آرگومان acos هم clamp می‌شوند.
    const float L2eff = _L2 + _L3;
    // محور ۱: چرخش پایه (Yaw)
    // محور ۲: شانه (Pitch)
    // محور ۳: آرنج (Pitch)
    // محور ۴: مچ (Roll)
    // محور ۵: مچ (Pitch)
    
    // محور ۱: چرخش پایه
    angles[0] = atan2f(y, x) * 180.0f / 3.14159f;
    
    // فاصله افقی
    float r = sqrtf(x * x + y * y);
    
    // محور ۲: شانه / محور ۳: آرنج
    float L = sqrtf(r * r + z * z);

    if (L > _L1 + L2eff || L < fabsf(_L1 - L2eff)) {
        return false;  // خارج از دسترس
    }

    // زاویه‌ی آرنج (قانون کسینوس‌ها) — clamp تا هرگز nan نشود
    float cosElbow = (_L1 * _L1 + L2eff * L2eff - L * L) / (2.0f * _L1 * L2eff);
    cosElbow = constrain(cosElbow, -1.0f, 1.0f);
    float elbow = acosf(cosElbow);
    angles[2] = 180.0f - (elbow * 180.0f / 3.14159f);

    // زاویه‌ی شانه — اینجا هم clamp لازم است (قبلاً نبود: nan)
    float alpha = atan2f(z, r);
    float cosBeta = (_L1 * _L1 + L * L - L2eff * L2eff) / (2.0f * _L1 * L);
    cosBeta = constrain(cosBeta, -1.0f, 1.0f);
    float beta = acosf(cosBeta);
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
    
    float a3 = angles[3] * 3.14159f / 180.0f;   // مچ

    // موقعیت مچ
    float r  = _L1 * cosf(a1) + _L2 * cosf(a1 - a2);
    float zc = _L1 * sinf(a1) + _L2 * sinf(a1 - a2);

    // امتداد مچ + ابزار (L3): وقتی مچ صفر است، در ادامه‌ی ساعد است.
    // قبلاً FK فقط تا مچ حساب می‌شد و نوکِ واقعی (که IK هدف می‌گیرد)
    // گزارش نمی‌شد — یعنی عددی که GUI نشان می‌داد با برد فرق داشت.
    float dir = a1 - a2 - a3;
    r  += _L3 * cosf(dir);
    zc += _L3 * sinf(dir);

    // موقعیت پایه
    x = r * cosf(a0);
    y = r * sinf(a0);
    z = zc;

    return true;
}