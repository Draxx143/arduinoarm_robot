#include "SpeedProfile.h"
#include "MotorController.h"
#include "Config.h"

SpeedProfileManager::SpeedProfileManager() {
    _currentProfile = PROFILE_NORMAL;
    _maxSpeedMult = (float)SPEED_SCALE_PERCENT / 100.0f;
    _accelMult = 1.0f;
    _controller = nullptr;
}

void SpeedProfileManager::attach(MotorController* controller) {
    _controller = controller;
}

void SpeedProfileManager::setProfile(SpeedProfile profile) {
    _currentProfile = profile;

    switch (profile) {
        case PROFILE_SLOW:
            _maxSpeedMult = (float)PROFILE_SLOW_PERCENT / 100.0f;
            _accelMult = (float)PROFILE_SLOW_PERCENT / 100.0f;
            break;
        case PROFILE_NORMAL:
            _maxSpeedMult = 1.0f;
            _accelMult = 1.0f;
            break;
        case PROFILE_FAST:
            _maxSpeedMult = (float)PROFILE_FAST_PERCENT / 100.0f;
            _accelMult = (float)PROFILE_FAST_PERCENT / 100.0f;
            break;
        case PROFILE_CUSTOM:
            // مقادیر قبلی نگه داشته می‌شن
            break;
    }

    // نکته‌ی کلیدی: ضریب‌ها باید واقعاً به موتورها برسند، وگرنه
    // دستور `profile fast` فقط یک پیام چاپ می‌کنه و سرعت عوض نمی‌شه.
    apply();

    Serial.print(F(">> Speed profile: "));
    Serial.print(getProfileName());
    Serial.print(F("  (scale "));
    Serial.print((int)(_maxSpeedMult * 100.0f));
    Serial.println(F("%)"));
}

SpeedProfile SpeedProfileManager::getProfile() {
    return _currentProfile;
}

void SpeedProfileManager::setCustom(float speedMult, float accelMult) {
    _currentProfile = PROFILE_CUSTOM;
    _maxSpeedMult = speedMult;
    _accelMult = accelMult;
    apply();
}

void SpeedProfileManager::setMaxSpeedMultiplier(float mult) {
    _maxSpeedMult = mult;
    apply();
}

float SpeedProfileManager::getMaxSpeedMultiplier() {
    return _maxSpeedMult;
}

void SpeedProfileManager::setAccelMultiplier(float mult) {
    _accelMult = mult;
    apply();
}

float SpeedProfileManager::getAccelMultiplier() {
    return _accelMult;
}

void SpeedProfileManager::apply() {
    if (!_controller) return;
    // ترتیب مهم است: setSpeedScale ضریب شتاب را هم برابر ضریب سرعت می‌گذارد،
    // پس اول سرعت و بعد (در صورت لزوم) شتاب مستقل تنظیم می‌شود.
    _controller->setSpeedScale(_maxSpeedMult);
    _controller->setAccelScale(_accelMult);
}

const char* SpeedProfileManager::getProfileName() {
    switch (_currentProfile) {
        case PROFILE_SLOW:   return "SLOW";
        case PROFILE_NORMAL: return "NORMAL";
        case PROFILE_FAST:   return "FAST";
        case PROFILE_CUSTOM: return "CUSTOM";
    }
    return "UNKNOWN";
}
