#ifndef TRAJECTORY_H
#define TRAJECTORY_H

#include <Arduino.h>
#include "Config.h"

enum TrajectoryType {
    TRAJ_LINEAR,
    TRAJ_CIRCULAR
};

class Trajectory {
public:
    Trajectory();
    void setLinear(int32_t start[], int32_t end[], unsigned long durationMs);
    void setCircular(int32_t center[], int32_t radius, unsigned long durationMs);
    void start();
    void stop();
    void update(int32_t currentPos[]);
    bool isActive();
    float getProgress();
    
private:
    bool _active;
    TrajectoryType _type;
    int32_t _start[NUM_AXES];
    int32_t _end[NUM_AXES];
    int32_t _center[NUM_AXES];
    int32_t _radius;
    unsigned long _startTime;
    unsigned long _duration;
    float _progress;
};

#endif