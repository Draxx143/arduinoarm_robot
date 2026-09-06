#include "SerialCLI.h"

void SerialCLI::begin(unsigned long baud, DispatchFn dispatch) {
    _dispatch = dispatch;
    _buf.reserve(120);
    Serial.begin(baud);
}

void SerialCLI::ack(bool on) {
    _ack = on;
    Serial.println(on ? ">> Ack mode ON - every command will be confirmed"
                      : ">> Ack mode OFF - commands run silently");
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

    Serial.print("> ");
    Serial.println(cmd);
    if (_log) _log(cmd.c_str());

    /* دستورات متای ACK — مستقیماً توسط کتابخانه */
    if (cmd == "ack on")  { ack(true);  return; }
    if (cmd == "ack off") { ack(false); return; }
    if (cmd == "ack")     { Serial.println(_ack ? ">> Ack mode is ON" : ">> Ack mode is OFF"); return; }

    bool known = _dispatch ? _dispatch(cmd) : false;
    if (!known) {
        Serial.println("Unknown command");
        return;
    }
    if (_ack) {
        Serial.print(">> ACK: ");
        Serial.print(cmd);
        Serial.println(" - executed");
    }
}
