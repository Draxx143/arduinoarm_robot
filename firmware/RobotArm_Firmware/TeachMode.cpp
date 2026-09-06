#include "TeachMode.h"
#include "SerialCLI.h"

TeachMode::TeachMode() {
    _recording = false;
    _playing = false;
    _stepCount = 0;
    _currentStep = 0;
}

void TeachMode::startRecording() {
    _recording = true;
    _stepCount = 0;
    C_PRINTLN(">> Teach mode: RECORDING started");
    C_PRINTLN("   Use 'teach step' to record current position");
    C_PRINTLN("   Use 'teach stop' to stop recording");
}

void TeachMode::stopRecording() {
    _recording = false;
    C_PRINT(">> Teach mode: RECORDING stopped. ");
    C_PRINT(_stepCount);
    C_PRINTLN(" steps recorded.");
}

bool TeachMode::isRecording() {
    return _recording;
}

bool TeachMode::recordStep(const int32_t positions[], unsigned long delayMs) {
    if (!_recording) return false;
    if (_stepCount >= MAX_TEACH_STEPS) {
        C_PRINTLN("!! Max teach steps reached");
        return false;
    }
    
    for (int i = 0; i < NUM_AXES; i++) {
        _steps[_stepCount].positions[i] = positions[i];
    }
    _steps[_stepCount].delayAfter = delayMs;
    _stepCount++;
    
    C_PRINT(">> Step ");
    C_PRINT(_stepCount);
    C_PRINTLN(" recorded");
    
    return true;
}

void TeachMode::startPlayback(void (*moveCallback)(const int32_t[])) {
    if (_stepCount == 0) {
        C_PRINTLN("!! No steps recorded");
        return;
    }
    
    _moveCallback = moveCallback;
    _playing = true;
    _currentStep = 0;
    _lastStepTime = 0;
    C_PRINT(">> Playing back ");
    C_PRINT(_stepCount);
    C_PRINTLN(" steps");
}

void TeachMode::stopPlayback() {
    _playing = false;
    C_PRINTLN(">> Playback stopped");
}

bool TeachMode::isPlaying() {
    return _playing;
}

void TeachMode::update() {
    if (!_playing) return;
    
    unsigned long currentTime = millis();
    
    if (_currentStep >= _stepCount) {
        _playing = false;
        C_PRINTLN(">> Playback complete");
        return;
    }
    
    // تأخیر قبل از step بعدی
    if (currentTime - _lastStepTime < _steps[_currentStep].delayAfter) {
        return;
    }
    
    // اجرای step
    if (_moveCallback != nullptr) {
        _moveCallback(_steps[_currentStep].positions);
        C_PRINT(">> Step ");
        C_PRINT(_currentStep + 1);
        C_PRINT("/");
        C_PRINTLN(_stepCount);
    }
    
    _currentStep++;
    _lastStepTime = currentTime;
}

int TeachMode::getStepCount() {
    return _stepCount;
}