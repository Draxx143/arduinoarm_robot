#include "TeachMode.h"

TeachMode::TeachMode() {
    _recording = false;
    _playing = false;
    _stepCount = 0;
    _currentStep = 0;
}

void TeachMode::startRecording() {
    _recording = true;
    _stepCount = 0;
    Serial.println(">> Teach mode: RECORDING started");
    Serial.println("   Use 'teach step' to record current position");
    Serial.println("   Use 'teach stop' to stop recording");
}

void TeachMode::stopRecording() {
    _recording = false;
    Serial.print(">> Teach mode: RECORDING stopped. ");
    Serial.print(_stepCount);
    Serial.println(" steps recorded.");
}

bool TeachMode::isRecording() {
    return _recording;
}

bool TeachMode::recordStep(const int32_t positions[], unsigned long delayMs) {
    if (!_recording) return false;
    if (_stepCount >= MAX_TEACH_STEPS) {
        Serial.println("!! Max teach steps reached");
        return false;
    }
    
    for (int i = 0; i < NUM_AXES; i++) {
        _steps[_stepCount].positions[i] = positions[i];
    }
    _steps[_stepCount].delayAfter = delayMs;
    _stepCount++;
    
    Serial.print(">> Step ");
    Serial.print(_stepCount);
    Serial.println(" recorded");
    
    return true;
}

void TeachMode::startPlayback(void (*moveCallback)(const int32_t[])) {
    if (_stepCount == 0) {
        Serial.println("!! No steps recorded");
        return;
    }
    
    _moveCallback = moveCallback;
    _playing = true;
    _currentStep = 0;
    _lastStepTime = 0;
    Serial.print(">> Playing back ");
    Serial.print(_stepCount);
    Serial.println(" steps");
}

void TeachMode::stopPlayback() {
    _playing = false;
    Serial.println(">> Playback stopped");
}

bool TeachMode::isPlaying() {
    return _playing;
}

void TeachMode::update() {
    if (!_playing) return;
    
    unsigned long currentTime = millis();
    
    if (_currentStep >= _stepCount) {
        _playing = false;
        Serial.println(">> Playback complete");
        return;
    }
    
    // تأخیر قبل از step بعدی
    if (currentTime - _lastStepTime < _steps[_currentStep].delayAfter) {
        return;
    }
    
    // اجرای step
    if (_moveCallback != nullptr) {
        _moveCallback(_steps[_currentStep].positions);
        Serial.print(">> Step ");
        Serial.print(_currentStep + 1);
        Serial.print("/");
        Serial.println(_stepCount);
    }
    
    _currentStep++;
    _lastStepTime = currentTime;
}

int TeachMode::getStepCount() {
    return _stepCount;
}