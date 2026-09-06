#ifndef SERIAL_CLI_H
#define SERIAL_CLI_H

#include <Arduino.h>

/* کلید سکوت سراسری: وقتی true است هیچ ماژولی چیزی به مانیتور چاپ نمی‌کند
 * (فقط جواب خود دستورات ack در SerialCLI مستثنا است) */
extern bool gCliMute;
#define C_PRINT(...)   do { if (!gCliMute) Serial.print(__VA_ARGS__); } while (0)
#define C_PRINTLN(...) do { if (!gCliMute) Serial.println(__VA_ARGS__); } while (0)

/* ============================================================
 * SerialCLI — کتابخانه‌ی تمیز کنسول سریال
 * ============================================================
 *  - خواندن کاراکتر‌به‌کاراکترِ غیرمسدودساز (بدون readStringUntil
 *    و بدون هیچ تایم‌اوت — حلقه‌ی اصلی هرگز فریز نمی‌شود)
 *  - با هر تنظیم Line Ending مانیتور کار می‌کند (NL / CR / Both)
 *  - اکوی دستور ("> cmd") + هوک لاگ + حالت سکوت/تاییدیه
 *  - ack on  = برد ساکت (هیچ پیامی جز جواب مستقیم) | ack off = تاییدیه فعال (پیش‌فرض)
 *  - دستورات meta خودش:  ack on / ack off / ack
 *  - dispatch: یک تابع که دستور را اجرا می‌کند و «شناخته‌شده بودن»
 *    را برمی‌گرداند؛ برای نامعلوم خودش "Unknown command" چاپ می‌کند
 * ============================================================ */
class SerialCLI {
public:
    typedef bool (*DispatchFn)(const String& command); // true = شناخته‌شده
    typedef void (*LogFn)(const char* text);

    void begin(unsigned long baud, DispatchFn dispatch);
    void setLogFn(LogFn fn) { _log = fn; }

    void ack(bool on);                 // تغییر حالت + پیام
    bool ack() const { return _ack; }

    void poll();                       // هر بار در loop() صدا زده شود

private:
    void _execute(const String& raw);
    void _finishLine();
    DispatchFn _dispatch = nullptr;
    LogFn      _log = nullptr;
    bool       _ack = false;
    String     _buf;
    bool       _over = false;   // خط از ۱۲۰ کاراکتر گذشت — تا پایانش دور ریخته می‌شود
    unsigned long _lastCharMs = 0;
};

#endif
