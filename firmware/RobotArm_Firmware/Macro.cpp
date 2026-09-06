#include "Macro.h"
#include "SerialCLI.h"

Macro::Macro() {
    _pickSet = false;
    _placeSet = false;
    _homeSet = false;
    
    // home پیش‌فرض = 0
    for (int i = 0; i < NUM_AXES; i++) {
        _homePos[i] = 0;
    }
    _homeSet = true;
}

void Macro::recordPick() {
    // موقعیت فعلی باید از بیرون تنظیم بشه
    // این فقط اعلام می‌کنه
}

void Macro::recordPlace() {
}

void Macro::recordHome() {
}

void Macro::executePick() {
}

void Macro::executePlace() {
}

void Macro::executeHome() {
    C_PRINTLN(">> Executing HOME macro");
}

bool Macro::isPickSet() { return _pickSet; }
bool Macro::isPlaceSet() { return _placeSet; }
bool Macro::isHomeSet() { return _homeSet; }