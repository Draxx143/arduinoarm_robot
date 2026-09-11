// =====================================================================
//  تست لینک + اسموک‌تست کامل:
//   ۱) همه‌ی .cpp های اسکچ (از جمله ROS_Interface.cpp) کامپایل و لینک
//      می‌شوند -> خطاهای «undefined reference» گرفته می‌شوند.
//   ۲) setup() و loop() واقعاً اجرا می‌شوند.
//   ۳) همه‌ی دستورات سریال یکی‌یکی تزریق و اجرا می‌شوند -> کرش،
//      حلقه‌ی بی‌پایان و هندلرهای نشکسته مشخص می‌شوند.
// =====================================================================
#include "Arduino.h"
#include "MotorController.h"
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

extern uint64_t sim_micros;
void setup();
void loop();

// شبیه‌سازی ISR تایمر بین دستورهای سریال
static void tick(int n) {
    for (int i = 0; i < n; i++) {
        if (globalController) globalController->update();
        sim_micros += 1000000ULL / (uint64_t)STEP_TICK_FREQ;
    }
}

static const char* CMDS[] = {
    "status", "speeds", "profile", "speed", "help",
    // ---- هومینگ و اولویت ----
    "home", "abort",
    "homeorder", "home order",
    "homeorder 1 2 3 4 5", "homeorder 3 2 1 4 5", "homeorder 1 1 2 3 4",
    "homeorder 1 2 3 4 9", "homeorder 1 2 3",
    "homeorder 1 2 3 4 5",
    "home 3", "abort",
    // ---- فعال/غیرفعال ----
    "enable", "enable 1", "disable 2", "enable 2", "disable",
    "enable 7", "disable 7", "enable",
    // ---- حرکت ----
    "home", "abort",
    "move 1 500", "deg 1 30", "deg 9 30", "deg 1 999",
    "moveall 10 20 10 10 10", "moveall", "moveall 10 20",
    "move 7 100", "move",
    // ---- سرعت/پروفایل ----
    "speed 150", "speed", "speed 999", "profile fast", "profile slow",
    "profile normal", "profile bogus",
    "maxspeed 1 3000", "maxspeed", "maxspeed 9 3000",
    "accel 1 8000", "accel", "homespeed 1 1200", "homespeed",
    // ---- موقعیت‌ها ----
    "savepos 1", "loadpos 1", "listpos", "clearpos 1", "loadpos 7", "savepos",
    // ---- تایمر ----
    "timer 500 1 20", "timers", "cleartimers", "timer", "timer 500",
    // ---- teach ----
    "teach", "teach step", "teach count", "teach stop", "play", "play stop",
    // ---- لاگ ----
    "log on", "log show", "log clear", "log off", "log",
    // ---- trajectory / IK / FK ----
    "traj line 10 20 10 10 10 2000", "traj line 10", "traj stop", "traj",
    "ik 100 50 50", "ik", "fk 10 20 30 0 0", "fk 10",
    // ---- انرژی ----
    "sleep", "wake", "autosleep on", "autosleep off",
    // ---- دمو / ایمنی ----
    "demo", "stopdemo", "estop", "reset", "stop",
    // ---- نامعتبر ----
    "nosuchcommand", "", "   ",
};

// اگر یک نام فایل داده شود، دستورات از همان فایل خوانده می‌شوند
// (برای تست انطباق GUI ↔ فریم‌ور)؛ وگرنه لیست داخلی اجرا می‌شود.
static std::vector<std::string> loadCommands(int argc, char** argv) {
    std::vector<std::string> out;
    if (argc > 1) {
        std::ifstream f(argv[1]);
        if (!f) { fprintf(stderr, "!! cannot open %s\n", argv[1]); exit(2); }
        std::string line;
        while (std::getline(f, line)) {
            while (!line.empty() && (line.back() == '\r' || line.back() == '\n')) line.pop_back();
            if (!line.empty()) out.push_back(line);
        }
        printf("[SMOKE TEST] %d command(s) read from %s\n", (int)out.size(), argv[1]);
    } else {
        for (const char* c : CMDS) out.push_back(c);
    }
    return out;
}

int main(int argc, char** argv) {
    setup();
    tick(100);

    std::vector<std::string> cmds = loadCommands(argc, argv);
    int n = (int)cmds.size();

    for (int i = 0; i < n; i++) {
        host_feed(cmds[i].c_str());
        loop();
        tick(4000);          // 200ms بین دستورات
        loop();
    }

    tick(400000);            // 20 ثانیه برای تمام شدن حرکت‌های باقی‌مانده
    loop();

    printf("\n[SMOKE TEST] %d serial command(s) executed without crash\n", n);
    printf("[SMOKE TEST] compile + link + setup() + loop() + all commands OK\n");
    return 0;
}
