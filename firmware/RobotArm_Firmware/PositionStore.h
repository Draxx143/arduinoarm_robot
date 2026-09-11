#ifndef POSITION_STORE_H
#define POSITION_STORE_H

#include <Arduino.h>
#include "Config.h"

#define MAX_POSITIONS 10

struct Position {
    bool saved;
    int32_t positions[NUM_AXES];
    char name[16];
};

class PositionStore {
public:
    PositionStore();
    void begin();
    bool save(uint8_t slot, const int32_t positions[], const char* name = nullptr);
    bool load(uint8_t slot, int32_t positions[]);
    bool clear(uint8_t slot);
    void list();
    bool isSaved(uint8_t slot);
    
private:
    Position _positions[MAX_POSITIONS];
};

#endif