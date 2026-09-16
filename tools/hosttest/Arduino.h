// =====================================================================
//  Arduino.h — stub برای کامپایل/لینک/اجرای فریم‌ور روی host (g++).
//  هدف: گرفتن خطاهای کامپایل، خطاهای لینک (undefined reference) و
//  رفتار واقعی موتور/هومینگ قبل از پروگرام کردن برد.
//
//  این فایل فقط برای تست است و هرگز روی AVR کامپایل نمی‌شود.
// =====================================================================
#ifndef ARDUINO_HOST_STUB_H
#define ARDUINO_HOST_STUB_H

#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <cmath>
#include <string>
#include <deque>

#define ARDUINO   10819
#define F_CPU     16000000L

// ---- F() / PROGMEM: روی host حافظه‌ی فلش جدا وجود ندارد ----
#define F(x) x
#define PROGMEM
#define PSTR(x) x
#define pgm_read_byte(p)  (*(const uint8_t*)(p))
#define pgm_read_word(p)  (*(const uint16_t*)(p))
#define pgm_read_dword(p) (*(const uint32_t*)(p))
#define pgm_read_float(p) (*(const float*)(p))
#define pgm_read_ptr(p)   (*(void* const*)(p))

typedef uint8_t byte;
typedef bool    boolean;

#define HIGH 0x1
#define LOW  0x0
#define INPUT        0x0
#define OUTPUT       0x1
#define INPUT_PULLUP 0x2
#define LSBFIRST 0
#define MSBFIRST 1
#define LED_BUILTIN 13

// ---- توابع کمکی آردوینو ----
#ifndef constrain
#define constrain(amt, low, high) ((amt) < (low) ? (low) : ((amt) > (high) ? (high) : (amt)))
#endif
/* min/max به‌صورت template و نه macro: ماکرویی که اینجا تعریف شود
   هدرهای استاندارد C++ (<fstream>, <algorithm>) را می‌شکند، چون آن‌ها
   تابع‌های عضو min()/max() دارند. */
template<typename A, typename B>
inline auto min(A a, B b) -> decltype(a < b ? a : b) { return a < b ? a : b; }
template<typename A, typename B>
inline auto max(A a, B b) -> decltype(a > b ? a : b) { return a > b ? a : b; }
#ifndef abs
#define abs(x) ((x) > 0 ? (x) : -(x))
#endif
#define sq(x) ((x) * (x))
#define radians(d) ((d) * 0.017453292519943295f)
#define degrees(r) ((r) * 57.29577951308232f)

// =====================================================================
//  زمان مجازی — فقط توسط هارنس تست جلو می‌رود
// =====================================================================
extern uint64_t sim_micros;
unsigned long millis();
unsigned long micros();
void delay(unsigned long ms);
void delayMicroseconds(unsigned int us);

// =====================================================================
//  پین‌ها و پورت‌ها
//  فریم‌ور مستقیم روی رجیستر پورت می‌نویسد (*_stepPort |= _stepMask)،
//  پس این آرایه‌ها همان رجیسترهای شبیه‌سازی‌شده هستند. هارنس می‌تواند
//  آن‌ها را بخواند تا مستقل از کد فریم‌ور، استپ‌ها را بشمارد.
// =====================================================================
#define SIM_NUM_PORTS 12
extern volatile uint8_t g_port_out[SIM_NUM_PORTS];   // PORTx
extern volatile uint8_t g_port_in[SIM_NUM_PORTS];    // PINx  (endstop/estop)
extern volatile uint8_t g_port_ddr[SIM_NUM_PORTS];   // DDRx

uint8_t digitalPinToPort(uint8_t pin);
uint8_t digitalPinToBitMask(uint8_t pin);
volatile uint8_t* portOutputRegister(uint8_t port);
volatile uint8_t* portInputRegister(uint8_t port);
volatile uint8_t* portModeRegister(uint8_t port);

void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t val);
int  digitalRead(uint8_t pin);
int  analogRead(uint8_t pin);
void analogWrite(uint8_t pin, int val);

// پین‌های آنالوگ A0..A15 = شماره‌ی 54..69
#define A0 54
#define A1 55
#define A2 56
#define A3 57
#define A4 58
#define A5 59
#define A6 60
#define A7 61
#define A8 62
#define A9 63
#define A10 64
#define A11 65
#define A12 66
#define A13 67
#define A14 68
#define A15 69

// --- ابزار هارنس ---
void sim_set_input(uint8_t pin, bool high);      // ورودی (endstop/estop)
bool sim_read_output(uint8_t pin);               // خروجی (STEP/DIR/EN)
void sim_reset_pins();

// =====================================================================
//  Timer1 — فقط تا حدی که کد کامپایل شود. ISR واقعی را هارنس صدا می‌زند.
// =====================================================================
extern volatile uint8_t  TCCR1A, TCCR1B, TIMSK1, SREG;
extern volatile uint16_t OCR1A, TCNT1;
#define WGM12   3
#define CS10    0
#define CS11    1
#define CS12    2
#define OCIE1A  1
#define TIMER1_COMPA_vect host_timer1_compa
#define cli()  do {} while (0)
#define sei()  do {} while (0)
#define interrupts()   do {} while (0)
#define noInterrupts() do {} while (0)
// ISR(x) {...} روی host به یک تابع بی‌استفاده تبدیل می‌شود
#define ISR(v) static void host_isr_stub_##v(void)

// =====================================================================
//  String — فقط متدهایی که فریم‌ور استفاده می‌کند
// =====================================================================
class String {
public:
    String() {}
    String(const char* s) : _s(s ? s : "") {}
    String(const std::string& s) : _s(s) {}
    String(int v)      : _s(std::to_string(v)) {}
    String(long v)     : _s(std::to_string(v)) {}
    String(unsigned v) : _s(std::to_string(v)) {}
    String(float v, int dec = 2) { char b[32]; snprintf(b, sizeof(b), "%.*f", dec, v); _s = b; }

    unsigned int length() const { return (unsigned int)_s.size(); }
    const char*  c_str()  const { return _s.c_str(); }

    long   toInt()   const { return strtol(_s.c_str(), nullptr, 10); }
    float  toFloat() const { return (float)strtod(_s.c_str(), nullptr); }

    String substring(unsigned int from) const {
        if (from >= _s.size()) return String();
        return String(_s.substr(from));
    }
    String substring(unsigned int from, unsigned int to) const {
        if (from >= _s.size()) return String();
        if (to > _s.size()) to = (unsigned int)_s.size();
        if (to < from) return String();
        return String(_s.substr(from, to - from));
    }
    int indexOf(char c, unsigned int from = 0) const {
        size_t p = _s.find(c, from);
        return (p == std::string::npos) ? -1 : (int)p;
    }
    int indexOf(const String& s, unsigned int from = 0) const {
        size_t p = _s.find(s._s, from);
        return (p == std::string::npos) ? -1 : (int)p;
    }
    void trim() {
        size_t a = _s.find_first_not_of(" \t\r\n");
        size_t b = _s.find_last_not_of(" \t\r\n");
        _s = (a == std::string::npos) ? "" : _s.substr(a, b - a + 1);
    }
    bool startsWith(const String& p) const { return _s.compare(0, p._s.size(), p._s) == 0; }
    bool endsWith(const String& p) const {
        return _s.size() >= p._s.size() &&
               _s.compare(_s.size() - p._s.size(), p._s.size(), p._s) == 0;
    }
    bool equals(const String& o) const { return _s == o._s; }
    char charAt(unsigned int i) const { return (i < _s.size()) ? _s[i] : '\0'; }

    String& operator+=(const String& o) { _s += o._s; return *this; }
    String  operator+(const String& o) const { return String(_s + o._s); }
    bool    operator==(const String& o) const { return _s == o._s; }
    bool    operator!=(const String& o) const { return _s != o._s; }
    bool    operator==(const char* o)   const { return _s == (o ? o : ""); }
    char&   operator[](unsigned int i)  { return _s[i]; }

private:
    std::string _s;
};

// =====================================================================
//  Serial
// =====================================================================
class HostSerial {
public:
    void begin(unsigned long) {}
    void end() {}
    explicit operator bool() const { return true; }

    // خروجی
    void print(const char* s)        { if (s) fputs(s, stdout); }
    void print(const String& s)      { fputs(s.c_str(), stdout); }
    void print(char c)               { fputc(c, stdout); }
    void print(int v)                { printf("%d", v); }
    void print(unsigned int v)       { printf("%u", v); }
    void print(long v)               { printf("%ld", v); }
    void print(unsigned long v)      { printf("%lu", v); }
    // نکته: روی host، int32_t همان int و uint32_t همان unsigned int است،
    // پس overload جدا برایشان تعریف نمی‌کنیم (خطای «cannot be overloaded»).
    void print(int16_t v)            { printf("%d", (int)v); }
    void print(uint16_t v)           { printf("%u", (unsigned)v); }
    void print(uint8_t v)            { printf("%u", (unsigned)v); }
    void print(double v, int dec = 2){ printf("%.*f", dec, v); }
    void print(float v, int dec = 2) { printf("%.*f", dec, (double)v); }

    void println()                   { fputc('\n', stdout); }
    template<typename T> void println(const T& v) { print(v); fputc('\n', stdout); }
    void println(double v, int d)    { print(v, d); fputc('\n', stdout); }
    void println(float v, int d)     { print(v, d); fputc('\n', stdout); }

    // ورودی — از صفی که هارنس پر می‌کند
    int    available();
    int    read();
    String readStringUntil(char term);
    String readString();

    void flush() { fflush(stdout); }
};
extern HostSerial Serial;

// تزریق یک خط دستور به سریال شبیه‌سازی‌شده (برای تست هندلرهای دستور)
void host_feed(const char* line);

#endif // ARDUINO_HOST_STUB_H
