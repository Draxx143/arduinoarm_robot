// =====================================================================
//  بدلِ host برای کتابخانه‌ی Servo آردوینو.
//
//  روی بردِ واقعی، <Servo.h> کتابخانه‌ی استاندارد آردوینوست و Gripper
//  با آن حرف می‌زند؛ ولی روی host (تست‌های tools/hosttest) آن کتابخانه
//  نیست. چون فلگ -I$HT قبل از بقیه می‌آید، این فایل همان #include
//  <Servo.h> را جواب می‌دهد و رفتار قابل مشاهده را نگه می‌دارد: وضعیت
//  attach و آخرین زاویه/پالس نوشته‌شده قابل بازخوانی است تا sim_main
//  بتواند حرکت پنجه را مستقل از کد فریم‌ور تأیید کند.
// =====================================================================
#ifndef HOST_SERVO_H
#define HOST_SERVO_H

#include <stdint.h>

class Servo {
public:
    Servo()
        : _attached(false), _pin(-1)
        , _minUs(544), _maxUs(2400)
        , _angle(90), _micros(1500)
    {}

    uint8_t attach(int pin) {
        return attach(pin, 544, 2400);
    }

    uint8_t attach(int pin, int minUs, int maxUs) {
        _pin = pin;
        _minUs = minUs;
        _maxUs = maxUs;
        _attached = true;
        write(_angle);
        return 0;
    }

    void detach() {
        _attached = false;
    }

    void write(int value) {
        // مثل کتابخانه‌ی واقعی: زیر 544 یعنی درجه (۰..۱۸۰)، وگرنه µs.
        if (value < 200) {
            if (value < 0) value = 0;
            if (value > 180) value = 180;
            _angle = value;
            _micros = _minUs + (int)(((long)(_maxUs - _minUs) * value) / 180L);
        } else {
            writeMicroseconds(value);
        }
    }

    void writeMicroseconds(int value) {
        _micros = value;
        long span = (long)(_maxUs - _minUs);
        _angle = (span > 0)
            ? (int)(((long)(value - _minUs) * 180L) / span)
            : 90;
    }

    int read() { return _angle; }
    int readMicroseconds() { return _micros; }
    bool attached() const { return _attached; }

    // --- فقط برای تست‌ها ---
    int attachedPin() const { return _pin; }

private:
    bool _attached;
    int  _pin;
    int  _minUs, _maxUs;
    int  _angle, _micros;
};

#endif // HOST_SERVO_H
