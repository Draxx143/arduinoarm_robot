#include "SerialCLI.h"

bool gCliMute = false;   // ack ON = سکوت کامل برد

void SerialCLI::begin(unsigned long baud, DispatchFn dispatch) {
    _dispatch = dispatch;
    _buf.reserve(120);
    Serial.begin(baud);
}

/* FIX/SEMANTICS: حالت ON یعنی برد «ساکت» است (هیچ پیامی به مانیتور نمی‌رود)
 * و حالت OFF یعنی تاییدیه‌ها فعال‌اند. پیش‌فرض بعد از بوت: OFF (تاییدیه روشن) */
void SerialCLI::ack(bool on) {
    _ack = on;
    gCliMute = on;
    Serial.println(on ? ">> Ack mode ON - board is SILENT (no serial chatter)"
                      : ">> Ack mode OFF - confirmations enabled");
}

void SerialCLI::poll() {
    while (Serial.available() > 0) {
        char c = (char)Serial.read();
        _lastCharMs = millis();
        if (c == '\n') {
            _finishLine();
        } else if (c != '\r') {
            if (_buf.length() < 120) _buf += c;
            else _over = true;   /* نگهبان سرریز: خط‌های ناقص هرگز اجرا نمی‌شوند */
        }
    }
    /* مانیتورهایی که فقط CR می‌فرستند یا بدون Line Ending هستند:
       بعد از ۱۵۰ms سکوت اجرا کن — آستانه‌ی بالاتر یعنی بایت‌هایی که USB
       با فاصله می‌رساند وسط خط اسپلیت نمی‌شوند (ریشه‌ی «Unknown command») */
    if (_buf.length() > 0 && millis() - _lastCharMs > 150) {
        _finishLine();
    }
}

/* پایان خط (LF یا idle-flush): اگر وسط ارسال سیلانی پرشده بود، کل خط را
 * دور بریز — اجرای یک دستور بریده خطرناک است (Unknown/خارج از محدوده) */
void SerialCLI::_finishLine() {
    if (_over) {
        _buf = "";
        _over = false;
        if (!_ack) Serial.println("!! line too long - dropped");
        return;
    }
    if (_buf.length() == 0) return;
    /* تکه‌های بسیار کوتاه (مثل «de» از یک خط اسپلیت‌شده) هرگز اجرا نمی‌شوند —
       هیچ دستوری در پروتکل کوتاه‌تر از ۳ کاراکتر ندارد */
    if (_buf.length() < 3) {
        _buf = "";
        return;
    }
    _execute(_buf);
    _buf = "";
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
