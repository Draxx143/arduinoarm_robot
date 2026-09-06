#include "SpeedProfile.h"
#include "SerialCLI.h"

SpeedProfileManager::SpeedProfileManager() {
    _currentProfile = PROFILE_NORMAL;
    _maxSpeedMult = 1.0f;
    _accelMult = 1.0f;
}

void SpeedProfileManager::setProfile(SpeedProfile profile) {
    _currentProfile = profile;
    
    switch (profile) {
        case PROFILE_SLOW:
            _maxSpeedMult = 0.5f;
            _accelMult = 0.5f;
            break;
        case PROFILE_NORMAL:
            _maxSpeedMult = 1.0f;
            _accelMult = 1.0f;
            break;
        case PROFILE_FAST:
            _maxSpeedMult = 1.5f;
            _accelMult = 1.5f;
            break;
        case PROFILE_CUSTOM:
            // مقادیر قبلی نگه داشته می‌شن
            break;
    }
    
    C_PRINT(">> Speed profile: ");
    C_PRINTLN(getProfileName());
}

SpeedProfile SpeedProfileManager::getProfile() {
    return _currentProfile;
}

void SpeedProfileManager::setMaxSpeedMultiplier(float mult) {
    _maxSpeedMult = mult;
}

float SpeedProfileManager::getMaxSpeedMultiplier() {
    return _maxSpeedMult;
}

void SpeedProfileManager::setAccelMultiplier(float mult) {
    _accelMult = mult;
}

float SpeedProfileManager::getAccelMultiplier() {
    return _accelMult;
}

const char* SpeedProfileManager::getProfileName() {
    switch (_currentProfile) {
        case PROFILE_SLOW:   return "SLOW (50%)";
        case PROFILE_NORMAL: return "NORMAL (100%)";
        case PROFILE_FAST:   return "FAST (150%)";
        case PROFILE_CUSTOM: return "CUSTOM";
    }
    return "UNKNOWN";
}