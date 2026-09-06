#include "SerialCLI.h"

void SerialCLI::begin(unsigned long baud, DispatchFn dispatch) {
    _dispatch = dispatch;
    _buf.reserve(120);
    Serial.begin(baud);
}

/* FIX/SEMANTICS: حالت ON یعنی برد «ساکت» است (هیچ پیامی به مانیتور نمی‌رود)
 * و حالت OFF یعنی تاییدیه‌ها فعال‌اند. پیش‌فرض بعد از بوت: OFF (تاییدیه روشن) */
void SerialCLI::ack(bool on) {
    _ack = on;
    Serial.println(on ? ">> Ack mode ON - board is SILENT (no serial chatter)"
                      : ">> Ack mode OFF - confirmations enabled");
}

void SerialCLI::poll() {
    while (Serial.available() > 0) {
        char c = (char)Serial.read();
        _lastCharMs = millis();
        if (c == '\n') {
            _execute(_buf);
            _buf = "";
        } else if (c != '\r') {
            if (_buf.length() < 120) _buf += c;
        }
    }
    /* مانیتورهایی که فقط CR می‌فرستند یا بدون Line Ending هستند:
       اگر بافر پر شده و ۵۰ms سکوت شد، همان را اجرا کن */
    if (_buf.length() > 0 && millis() - _lastCharMs > 50) {
        _execute(_buf);
        _buf = "";
    }
}

void SerialCLI::_execute(const String& raw) {
    String cmd = raw;
    cmd.trim();
    if (cmd.length() == 0) return;

    const bool silent = _ack;   // ON = هیچ پیامی از برد چاپ نمی‌شود

    if (!silent) {
        Serial.print("> ");
        Serial.println(cmd);
    }
    if (_log) _log(cmd.c_str());

    /* دستورات متای ACK — خودشان هم در حالت ساکت جواب می‌دهند وگرنه گیر می‌کنی */
    if (cmd == "ack on")  { ack(true);  return; }
    if (cmd == "ack off") { ack(false); return; }
    if (cmd == "ack")     { Serial.println(_ack ? ">> Ack mode is ON (silent)" : ">> Ack mode is OFF (confirmations)"); return; }

    bool known = _dispatch ? _dispatch(cmd) : false;
    if (!known) {
        Serial.println("Unknown command");
        return;
    }
    /* تاییدیه فقط وقتی که ساکت نیستیم + برای status (که خودکار poll می‌شود) هرگز */
    if (!silent && cmd != String("status")) {
        Serial.print(">> ACK: ");
        Serial.print(cmd);
        Serial.println(" - executed");
    }
}
