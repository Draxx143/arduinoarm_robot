#ifndef MACRO_H
#define MACRO_H

#include <Arduino.h>
#include "Config.h"

class Macro {
public:
    Macro();
    void recordPick();
    void recordPlace();
    void recordHome();
    void executePick();
    void executePlace();
    void executeHome();
    bool isPickSet();
    bool isPlaceSet();
    bool isHomeSet();
    
private:
    int32_t _pickPos[NUM_AXES];
    int32_t _placePos[NUM_AXES];
    int32_t _homePos[NUM_AXES];
    bool _pickSet;
    bool _placeSet;
    bool _homeSet;
};

#endif