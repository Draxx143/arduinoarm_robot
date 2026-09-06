#ifndef TEACH_MODE_H
#define TEACH_MODE_H

#include <Arduino.h>
#include "Config.h"

struct TeachStep {
    int32_t positions[NUM_AXES];
    unsigned long delayAfter;
};

class TeachMode {
public:
    TeachMode();
    void startRecording();
    void stopRecording();
    bool isRecording();
    bool recordStep(const int32_t positions[], unsigned long delayMs = 1000);
    void startPlayback(void (*moveCallback)(const int32_t[]));
    void stopPlayback();
    bool isPlaying();
    void update();
    int getStepCount();
    
private:
    static const int MAX_TEACH_STEPS = 30;
    TeachStep _steps[MAX_TEACH_STEPS];
    bool _recording;
    bool _playing;
    int _stepCount;
    int _currentStep;
    unsigned long _lastStepTime;
    void (*_moveCallback)(const int32_t[]);
};

#endif