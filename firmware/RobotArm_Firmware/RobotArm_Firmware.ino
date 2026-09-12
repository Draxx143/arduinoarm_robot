// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Draxx143 — AXIS-5 Robot Arm
// https://github.com/Draxx143/arduinoarm_robot
/*
 * 5 DOF Robot Arm Firmware — TEST MODE (بدون ROS)
 *
 * دستورات قابل استفاده در Serial Monitor:
 *   home / home <axis>       -> هوم هوشمند (غیرمسدودکننده)
 *   status / speeds          -> وضعیت و جدول سرعت‌ها
 *   enable / disable         -> موتورها (تک‌محور یا همه)
 *   move / deg / moveall     -> حرکت
 *   speed <percent>          -> ضریب سرعت کل دستگاه (مثلاً speed 150)
 *   profile slow|normal|fast -> پروفایل سرعت (حالا واقعاً اعمال می‌شه)
 *   maxspeed / accel / homespeed <axis> <value>  -> تنظیم زنده
 *   demo / stopdemo          -> حرکت نمایشی
 *   savepos / loadpos        -> ذخیره و بازیابی موقعیت
 *   timer / teach / play     -> تایمر و حالت آموزش
 *   traj line <d1..d5> <ms>  -> حرکت هماهنگ همه‌ی محورها در زمان مشخص
 *   ik / fk                  -> سینماتیک معکوس و مستقیم
 *   sleep / wake             -> مدیریت مصرف
 *   estop / reset / stop     -> توقف اضطراری
 */

#include "Config.h"
#include "MotorController.h"
#include "PositionStore.h"
#include "TimerManager.h"
#include "TeachMode.h"
#include "Logger.h"
#include "SpeedProfile.h"
#include "Trajectory.h"
#include "IK.h"
#include "EnergyManager.h"

// Global objects
MotorController* motorController;
PositionStore positionStore;
TimerManager timerManager;
TeachMode teachMode;
Logger logger;
SpeedProfileManager speedProfile;
Trajectory trajectory;
IK kinematics;
EnergyManager energyManager;

#define STATUS_LED_PIN 13

enum SystemState {
    STATE_INIT,
    STATE_HOMING,
    STATE_READY,
    STATE_MOVING,
    STATE_ERROR,
    STATE_ESTOP
};

SystemState systemState = STATE_INIT;
unsigned long lastHeartbeat = 0;
unsigned long heartbeatInterval = 1000;

// ضرایب تبدیل درجه به استپ — در setup() از خود Config.h/محورها محاسبه می‌شن
// (قبلاً این جدول دستی نوشته شده بود و با Config.h هم‌خوانی نداشت)
float DEG_TO_STEPS[NUM_AXES];

// محدوده درجه هر محور
const float AXIS_MIN_DEG[NUM_AXES] = {
    -110.0, 0.0, 0.0, -90.0, -90.0
};
const float AXIS_MAX_DEG[NUM_AXES] = {
    110.0, 100.0, 55.0, 90.0, 90.0
};

// متغیرهای دمو
bool demoRunning = false;
int demoStep = 0;
int demoRepeat = 0;
const int DEMO_MAX_REPEATS = 3;
const int DEMO_DELAY_MS = 1500;
unsigned long lastDemoMove = 0;

const float DEMO_MOVES[][NUM_AXES] = {
    {0, 0, 0, 0, 0},
    {45, 30, 20, 15, 10},
    {-45, 50, 40, -15, -10},
    {30, 80, 50, 30, 20},
    {-30, 20, 10, -30, -20},
    {0, 0, 0, 0, 0}
};
const int DEMO_MOVE_COUNT = 6;

// نرخ به‌روزرسانی trajectory (برای جلوگیری از بمباران moveTo)
unsigned long lastTrajectoryUpdate = 0;
const unsigned long TRAJECTORY_UPDATE_MS = 20;

// Callback برای TeachMode
void teachMoveCallback(const int32_t positions[]) {
    motorController->moveAllAxes((int32_t*)positions);
}

// Callback برای TimerManager — وقتی تایمر شلیک شد واقعاً حرکت کن
void timerFireCallback(uint8_t axis, int32_t target) {
    if (motorController && axis < NUM_AXES) {
        motorController->moveTo(axis, target);
    }
}

bool allAxesHomed() {
    for (int i = 0; i < NUM_AXES; i++) {
        if (!motorController->getAxis(i)->isHomed()) return false;
    }
    return true;
}

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println(F("======================================"));
    Serial.println(F("5 DOF Robot Arm - TEST MODE (No ROS)"));
    Serial.println(F("AXIS-5 Firmware v" FIRMWARE_VERSION));
    Serial.println(F("======================================"));

    pinMode(STATUS_LED_PIN, OUTPUT);
    digitalWrite(STATUS_LED_PIN, HIGH);

    motorController = new MotorController();
    motorController->init();
    motorController->startControlLoop();

    // محاسبه‌ی ضریب درجه→استپ مستقیم از تنظیمات هر محور
    for (int i = 0; i < NUM_AXES; i++) {
        DEG_TO_STEPS[i] = motorController->getAxis(i)->getStepsPerDegree();
    }

    // اتصال پروفایل سرعت به موتورها (بدون این، profile هیچ اثری نداشت)
    speedProfile.attach(motorController);

    // اتصال تایمرها به موتور (قبلاً دستور timer فقط پیام چاپ می‌کرد)
    timerManager.setCallback(timerFireCallback);

    positionStore.begin();

    Serial.println(F("Basic Commands:"));
    Serial.println(F("  home, home <1-5>     - Smart homing"));
    Serial.println(F("  status, speeds       - Show status"));
    Serial.println(F("  enable/disable       - Motor control"));
    Serial.println(F("  move/deg/moveall     - Movement"));
    Serial.println(F("  demo                 - Demo loop"));
    Serial.println(F("Speed Commands:"));
    Serial.println(F("  speed <percent>      - Global speed scale (e.g. speed 150)"));
    Serial.println(F("  profile slow/normal/fast"));
    Serial.println(F("  maxspeed <axis> <steps/s>"));
    Serial.println(F("  accel <axis> <steps/s2>"));
    Serial.println(F("  homespeed <axis> <steps/s>"));
    Serial.println(F("Advanced Commands:"));
    Serial.println(F("  savepos/loadpos/listpos/clearpos"));
    Serial.println(F("  timer <ms> <axis> <target>"));
    Serial.println(F("  teach / teach stop / play"));
    Serial.println(F("  log on/off/show/clear"));
    Serial.println(F("  traj line <d1> <d2> <d3> <d4> <d5> <ms>"));
    Serial.println(F("  ik <x> <y> <z> / fk <a1..a5>"));
    Serial.println(F("  sleep / wake / autosleep on|off"));
    Serial.println(F("  estop / reset / stop"));
    Serial.println(F("======================================"));

    printSpeeds();

    systemState = STATE_INIT;
    Serial.println(F("System initialized."));
    Serial.println(F("======================================"));
}

void loop() {
    updateSystemState();
    updateHeartbeat();
    handleSerialCommands();
    executeDemo();
    timerManager.update();
    teachMode.update();
    updateTrajectory();
    updateEnergyManager();
}

void updateEnergyManager() {
    energyManager.update(motorController->isAnyMoving());
}

void updateTrajectory() {
    if (!trajectory.isActive()) return;

    // محدود کردن نرخ ارسال تا پروفایل سرعت مدام ریست نشه
    unsigned long now = millis();
    if (now - lastTrajectoryUpdate < TRAJECTORY_UPDATE_MS) return;
    lastTrajectoryUpdate = now;

    int32_t target[NUM_AXES];
    for (int i = 0; i < NUM_AXES; i++) {
        target[i] = motorController->getAxis(i)->getCurrentPosition();
    }

    trajectory.update(target);
    motorController->streamAllAxes(target);
}

void updateSystemState() {
    switch (systemState) {
        case STATE_INIT:
            if (motorController->isHoming()) systemState = STATE_HOMING;
            else if (allAxesHomed()) systemState = STATE_READY;
            break;

        case STATE_HOMING:
            motorController->processHoming();
            if (motorController->allHomed()) {
                systemState = STATE_READY;
                Serial.println(F(">> System ready!"));
            } else if (!motorController->isHoming()) {
                // هومینگ تک‌محوری تمام شد یا خطا داد
                systemState = allAxesHomed() ? STATE_READY : STATE_INIT;
            }
            break;

        case STATE_READY:
            if (motorController->isAnyMoving()) systemState = STATE_MOVING;
            break;

        case STATE_MOVING:
            if (!motorController->isAnyMoving()) {
                systemState = STATE_READY;
                Serial.println(F(">> Move complete."));
            }
            break;

        case STATE_ERROR:
        case STATE_ESTOP:
            break;
    }
}

void updateHeartbeat() {
    unsigned long currentTime = millis();
    if (currentTime - lastHeartbeat >= heartbeatInterval) {
        lastHeartbeat = currentTime;
        digitalWrite(STATUS_LED_PIN, !digitalRead(STATUS_LED_PIN));
    }
}

void handleSerialCommands() {
    if (Serial.available() > 0) {
        String command = Serial.readStringUntil('\n');
        command.trim();
        if (command.length() == 0) return;

        // «pos» کانال همگام‌سازی GUI است و چند بار در ثانیه پرسیده می‌شود؛
        // اگر echo و لاگ داشت، کنسول و حلقه‌ی لاگ را پر می‌کرد.
        bool quietPoll = (command == F("pos"));
        if (!quietPoll) {
            Serial.print(F("> "));
            Serial.println(command);
            logger.log(command.c_str());
        }

        // ==================== Basic Commands ====================
        if (command == F("home")) {
            Serial.println(F("Starting homing of ALL joints (priority order J1 -> J5)..."));
            motorController->smartHoming();
            systemState = STATE_HOMING;
        }
        // ---- ترتیب اولویت هومینگ ----
        else if (command == F("homeorder") || command == F("home order")) {
            Serial.print(F(">> Homing priority: "));
            motorController->printHomingOrder();
            Serial.println(F(">> Each joint: search -> mandatory backoff -> verify endstop released"));
            Serial.println(F(">> Strictly sequential - next joint starts only after backoff of this one"));
            Serial.println(F(">> Change with: homeorder 1 2 3 4 5"));
        }
        else if (command.startsWith(F("homeorder "))) {
            handleHomingOrderCommand(command);
        }
        else if (command.startsWith(F("home "))) {
            int axis = command.substring(5).toInt() - 1;
            if (axis >= 0 && axis < NUM_AXES) {
                motorController->smartHomingAxis(axis);
                systemState = STATE_HOMING;
            } else {
                Serial.println(F("Invalid axis"));
            }
        }
        else if (command == F("abort")) {
            motorController->abortHoming();
            demoRunning = false;
            Serial.println(F(">> Homing/motion aborted"));
        }
        else if (command == F("status")) {
            printStatus();
        }
        else if (command == F("pos")) {
            // یک خط ماشین‌خوان برای همگام‌سازی اسلایدرهای GUI با برد
            printPos();
        }
        else if (command == F("speeds")) {
            printSpeeds();
        }
        else if (command == F("enable")) {
            motorController->enableAllMotors();
            Serial.println(F("All motors enabled"));
        }
        else if (command.startsWith(F("enable "))) {
            int axis = command.substring(7).toInt() - 1;
            if (axis >= 0 && axis < NUM_AXES) motorController->enableAxis(axis);
            else Serial.println(F("Invalid axis"));
        }
        else if (command == F("disable")) {
            motorController->disableAllMotors();
            Serial.println(F("All motors disabled"));
        }
        else if (command.startsWith(F("disable "))) {
            int axis = command.substring(8).toInt() - 1;
            if (axis >= 0 && axis < NUM_AXES) motorController->disableAxis(axis);
            else Serial.println(F("Invalid axis"));
        }
        else if (command == F("estop")) {
            motorController->emergencyStop();
            systemState = STATE_ESTOP;
            demoRunning = false;
            Serial.println(F("EMERGENCY STOP!"));
        }
        else if (command == F("reset")) {
            motorController->clearEmergencyStop();
            systemState = STATE_READY;
            Serial.println(F("Emergency stop cleared"));
        }
        else if (command == F("demo")) {
            startDemo();
        }
        else if (command == F("stopdemo")) {
            demoRunning = false;
            Serial.println(F(">> Demo stopped"));
        }
        else if (command == F("stop")) {
            demoRunning = false;
            trajectory.stop();
            for (int i = 0; i < NUM_AXES; i++) motorController->getAxis(i)->stop();
            Serial.println(F(">> Stopped (motors still enabled)"));
        }
        else if (command.startsWith(F("moveall "))) {
            demoRunning = false;
            handleMoveAllCommand(command);
        }
        else if (command == F("moveall")) {
            Serial.println(F("Format: moveall <d1> <d2> <d3> <d4> <d5>"));
        }
        else if (command.startsWith(F("deg "))) {
            demoRunning = false;
            handleDegCommand(command);
        }
        else if (command.startsWith(F("move "))) {
            demoRunning = false;
            handleMoveCommand(command);
        }
        // ==================== Speed / Profile ====================
        else if (command.startsWith(F("speed "))) {
            int pct = command.substring(6).toInt();
            if (pct < 5) pct = 5;
            if (pct > 400) pct = 400;
            speedProfile.setCustom((float)pct / 100.0f, (float)pct / 100.0f);
            Serial.print(F(">> Global speed scale: "));
            Serial.print(pct);
            Serial.println(F("% (applies to the next move)"));
            printSpeeds();
        }
        else if (command == F("speed")) {
            Serial.print(F(">> Current speed scale: "));
            Serial.print((int)(speedProfile.getMaxSpeedMultiplier() * 100.0f));
            Serial.println(F("%"));
        }
        else if (command.startsWith(F("profile "))) {
            String prof = command.substring(8);
            prof.trim();
            if (prof == F("slow"))        speedProfile.setProfile(PROFILE_SLOW);
            else if (prof == F("normal")) speedProfile.setProfile(PROFILE_NORMAL);
            else if (prof == F("fast"))   speedProfile.setProfile(PROFILE_FAST);
            else Serial.println(F("Use: profile slow/normal/fast"));
            printSpeeds();
        }
        else if (command == F("profile")) {
            Serial.print(F(">> Current profile: "));
            Serial.println(speedProfile.getProfileName());
        }
        else if (command.startsWith(F("maxspeed "))) {
            handleAxisValueCommand(command, 9, 0);   // 0 = maxspeed
        }
        else if (command.startsWith(F("accel "))) {
            handleAxisValueCommand(command, 6, 1);   // 1 = acceleration
        }
        else if (command.startsWith(F("homespeed "))) {
            handleAxisValueCommand(command, 10, 2);  // 2 = homing speed
        }
        // ==================== Position Store ====================
        else if (command.startsWith(F("savepos "))) {
            int slot = command.substring(8).toInt();
            int32_t positions[NUM_AXES];
            for (int i = 0; i < NUM_AXES; i++) {
                positions[i] = motorController->getAxis(i)->getCurrentPosition();
            }
            positionStore.save(slot, positions);
        }
        else if (command.startsWith(F("loadpos "))) {
            int slot = command.substring(8).toInt();
            int32_t positions[NUM_AXES];
            if (positionStore.load(slot, positions)) {
                motorController->moveAllAxes(positions);
                Serial.println(F(">> Moving to saved position"));
            }
        }
        else if (command == F("listpos")) {
            positionStore.list();
        }
        else if (command.startsWith(F("clearpos "))) {
            int slot = command.substring(9).toInt();
            positionStore.clear(slot);
            Serial.print(F(">> Position slot "));
            Serial.print(slot);
            Serial.println(F(" cleared"));
        }
        // ==================== Timer ====================
        else if (command.startsWith(F("timer "))) {
            // timer <ms> <axis> <degrees>
            int firstSpace = command.indexOf(' ');
            int secondSpace = command.indexOf(' ', firstSpace + 1);
            int thirdSpace = command.indexOf(' ', secondSpace + 1);

            if (secondSpace == -1) {
                Serial.println(F("Format: timer <ms> <axis 1-5> <degrees>"));
            } else {
                unsigned long delayMs = command.substring(firstSpace + 1, secondSpace).toInt();
                int axis = command.substring(secondSpace + 1,
                                             (thirdSpace == -1) ? (int)command.length() : thirdSpace).toInt() - 1;
                float degrees = (thirdSpace == -1) ? 0.0f
                                : command.substring(thirdSpace + 1).toFloat();

                if (axis < 0 || axis >= NUM_AXES) {
                    Serial.println(F("Invalid axis"));
                } else if (degrees < AXIS_MIN_DEG[axis] || degrees > AXIS_MAX_DEG[axis]) {
                    Serial.println(F("!! Timer target out of range"));
                } else {
                    int32_t target = (int32_t)(degrees * DEG_TO_STEPS[axis]);
                    if (timerManager.addTimer(delayMs, axis, target)) {
                        Serial.print(F(">> Timer set: axis "));
                        Serial.print(axis + 1);
                        Serial.print(F(" -> "));
                        Serial.print(degrees, 1);
                        Serial.print(F("° in "));
                        Serial.print(delayMs);
                        Serial.println(F(" ms"));
                    } else {
                        Serial.println(F("!! No free timer slot"));
                    }
                }
            }
        }
        else if (command == F("timers")) {
            Serial.print(F(">> Active timers: "));
            Serial.println(timerManager.getActiveCount());
        }
        else if (command == F("cleartimers")) {
            timerManager.clear();
            Serial.println(F(">> All timers cleared"));
        }
        // ==================== Teach Mode ====================
        else if (command == F("teach")) {
            teachMode.startRecording();
        }
        else if (command == F("teach stop")) {
            teachMode.stopRecording();
        }
        else if (command == F("teach step")) {
            int32_t positions[NUM_AXES];
            for (int i = 0; i < NUM_AXES; i++) {
                positions[i] = motorController->getAxis(i)->getCurrentPosition();
            }
            teachMode.recordStep(positions, 1000);
        }
        else if (command == F("play")) {
            teachMode.startPlayback(teachMoveCallback);
        }
        else if (command == F("play stop")) {
            teachMode.stopPlayback();
        }
        else if (command == F("teach count")) {
            Serial.print(F(">> Recorded steps: "));
            Serial.println(teachMode.getStepCount());
        }
        // ==================== Logger ====================
        else if (command == F("log on"))    { logger.enable(); }
        else if (command == F("log off"))   { logger.disable(); }
        else if (command == F("log show"))  { logger.show(); }
        else if (command == F("log clear")) { logger.clear(); }
        // ==================== Trajectory ====================
        else if (command.startsWith(F("traj line "))) {
            handleTrajLineCommand(command);
        }
        else if (command == F("traj stop")) {
            trajectory.stop();
        }
        // ==================== IK/FK ====================
        else if (command.startsWith(F("ik "))) {
            handleIKCommand(command);
        }
        else if (command.startsWith(F("fk "))) {
            handleFKCommand(command);
        }
        // ==================== Energy Manager ====================
        else if (command == F("sleep"))         { energyManager.sleep(); }
        else if (command == F("wake"))          { energyManager.wake(); }
        else if (command == F("autosleep on"))  { energyManager.enableAutoSleep(); }
        else if (command == F("autosleep off")) { energyManager.disableAutoSleep(); }
        else if (command == F("help"))          { printSpeeds(); printUsage(); }
        // ==================== راهنمای دستورات بدون آرگومان ====================
        else if (command == F("move"))      { Serial.println(F("Format: move <axis 1-5> <steps>")); }
        else if (command == F("deg"))       { Serial.println(F("Format: deg <axis 1-5> <degrees>")); }
        else if (command == F("maxspeed"))  { Serial.println(F("Format: maxspeed <axis 1-5> <steps/s>")); }
        else if (command == F("accel"))     { Serial.println(F("Format: accel <axis 1-5> <steps/s2>")); }
        else if (command == F("homespeed")) { Serial.println(F("Format: homespeed <axis 1-5> <steps/s>")); }
        else if (command == F("timer"))     { Serial.println(F("Format: timer <ms> <axis 1-5> <degrees>")); }
        else if (command == F("ik"))        { Serial.println(F("Format: ik <x> <y> <z>")); }
        else if (command == F("fk"))        { Serial.println(F("Format: fk <a1> <a2> <a3> <a4> <a5>")); }
        else if (command == F("traj"))      { Serial.println(F("Format: traj line <d1> <d2> <d3> <d4> <d5> <ms> | traj stop")); }
        else if (command == F("savepos"))   { Serial.println(F("Format: savepos <slot 0-9>")); }
        else if (command == F("loadpos"))   { Serial.println(F("Format: loadpos <slot 0-9>")); }
        else if (command == F("clearpos"))  { Serial.println(F("Format: clearpos <slot 0-9>")); }
        else if (command == F("log"))       { Serial.println(F("Format: log on|off|show|clear")); }
        else {
            Serial.println(F("Unknown command - send 'help'"));
        }
    }
}

// ==================== تنظیم زنده‌ی سرعت یک محور ====================
// kind: 0 = maxspeed, 1 = acceleration, 2 = homing speed
void handleAxisValueCommand(String command, int prefixLen, int kind) {
    int sp = command.indexOf(' ', prefixLen);
    if (sp == -1) {
        Serial.println(F("Format: <cmd> <axis 1-5> <value>"));
        return;
    }
    int axis = command.substring(prefixLen, sp).toInt() - 1;
    long value = command.substring(sp + 1).toInt();

    if (axis < 0 || axis >= NUM_AXES) {
        Serial.println(F("Invalid axis"));
        return;
    }
    if (value < 1) value = 1;
    if (value > MAX_SPEED_LIMIT) value = MAX_SPEED_LIMIT;

    if (kind == 0)      motorController->setAxisSpeed(axis, (uint32_t)value);
    else if (kind == 1) motorController->setAxisAcceleration(axis, (uint32_t)value);
    else                motorController->setAxisHomingSpeed(axis, (uint32_t)value);

    Serial.print(F(">> Axis "));
    Serial.print(axis + 1);
    Serial.print(F(" updated. "));
    Serial.println(F("(applies to the next move)"));
    printSpeeds();
}

void printSpeeds() {
    Serial.println(F("=== Speed settings (effective) ==="));
    Serial.print(F("Step engine tick: "));
    Serial.print((long)STEP_TICK_FREQ);
    Serial.print(F(" Hz  |  scale: "));
    Serial.print((int)(speedProfile.getMaxSpeedMultiplier() * 100.0f));
    Serial.print(F("%  |  profile: "));
    Serial.println(speedProfile.getProfileName());

    Serial.println(F("Axis  steps/deg   MAX(steps/s)  deg/s   ACCEL   HOME(steps/s)"));
    for (int i = 0; i < NUM_AXES; i++) {
        Axis* a = motorController->getAxis(i);
        Serial.print(F("  "));
        Serial.print(i + 1);
        Serial.print(F("     "));
        Serial.print(a->getStepsPerDegree(), 2);
        Serial.print(F("      "));
        Serial.print(a->getMaxSpeed());
        Serial.print(F("        "));
        Serial.print((float)a->getMaxSpeed() / a->getStepsPerDegree(), 1);
        Serial.print(F("     "));
        Serial.print(a->getAcceleration());
        Serial.print(F("     "));
        Serial.println(a->getHomingSpeed());
    }
    Serial.println(F("=================================="));
}

void printUsage() {
    Serial.println(F("=== Commands ==="));
    Serial.println(F("  home / home <1-5> / abort / homeorder <j1..j5>"));
    Serial.println(F("  move <ax> <steps> / deg <ax> <deg> / moveall <d1..d5>"));
    Serial.println(F("  traj line <d1..d5> <ms> / traj stop"));
    Serial.println(F("  speed <pct> / profile slow|normal|fast / speeds"));
    Serial.println(F("  maxspeed|accel|homespeed <ax> <value>"));
    Serial.println(F("  enable|disable [<ax>] / estop / reset / stop"));
    Serial.println(F("  status / demo / stopdemo"));
    Serial.println(F("  savepos|loadpos|clearpos <slot> / listpos"));
    Serial.println(F("  timer <ms> <ax> <deg> / timers / cleartimers"));
    Serial.println(F("  teach / teach step / teach stop / play / play stop"));
    Serial.println(F("  ik <x> <y> <z> / fk <a1..a5>"));
    Serial.println(F("  log on|off|show|clear / sleep / wake / autosleep on|off"));
    Serial.println(F("================"));
}

void startDemo() {
    if (demoRunning) {
        Serial.println(F("!! Demo already running"));
        return;
    }
    if (!allAxesHomed()) {
        Serial.println(F("!! Not all axes are homed"));
        return;
    }
    demoRunning = true;
    demoStep = 0;
    demoRepeat = 0;
    lastDemoMove = 0;
    Serial.println(F(">> Starting demo"));
}

void printStatus() {
    Serial.println(F("=== System Status ==="));
    Serial.print(F("State: "));
    switch (systemState) {
        case STATE_INIT:   Serial.println(F("Initializing")); break;
        case STATE_HOMING: Serial.println(F("Homing")); break;
        case STATE_READY:  Serial.println(F("Ready")); break;
        case STATE_MOVING: Serial.println(F("Moving")); break;
        case STATE_ERROR:  Serial.println(F("Error")); break;
        case STATE_ESTOP:  Serial.println(F("Emergency Stop")); break;
    }

    if (demoRunning) {
        Serial.print(F("Demo: RUNNING ("));
        Serial.print(demoStep + 1);
        Serial.print(F("/"));
        Serial.print(DEMO_MOVE_COUNT);
        Serial.println(F(")"));
    }

    // نسخه‌ی فریم‌ور در هر بلوکِ status — GUI با این خط می‌فهمد روی برد
    // همان نسخه‌ای است که انتظار دارد (وگرنه «قدیمی» فرض می‌کند).
    Serial.println(F("FW: v" FIRMWARE_VERSION));

    Serial.print(F("Profile: "));
    Serial.print(speedProfile.getProfileName());
    Serial.print(F(" ("));
    Serial.print((int)(speedProfile.getMaxSpeedMultiplier() * 100.0f));
    Serial.println(F("%)"));

    // ترتیب اولویت هومینگ + وضعیت هر جوینت
    Serial.print(F("Homing priority: "));
    motorController->printHomingOrder();
    Serial.print(F("Homed: "));
    for (int i = 0; i < NUM_AXES; i++) {
        Serial.print(F("J"));
        Serial.print(i + 1);
        Serial.print(motorController->getAxis(i)->isHomed() ? F("[ok] ") : F("[--] "));
    }
    Serial.println();

    if (motorController->emergencyStopActive()) {
        Serial.println(F("!! EMERGENCY STOP ACTIVE - send 'reset'"));
    }
    if (energyManager.isSleeping()) {
        Serial.println(F("Status: SLEEPING"));
    }

    for (int i = 0; i < NUM_AXES; i++) {
        Axis* axis = motorController->getAxis(i);
        int32_t pos = axis->getCurrentPosition();
        float degrees = (float)pos / DEG_TO_STEPS[i];

        Serial.print(F("Axis ")); Serial.print(i + 1);
        Serial.print(F(": ")); Serial.print(pos);
        Serial.print(F(" (")); Serial.print(degrees, 1); Serial.print(F("°)"));
        Serial.print(F(", Homed=")); Serial.print(axis->isHomed() ? F("Y") : F("N"));
        Serial.print(F(", En="));    Serial.print(axis->isEnabled() ? F("Y") : F("N"));
        Serial.print(F(", Mov="));   Serial.print(axis->isMoving() ? F("Y") : F("N"));
        Serial.print(F(", V="));     Serial.print(axis->getCurrentSpeed());
        Serial.print(F("/"));        Serial.print(axis->getMaxSpeed());
        if (axis->homingFailed()) Serial.print(F(", HOME-FAIL"));
        Serial.print(F(", ES="));
        Serial.println(axis->endstopPressed() ? F("Trig") : F("Open"));
    }
    Serial.println(F("======================"));

    // خط همگام‌سازی موقعیت هم در status باشد: همان poll موجودِ GUI
    // اسلایدرها را با برد هم‌زمان می‌کند، بدون اینکه دستور تازه‌ای لازم باشد.
    printPos();
}

// ---------------------------------------------------------------------
// کانال همگام‌سازی موقعیت (POS)
//
// قالب ثابت و ماشین‌خوان — GUI با همین regex می‌خواندش:
//     >> POS <j1>,<j2>,<j3>,<j4>,<j5>        (درجه، یک رقم اعشار)
//
// چرا لازم است: اگر کاربر از جای دیگری حرکت بدهد (کنسول سریال، Teach،
// تایمر، ماکرو یا دکمه‌ی روی دستگاه)، اسلایدرهای GUI بی‌خبر می‌ماندند و
// عدد کنار دکمه‌ی GO همیشه صفر بود. حالا برد موقعیت واقعی را گزارش
// می‌دهد و GUI اسلایدرها را دنبال می‌اندازد.
// ---------------------------------------------------------------------
void printPos() {
    Serial.print(F(">> POS "));
    for (int i = 0; i < NUM_AXES; i++) {
        if (i) Serial.print(F(","));
        float degrees = 0.0f;
        if (DEG_TO_STEPS[i] > 0.0f) {
            degrees = (float)motorController->getAxis(i)->getCurrentPosition() / DEG_TO_STEPS[i];
        }
        Serial.print(degrees, 1);
    }
    Serial.println();
}

void handleMoveCommand(String command) {
    int firstSpace = command.indexOf(' ');
    int secondSpace = command.indexOf(' ', firstSpace + 1);
    if (secondSpace == -1) {
        Serial.println(F("Format: move <axis> <steps>"));
        return;
    }
    int axis = command.substring(firstSpace + 1, secondSpace).toInt() - 1;
    int32_t steps = command.substring(secondSpace + 1).toInt();
    if (axis >= 0 && axis < NUM_AXES) {
        motorController->moveTo(axis, steps);
        Serial.print(F("Moving axis ")); Serial.print(axis + 1);
        Serial.print(F(" to ")); Serial.print(steps); Serial.println(F(" steps"));
    } else {
        Serial.println(F("Invalid axis"));
    }
}

void handleDegCommand(String command) {
    int firstSpace = command.indexOf(' ');
    int secondSpace = command.indexOf(' ', firstSpace + 1);
    if (secondSpace == -1) {
        Serial.println(F("Format: deg <axis> <degrees>"));
        return;
    }
    int axis = command.substring(firstSpace + 1, secondSpace).toInt() - 1;
    float degrees = command.substring(secondSpace + 1).toFloat();

    if (axis < 0 || axis >= NUM_AXES) {
        Serial.println(F("Invalid axis"));
        return;
    }
    if (degrees < AXIS_MIN_DEG[axis] || degrees > AXIS_MAX_DEG[axis]) {
        Serial.print(F("!! Axis "));
        Serial.print(axis + 1);
        Serial.print(F(" out of range ("));
        Serial.print(AXIS_MIN_DEG[axis], 1);
        Serial.print(F("° to "));
        Serial.print(AXIS_MAX_DEG[axis], 1);
        Serial.println(F("°)"));
        return;
    }

    int32_t steps = (int32_t)(degrees * DEG_TO_STEPS[axis]);
    motorController->moveTo(axis, steps);
    Serial.print(F("Moving axis ")); Serial.print(axis + 1);
    Serial.print(F(" to ")); Serial.print(degrees, 1);
    Serial.print(F("° (")); Serial.print(steps); Serial.println(F(" steps)"));
}

// ---- تغییر ترتیب اولویت هومینگ در زمان اجرا ----
// نمونه: homeorder 1 2 3 4 5   -> اول جوینت ۱، بعد ۲، ۳، ۴ و ۵
// نمونه: homeorder 3 2 1 4 5   -> اول Z (اگر مثلاً بخوای Z اول بالا بره)
void handleHomingOrderCommand(String command) {
    String args = command.substring(command.indexOf(' ') + 1);
    args.trim();

    uint8_t order[NUM_AXES];
    int count = 0;
    int startPos = 0;

    while (count < NUM_AXES) {
        int spacePos = args.indexOf(' ', startPos);
        String tok = (spacePos == -1) ? args.substring(startPos)
                                      : args.substring(startPos, spacePos);
        tok.trim();
        if (tok.length() == 0) break;

        int joint = tok.toInt();
        if (joint < 1 || joint > NUM_AXES) {
            Serial.print(F("!! Joint numbers must be 1.."));
            Serial.print(NUM_AXES);
            Serial.print(F(" (got "));
            Serial.print(joint);
            Serial.println(F(")"));
            return;
        }
        order[count++] = (uint8_t)(joint - 1);
        if (spacePos == -1) break;
        startPos = spacePos + 1;
    }

    if (count != NUM_AXES) {
        Serial.print(F("!! homeorder needs exactly "));
        Serial.print(NUM_AXES);
        Serial.print(F(" joint numbers, got "));
        Serial.print(count);
        Serial.println(F(". Example: homeorder 1 2 3 4 5"));
        return;
    }
    motorController->setHomingOrder(order, NUM_AXES);
}

void handleMoveAllCommand(String command) {
    int firstSpace = command.indexOf(' ');
    String args = command.substring(firstSpace + 1);
    args.trim();

    int32_t steps[NUM_AXES];
    int currentIdx = 0;
    int startPos = 0;

    for (int i = 0; i < NUM_AXES; i++) {
        int spacePos = args.indexOf(' ', startPos);
        String degStr;
        if (spacePos == -1) degStr = args.substring(startPos);
        else degStr = args.substring(startPos, spacePos);
        degStr.trim();

        if (degStr.length() == 0) {
            Serial.print(F("!! Missing degree for axis ")); Serial.println(i + 1);
            return;
        }

        float degrees = degStr.toFloat();
        if (degrees < AXIS_MIN_DEG[i] || degrees > AXIS_MAX_DEG[i]) {
            Serial.print(F("!! Axis ")); Serial.print(i + 1);
            Serial.println(F(" out of range"));
            return;
        }

        steps[i] = (int32_t)(degrees * DEG_TO_STEPS[i]);
        currentIdx++;
        if (spacePos == -1) break;
        startPos = spacePos + 1;
    }

    for (int i = currentIdx; i < NUM_AXES; i++) steps[i] = 0;

    motorController->moveAllAxes(steps);
    Serial.print(F("Moving all: "));
    for (int i = 0; i < NUM_AXES; i++) {
        Serial.print(steps[i]);
        if (i < NUM_AXES - 1) Serial.print(F(", "));
    }
    Serial.println(F(" steps"));
}

// traj line <d1> <d2> <d3> <d4> <d5> <ms>
// همه‌ی محورها هم‌زمان شروع می‌کنن و هم‌زمان می‌رسن
void handleTrajLineCommand(String command) {
    int startPos = 10;   // بعد از "traj line "
    float deg[NUM_AXES];
    long durationMs = 0;

    for (int i = 0; i < NUM_AXES + 1; i++) {
        int spacePos = command.indexOf(' ', startPos);
        String token;
        if (spacePos == -1) token = command.substring(startPos);
        else token = command.substring(startPos, spacePos);
        token.trim();

        if (token.length() == 0) {
            Serial.println(F("Format: traj line <d1> <d2> <d3> <d4> <d5> <ms>"));
            return;
        }

        if (i < NUM_AXES) {
            deg[i] = token.toFloat();
            if (deg[i] < AXIS_MIN_DEG[i] || deg[i] > AXIS_MAX_DEG[i]) {
                Serial.print(F("!! Axis ")); Serial.print(i + 1);
                Serial.println(F(" out of range"));
                return;
            }
        } else {
            durationMs = token.toInt();
        }

        if (spacePos == -1) {
            if (i < NUM_AXES) {
                Serial.println(F("!! Not enough values (need 5 angles + duration)"));
                return;
            }
            break;
        }
        startPos = spacePos + 1;
    }

    if (durationMs < 50) durationMs = 50;

    int32_t steps[NUM_AXES];
    for (int i = 0; i < NUM_AXES; i++) {
        steps[i] = (int32_t)(deg[i] * DEG_TO_STEPS[i]);
    }

    demoRunning = false;
    motorController->moveAllAxesTimed(steps, (uint32_t)durationMs);

    Serial.print(F(">> Trajectory line in "));
    Serial.print(durationMs);
    Serial.println(F(" ms"));
}

void handleIKCommand(String command) {
    int firstSpace = command.indexOf(' ');
    int secondSpace = command.indexOf(' ', firstSpace + 1);
    int thirdSpace = command.indexOf(' ', secondSpace + 1);

    if (thirdSpace == -1) {
        Serial.println(F("Format: ik <x> <y> <z>"));
        return;
    }

    float x = command.substring(firstSpace + 1, secondSpace).toFloat();
    float y = command.substring(secondSpace + 1, thirdSpace).toFloat();
    float z = command.substring(thirdSpace + 1).toFloat();

    float angles[NUM_AXES];
    if (!kinematics.solveIK(x, y, z, angles)) {
        Serial.println(F("!! Position out of reach"));
        return;
    }

    Serial.print(F(">> IK solution: "));
    for (int i = 0; i < NUM_AXES; i++) {
        Serial.print(angles[i], 1);
        Serial.print(F("°"));
        if (i < NUM_AXES - 1) Serial.print(F(", "));
    }
    Serial.println();

    int32_t steps[NUM_AXES];
    for (int i = 0; i < NUM_AXES; i++) {
        steps[i] = (int32_t)(angles[i] * DEG_TO_STEPS[i]);
    }
    motorController->moveAllAxes(steps);
}

void handleFKCommand(String command) {
    int firstSpace = command.indexOf(' ');
    String args = command.substring(firstSpace + 1);
    args.trim();

    float angles[NUM_AXES];
    int startPos = 0;

    for (int i = 0; i < NUM_AXES; i++) {
        int spacePos = args.indexOf(' ', startPos);
        String angleStr;
        if (spacePos == -1) angleStr = args.substring(startPos);
        else angleStr = args.substring(startPos, spacePos);
        angles[i] = angleStr.toFloat();
        if (spacePos == -1) {
            for (int j = i + 1; j < NUM_AXES; j++) angles[j] = 0;
            break;
        }
        startPos = spacePos + 1;
    }

    float x, y, z;
    if (kinematics.solveFK(angles, x, y, z)) {
        Serial.print(F(">> FK result: X="));
        Serial.print(x, 1);
        Serial.print(F(", Y="));
        Serial.print(y, 1);
        Serial.print(F(", Z="));
        Serial.println(z, 1);
    }
}

void executeDemo() {
    if (!demoRunning) return;

    unsigned long currentTime = millis();
    if (currentTime - lastDemoMove < DEMO_DELAY_MS) return;

    if (motorController->isAnyMoving()) return;

    for (int i = 0; i < NUM_AXES; i++) {
        float degrees = DEMO_MOVES[demoStep][i];
        if (degrees < AXIS_MIN_DEG[i] || degrees > AXIS_MAX_DEG[i]) {
            demoStep++;
            if (demoStep >= DEMO_MOVE_COUNT) {
                demoStep = 0;
                demoRepeat++;
                if (demoRepeat >= DEMO_MAX_REPEATS) {
                    demoRunning = false;
                    demoRepeat = 0;
                    Serial.println(F(">> Demo complete!"));
                }
            }
            lastDemoMove = currentTime;
            return;
        }
    }

    int32_t steps[NUM_AXES];
    for (int i = 0; i < NUM_AXES; i++) {
        steps[i] = (int32_t)(DEMO_MOVES[demoStep][i] * DEG_TO_STEPS[i]);
    }

    motorController->moveAllAxes(steps);
    Serial.print(F(">> Demo step "));
    Serial.print(demoStep + 1);
    Serial.print(F("/"));
    Serial.println(DEMO_MOVE_COUNT);

    lastDemoMove = currentTime;
    demoStep++;

    if (demoStep >= DEMO_MOVE_COUNT) {
        demoStep = 0;
        demoRepeat++;
        if (demoRepeat >= DEMO_MAX_REPEATS) {
            demoRunning = false;
            demoRepeat = 0;
            Serial.println(F(">> Demo complete!"));
        }
    }
}
