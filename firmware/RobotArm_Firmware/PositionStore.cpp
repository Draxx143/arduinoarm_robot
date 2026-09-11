#include "PositionStore.h"

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
    
    Serial.print(">> Position saved in slot ");
    Serial.print(slot);
    Serial.print(" as '");
    Serial.print(_positions[slot].name);
    Serial.println("'");
    
    return true;
}

bool PositionStore::load(uint8_t slot, int32_t positions[]) {
    if (slot >= MAX_POSITIONS || !_positions[slot].saved) {
        Serial.print("!! Slot ");
        Serial.print(slot);
        Serial.println(" is empty");
        return false;
    }
    
    for (int i = 0; i < NUM_AXES; i++) {
        positions[i] = _positions[slot].positions[i];
    }
    
    Serial.print(">> Loaded position from slot ");
    Serial.print(slot);
    Serial.print(" ('");
    Serial.print(_positions[slot].name);
    Serial.println("')");
    
    return true;
}

bool PositionStore::clear(uint8_t slot) {
    if (slot >= MAX_POSITIONS) return false;
    _positions[slot].saved = false;
    return true;
}

void PositionStore::list() {
    Serial.println(">> Saved positions:");
    int count = 0;
    for (int i = 0; i < MAX_POSITIONS; i++) {
        if (_positions[i].saved) {
            Serial.print("  Slot ");
            Serial.print(i);
            Serial.print(": ");
            Serial.println(_positions[i].name);
            count++;
        }
    }
    if (count == 0) {
        Serial.println("  (no saved positions)");
    }
}

bool PositionStore::isSaved(uint8_t slot) {
    if (slot >= MAX_POSITIONS) return false;
    return _positions[slot].saved;
}