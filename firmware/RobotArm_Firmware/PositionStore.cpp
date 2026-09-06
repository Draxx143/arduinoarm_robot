#include "PositionStore.h"
#include "SerialCLI.h"

PositionStore::PositionStore() {
    for (int i = 0; i < MAX_POSITIONS; i++) {
        _positions[i].saved = false;
    }
}

void PositionStore::begin() {
    // بارگذاری از EEPROM (اختیاری)
    // فعلاً فقط RAM
}

bool PositionStore::save(uint8_t slot, const int32_t positions[], const char* name) {
    if (slot >= MAX_POSITIONS) return false;
    
    _positions[slot].saved = true;
    for (int i = 0; i < NUM_AXES; i++) {
        _positions[slot].positions[i] = positions[i];
    }
    
    if (name != nullptr) {
        strncpy(_positions[slot].name, name, 15);
        _positions[slot].name[15] = '\0';
    } else {
        snprintf(_positions[slot].name, 16, "Pos%d", slot);
    }
    
    C_PRINT(">> Position saved in slot ");
    C_PRINT(slot);
    C_PRINT(" as '");
    C_PRINT(_positions[slot].name);
    C_PRINTLN("'");
    
    return true;
}

bool PositionStore::load(uint8_t slot, int32_t positions[]) {
    if (slot >= MAX_POSITIONS || !_positions[slot].saved) {
        C_PRINT("!! Slot ");
        C_PRINT(slot);
        C_PRINTLN(" is empty");
        return false;
    }
    
    for (int i = 0; i < NUM_AXES; i++) {
        positions[i] = _positions[slot].positions[i];
    }
    
    C_PRINT(">> Loaded position from slot ");
    C_PRINT(slot);
    C_PRINT(" ('");
    C_PRINT(_positions[slot].name);
    C_PRINTLN("')");
    
    return true;
}

bool PositionStore::clear(uint8_t slot) {
    if (slot >= MAX_POSITIONS) return false;
    _positions[slot].saved = false;
    return true;
}

void PositionStore::list() {
    C_PRINTLN(">> Saved positions:");
    int count = 0;
    for (int i = 0; i < MAX_POSITIONS; i++) {
        if (_positions[i].saved) {
            C_PRINT("  Slot ");
            C_PRINT(i);
            C_PRINT(": ");
            C_PRINTLN(_positions[i].name);
            count++;
        }
    }
    if (count == 0) {
        C_PRINTLN("  (no saved positions)");
    }
}

bool PositionStore::isSaved(uint8_t slot) {
    if (slot >= MAX_POSITIONS) return false;
    return _positions[slot].saved;
}