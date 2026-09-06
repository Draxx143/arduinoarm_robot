#ifndef SPEED_PROFILE_H
#define SPEED_PROFILE_H

#include <Arduino.h>

enum SpeedProfile {
    PROFILE_SLOW = 0,
    PROFILE_NORMAL = 1,
    PROFILE_FAST = 2,
    PROFILE_CUSTOM = 3
};

class SpeedProfileManager {
public:
    SpeedProfileManager();
    void setProfile(SpeedProfile profile);
    SpeedProfile getProfile();
    void setMaxSpeedMultiplier(float mult);
    float getMaxSpeedMultiplier();
    void setAccelMultiplier(float mult);
    float getAccelMultiplier();
    const char* getProfileName();
    
private:
    SpeedProfile _currentProfile;
    float _maxSpeedMult;
    float _accelMult;
};

#endif