// =====================================================================
//  پیاده‌سازی stub ها برای تست روی host
// =====================================================================
#include "Arduino.h"
#include <deque>

// ---- زمان مجازی ----
uint64_t sim_micros = 0;

unsigned long millis() { return (unsigned long)(sim_micros / 1000ULL); }
unsigned long micros() { return (unsigned long)(sim_micros & 0xFFFFFFFFULL); }

void delay(unsigned long ms) {
    // یک delay واقعی زمان مجازی را جلو می‌برد
    sim_micros += (uint64_t)ms * 1000ULL;
}
void delayMicroseconds(unsigned int us) {
    // عمدی: زمان را جلو نمی‌بریم. این فراخوانی داخل ISR و در بودجه‌ی
    // همان تیک ۵۰ میکروثانیه‌ای انجام می‌شود، پس ساعت را هارنس می‌چرخاند.
    (void)us;
}

// ---- رجیسترهای تایمر ----
volatile uint8_t  TCCR1A = 0, TCCR1B = 0, TIMSK1 = 0, SREG = 0;
volatile uint16_t OCR1A = 0, TCNT1 = 0;

// ---- پورت‌ها ----
volatile uint8_t g_port_out[SIM_NUM_PORTS] = {0};
volatile uint8_t g_port_in[SIM_NUM_PORTS]  = {0};
volatile uint8_t g_port_ddr[SIM_NUM_PORTS] = {0};

uint8_t digitalPinToPort(uint8_t pin)    { return (uint8_t)(pin >> 3); }
uint8_t digitalPinToBitMask(uint8_t pin) { return (uint8_t)(1u << (pin & 7)); }

volatile uint8_t* portOutputRegister(uint8_t port) {
    return (port < SIM_NUM_PORTS) ? &g_port_out[port] : &g_port_out[0];
}
volatile uint8_t* portInputRegister(uint8_t port) {
    return (port < SIM_NUM_PORTS) ? &g_port_in[port] : &g_port_in[0];
}
volatile uint8_t* portModeRegister(uint8_t port) {
    return (port < SIM_NUM_PORTS) ? &g_port_ddr[port] : &g_port_ddr[0];
}

void pinMode(uint8_t pin, uint8_t mode) {
    uint8_t p = digitalPinToPort(pin), m = digitalPinToBitMask(pin);
    if (mode == OUTPUT) {
        g_port_ddr[p] |= m;
    } else {
        g_port_ddr[p] &= (uint8_t)~m;
        if (mode == INPUT_PULLUP) g_port_in[p] |= m;   // پول‌آپ → HIGH = آزاد
        else                      g_port_in[p] &= (uint8_t)~m;
    }
}

void digitalWrite(uint8_t pin, uint8_t val) {
    uint8_t p = digitalPinToPort(pin), m = digitalPinToBitMask(pin);
    if (val) g_port_out[p] |= m; else g_port_out[p] &= (uint8_t)~m;
}

int digitalRead(uint8_t pin) {
    uint8_t p = digitalPinToPort(pin), m = digitalPinToBitMask(pin);
    return (g_port_in[p] & m) ? HIGH : LOW;
}

int analogRead(uint8_t pin) { (void)pin; return 0; }
void analogWrite(uint8_t pin, int val) { digitalWrite(pin, val ? HIGH : LOW); }

void sim_set_input(uint8_t pin, bool high) {
    uint8_t p = digitalPinToPort(pin), m = digitalPinToBitMask(pin);
    if (high) g_port_in[p] |= m; else g_port_in[p] &= (uint8_t)~m;
}
bool sim_read_output(uint8_t pin) {
    uint8_t p = digitalPinToPort(pin), m = digitalPinToBitMask(pin);
    return (g_port_out[p] & m) != 0;
}
void sim_reset_pins() {
    for (int i = 0; i < SIM_NUM_PORTS; i++) {
        g_port_out[i] = 0; g_port_in[i] = 0; g_port_ddr[i] = 0;
    }
}

// ---- Serial ----
HostSerial Serial;

static std::deque<std::string> g_serial_in;

void host_feed(const char* line) { g_serial_in.push_back(line ? line : ""); }

int HostSerial::available() {
    return g_serial_in.empty() ? 0 : (int)g_serial_in.front().size();
}
int HostSerial::read() { return -1; }
String HostSerial::readString() {
    if (g_serial_in.empty()) return String();
    std::string s = g_serial_in.front();
    g_serial_in.pop_front();
    return String(s.c_str());
}
String HostSerial::readStringUntil(char term) {
    (void)term;
    return readString();
}
