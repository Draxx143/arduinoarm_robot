/*
 * 5 DOF Robot Arm Firmware — TEST MODE (بدون ROS)
 * 
 * دستورات قابل استفاده در Serial Monitor:
 *   home              -> هوم هوشمند همه محورها
 *   home <axis>       -> هوم هوشمند یک محور
 *   status            -> نمایش وضعیت
 *   enable/disable    -> موتورها (تک‌محور یا همه)
 *   move/deg/moveall  -> حرکت
 *   demo              -> حرکت نمایشی
 *   savepos/loadpos   -> ذخیره/بازیابی موقعیت
 *   timer <ms> <axis> -> تایمر خودکار (هدف = موقعیت لحظه‌ی ثبت)
 *   teach/teach stop/play -> حالت آموزش
 *   log               -> لاگ‌گیری
 *   profile           -> پروفایل سرعت
 *   traj              -> Trajectory Planning
 *   ik/fk             -> Inverse/Forward Kinematics
 *   sleep/wake        -> حالت خواب
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
#include "SerialCLI.h"

// Global objects
MotorController* motorController;
PositionStore positionStore;
TimerManager timerManager;
TeachMode teachMode;
Logger logger;
SerialCLI cli;      // کتابخانه‌ی تازه‌ی کنسول سریال (اکو/ACK/خواندن غیرمسدود)
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

// ضرایب تبدیل درجه به steps
const float DEG_TO_STEPS[NUM_AXES] = {
    44.44,   // X: 1:5
    53.33,   // Y: 1:6
    71.11,   // Z: 1:8
    26.67,   // A: 1:3
    22.22    // B: 1:2.5
};

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

// Callback برای TeachMode
void teachMoveCallback(const int32_t positions[]) {
    motorController->moveAllAxes((int32_t*)positions);
}

void setup() {
    cli.begin(115200, handleCommand);          // کنسول سریال جدید (بدون تایم‌اوت، غیرمسدود)
    cli.setLogFn([](const char* c) { logger.log(c); });
    delay(500);
    C_PRINTLN("======================================");
    C_PRINTLN("5 DOF Robot Arm - TEST MODE (No ROS)");
    C_PRINTLN("======================================");
    C_PRINTLN("Basic Commands:");
    C_PRINTLN("  home, home <1-5>     - Smart homing");
    C_PRINTLN("  status               - Show status");
    C_PRINTLN("  enable/disable       - Motor control");
    C_PRINTLN("  move/deg/moveall     - Movement");
    C_PRINTLN("  demo                 - Demo loop");
    C_PRINTLN("Advanced Commands:");
    C_PRINTLN("  savepos <slot>       - Save current position");
    C_PRINTLN("  loadpos <slot>       - Load saved position");
    C_PRINTLN("  listpos              - List saved positions");
    C_PRINTLN("  timer <ms> <axis> <target>");
    C_PRINTLN("  teach / teach stop / play");
    C_PRINTLN("  log on/off/show/clear");
    C_PRINTLN("  ack on/off       (per-command confirmations)");
    C_PRINTLN("  profile slow/normal/fast");
    C_PRINTLN("  traj line/circle");
    C_PRINTLN("  ik <x> <y> <z>");
    C_PRINTLN("  fk <a1> <a2> <a3>");
    C_PRINTLN("  sleep / wake / autosleep on/off");
    C_PRINTLN("======================================");

    pinMode(STATUS_LED_PIN, OUTPUT);
    digitalWrite(STATUS_LED_PIN, HIGH);

    motorController = new MotorController();
    motorController->init();
    motorController->startControlLoop();

    // FIX: اتصال callback تایمر به حرکت واقعی موتور
    timerManager.onFire(onTimerFire);

    positionStore.begin();
    
    // تنظیم callback های EnergyManager
    // (اختیاری - می‌تونی بعداً اضافه کنی)

    systemState = STATE_INIT;
    C_PRINTLN("System initialized.");
    C_PRINTLN("======================================");
}

// FIX: اجرای واقعی تایمر — قبلاً TimerManager فقط پیام چاپ می‌کرد
void onTimerFire(uint8_t axis, int32_t target) {
    if (axis >= NUM_AXES) return;
    if (systemState != STATE_READY && systemState != STATE_MOVING) return;
    motorController->moveTo(axis, target);
    C_PRINT(">> Moving axis ");
    C_PRINT(axis + 1);
    C_PRINT(" to ");
    C_PRINTLN(target);
}

void loop() {
    updateSystemState();
    updateHeartbeat();
    cli.poll();                 // کنسول سریال (خواندن غیرمسدود + ACK)
    executeDemo();
    timerManager.update();      // بررسی تایمرها
    teachMode.update();          // بررسی teach playback
    updateTrajectory();          // بررسی trajectory
    updateEnergyManager();       // بررسی energy manager
}

void updateEnergyManager() {
    bool isMoving = false;
    for (int i = 0; i < NUM_AXES; i++) {
        if (motorController->getAxis(i)->isMoving()) {
            isMoving = true;
            break;
        }
    }
    energyManager.update(isMoving);
}

void updateTrajectory() {
    if (!trajectory.isActive()) return;
    
    int32_t currentPos[NUM_AXES];
    for (int i = 0; i < NUM_AXES; i++) {
        currentPos[i] = motorController->getAxis(i)->getCurrentPosition();
    }
    
    trajectory.update(currentPos);
    
    static int32_t lastTarget[NUM_AXES] = {0};
    bool changed = false;
    for (int i = 0; i < NUM_AXES; i++) {
        if (currentPos[i] != lastTarget[i]) {
            changed = true;
            lastTarget[i] = currentPos[i];
        }
    }
    
    if (changed) {
        motorController->moveAllAxes(currentPos);
    }
}

void updateSystemState() {
    bool moving = false;
    bool allStopped = true;

    switch (systemState) {
        case STATE_INIT:
            if (motorController->isHoming()) systemState = STATE_HOMING;
            break;
        case STATE_HOMING:
            motorController->processHoming();
            if (motorController->allHomed()) {
                systemState = STATE_READY;
                C_PRINTLN(">> System ready!");
            }
            break;
        case STATE_READY:
            for (int i = 0; i < NUM_AXES; i++) {
                if (motorController->getAxis(i)->isMoving()) {
                    moving = true;
                    break;
                }
            }
            if (moving) systemState = STATE_MOVING;
            break;
        case STATE_MOVING:
            for (int i = 0; i < NUM_AXES; i++) {
                if (motorController->getAxis(i)->isMoving()) {
                    allStopped = false;
                    break;
                }
            }
            if (allStopped) {
                systemState = STATE_READY;
                C_PRINTLN(">> Move complete.");
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

/* ============================================================
 * dispatch دستورات — توسط SerialCLI::poll() صدا زده می‌شود
 * خروجی: true = شناخته‌شده (در حالت ACK تاییدیه چاپ می‌شود)
 * ============================================================ */
bool handleCommand(const String& command) {
        // ==================== Basic Commands ====================
        if (command == "home") {
            C_PRINTLN("Starting smart homing...");
            motorController->smartHoming();
            systemState = STATE_HOMING;
        }
        else if (command.startsWith("home ")) {
            int axis = command.substring(5).toInt() - 1;
            if (axis >= 0 && axis < NUM_AXES) {
                motorController->smartHomingAxis(axis);
                systemState = STATE_HOMING;
            } else {
                C_PRINTLN("Invalid axis");
            }
        }
        else if (command == "status") {
            printStatus();
        }
        else if (command == "enable") {
            motorController->enableAllMotors();
            C_PRINTLN("All motors enabled");
        }
        else if (command.startsWith("enable ")) {
            int axis = command.substring(7).toInt() - 1;
            if (axis >= 0 && axis < NUM_AXES) motorController->enableAxis(axis);
            else C_PRINTLN("Invalid axis");
        }
        else if (command == "disable") {
            motorController->disableAllMotors();
            C_PRINTLN("All motors disabled");
        }
        else if (command.startsWith("disable ")) {
            int axis = command.substring(8).toInt() - 1;
            if (axis >= 0 && axis < NUM_AXES) motorController->disableAxis(axis);
            else C_PRINTLN("Invalid axis");
        }
        else if (command == "estop") {
            motorController->emergencyStop();
            systemState = STATE_ESTOP;
            demoRunning = false;
            C_PRINTLN("EMERGENCY STOP!");
        }
        else if (command == "reset") {
            motorController->clearEmergencyStop();
            systemState = STATE_READY;
            C_PRINTLN("Emergency stop cleared");
        }
        else if (command == "demo") {
            startDemo();
        }
        else if (command == "stopdemo") {
            demoRunning = false;
            C_PRINTLN(">> Demo stopped");
        }
        else if (command == "stop") {
            demoRunning = false;
            motorController->disableAllMotors();
            C_PRINTLN(">> Stopped");
        }
        else if (command.startsWith("moveall ")) {
            demoRunning = false;
            handleMoveAllCommand(command);
        }
        else if (command == "moveall") {
            C_PRINTLN("Format: moveall <d1> <d2> <d3> <d4> <d5>");
        }
        else if (command.startsWith("deg ")) {
            demoRunning = false;
            handleDegCommand(command);
        }
        else if (command.startsWith("move ")) {
            demoRunning = false;
            handleMoveCommand(command);
        }
        // ==================== Position Store ====================
        else if (command.startsWith("savepos ")) {
            int slot = command.substring(8).toInt();
            int32_t positions[NUM_AXES];
            for (int i = 0; i < NUM_AXES; i++) {
                positions[i] = motorController->getAxis(i)->getCurrentPosition();
            }
            positionStore.save(slot, positions);
        }
        else if (command.startsWith("loadpos ")) {
            int slot = command.substring(8).toInt();
            int32_t positions[NUM_AXES];
            if (positionStore.load(slot, positions)) {
                motorController->moveAllAxes(positions);
                C_PRINTLN(">> Moving to saved position");
            }
        }
        else if (command == "listpos") {
            positionStore.list();
        }
        else if (command.startsWith("clearpos ")) {
            int slot = command.substring(9).toInt();
            positionStore.clear(slot);
            C_PRINT(">> Position slot ");
            C_PRINT(slot);
            C_PRINTLN(" cleared");
        }
        // ==================== Timer ====================
        else if (command.startsWith("timer ")) {
            // timer <ms> <axis> <target>
            // مثال: timer 5000 1 90
            int firstSpace = command.indexOf(' ');
            int secondSpace = command.indexOf(' ', firstSpace + 1);
            int thirdSpace = command.indexOf(' ', secondSpace + 1);
            
            if (thirdSpace == -1) {
                unsigned long delayMs = command.substring(firstSpace + 1, secondSpace).toInt();
                int axis = command.substring(secondSpace + 1).toInt() - 1;
                
                if (axis >= 0 && axis < NUM_AXES) {
                    int32_t currentPos = motorController->getAxis(axis)->getCurrentPosition();
                    timerManager.addTimer(delayMs, axis, currentPos);
                    C_PRINT(">> Timer set: axis ");
                    C_PRINT(axis + 1);
                    C_PRINT(" in ");
                    C_PRINT(delayMs);
                    C_PRINTLN(" ms");
                }
            }
        }
        else if (command == "timers") {
            C_PRINT(">> Active timers: ");
            C_PRINTLN(timerManager.getActiveCount());
        }
        else if (command == "cleartimers") {
            timerManager.clear();
            C_PRINTLN(">> All timers cleared");
        }
        // ==================== Teach Mode ====================
        else if (command == "teach") {
            teachMode.startRecording();
        }
        else if (command == "teach stop") {
            teachMode.stopRecording();
        }
        else if (command == "teach step") {
            int32_t positions[NUM_AXES];
            for (int i = 0; i < NUM_AXES; i++) {
                positions[i] = motorController->getAxis(i)->getCurrentPosition();
            }
            teachMode.recordStep(positions, 1000);
        }
        else if (command == "play") {
            teachMode.startPlayback(teachMoveCallback);
        }
        else if (command == "play stop") {
            teachMode.stopPlayback();
        }
        else if (command == "teach count") {
            C_PRINT(">> Recorded steps: ");
            C_PRINTLN(teachMode.getStepCount());
        }
        // ==================== Logger ====================
        else if (command == "log on") {
            logger.enable();
        }
        else if (command == "log off") {
            logger.disable();
        }
        else if (command == "log show") {
            logger.show();
        }
        else if (command == "log clear") {
            logger.clear();
        }
        // ==================== Speed Profile ====================
        else if (command.startsWith("profile ")) {
            String prof = command.substring(8);
            prof.trim();
            if (prof == "slow") speedProfile.setProfile(PROFILE_SLOW);
            else if (prof == "normal") speedProfile.setProfile(PROFILE_NORMAL);
            else if (prof == "fast") speedProfile.setProfile(PROFILE_FAST);
            else C_PRINTLN("Use: profile slow/normal/fast");
        }
        else if (command == "profile") {
            C_PRINT(">> Current profile: ");
            C_PRINTLN(speedProfile.getProfileName());
        }
        // ==================== Trajectory ====================
        else if (command.startsWith("traj line ")) {
            // traj line <d1> <d2> <d3> <d4> <d5> <ms>
            // فعلاً ساده: فقط می‌گه که فعال شده
            C_PRINTLN(">> Trajectory line set (not fully implemented)");
        }
        else if (command == "traj stop") {
            trajectory.stop();
        }
        // ==================== IK/FK ====================
        else if (command.startsWith("ik ")) {
            // ik <x> <y> <z>
            int firstSpace = command.indexOf(' ');
            int secondSpace = command.indexOf(' ', firstSpace + 1);
            int thirdSpace = command.indexOf(' ', secondSpace + 1);
            
            if (thirdSpace != -1) {
                float x = command.substring(firstSpace + 1, secondSpace).toFloat();
                float y = command.substring(secondSpace + 1, thirdSpace).toFloat();
                float z = command.substring(thirdSpace + 1).toFloat();
                
                float angles[NUM_AXES];
                if (kinematics.solveIK(x, y, z, angles)) {
                    // FIX: اول محدودسازی، بعد چاپ — چیزی که چاپ می‌شود
                    // دقیقاً همان چیزی است که به موتورها می‌رود
                    bool clamped = false;
                    for (int i = 0; i < NUM_AXES; i++) {
                        float c = constrain(angles[i], AXIS_MIN_DEG[i], AXIS_MAX_DEG[i]);
                        if (c != angles[i]) { angles[i] = c; clamped = true; }
                    }
                    
                    C_PRINT(">> IK solution: ");
                    for (int i = 0; i < NUM_AXES; i++) {
                        C_PRINT(angles[i], 1);
                        C_PRINT("°");
                        if (i < NUM_AXES - 1) C_PRINT(", ");
                    }
                    C_PRINTLN();
                    if (clamped) {
                        C_PRINTLN(">> NOTE: angles clamped to joint limits - real tool position is offset");
                    }
                    
                    // تبدیل به steps و حرکت
                    int32_t steps[NUM_AXES];
                    for (int i = 0; i < NUM_AXES; i++) {
                        steps[i] = (int32_t)(angles[i] * DEG_TO_STEPS[i]);
                    }
                    motorController->moveAllAxes(steps);
                } else {
                    C_PRINTLN("!! Position out of reach");
                }
            } else {
                C_PRINTLN("Format: ik <x> <y> <z>");
            }
        }
        else if (command.startsWith("fk ")) {
            // fk <a1> <a2> <a3> <a4> <a5>
            int firstSpace = command.indexOf(' ');
            String args = command.substring(firstSpace + 1);
            args.trim();
            
            float angles[NUM_AXES];
            int startPos = 0;
            
            for (int i = 0; i < NUM_AXES; i++) {
                int spacePos = args.indexOf(' ', startPos);
                String angleStr;
                if (spacePos == -1) {
                    angleStr = args.substring(startPos);
                } else {
                    angleStr = args.substring(startPos, spacePos);
                }
                angles[i] = angleStr.toFloat();
                if (spacePos == -1) break;
                startPos = spacePos + 1;
            }
            
            float x, y, z;
            if (kinematics.solveFK(angles, x, y, z)) {
                C_PRINT(">> FK result: X=");
                C_PRINT(x, 1);
                C_PRINT(", Y=");
                C_PRINT(y, 1);
                C_PRINT(", Z=");
                C_PRINTLN(z, 1);
            }
        }
        // ==================== Energy Manager ====================
        else if (command == "sleep") {
            energyManager.sleep();
        }
        else if (command == "wake") {
            energyManager.wake();
        }
        else if (command == "autosleep on") {
            energyManager.enableAutoSleep();
        }
        else if (command == "autosleep off") {
            energyManager.disableAutoSleep();
        }
        else {
            return false;   // نامعلوم — پیام را SerialCLI چاپ می‌کند
        }
        
        return true;
}

void startDemo() {
    if (demoRunning) {
        C_PRINTLN("!! Demo already running");
        return;
    }
    bool allHomed = true;
    for (int i = 0; i < NUM_AXES; i++) {
        if (!motorController->getAxis(i)->isHomed()) {
            allHomed = false;
            break;
        }
    }
    if (!allHomed) {
        C_PRINTLN("!! Not all axes are homed");
        return;
    }
    demoRunning = true;
    demoStep = 0;
    demoRepeat = 0;
    lastDemoMove = 0;
    C_PRINTLN(">> Starting demo");
}

void printStatus() {
    C_PRINTLN("=== System Status ===");
    C_PRINT("State: ");
    switch (systemState) {
        case STATE_INIT:   C_PRINTLN("Initializing"); break;
        case STATE_HOMING: C_PRINTLN("Homing"); break;
        case STATE_READY:  C_PRINTLN("Ready"); break;
        case STATE_MOVING: C_PRINTLN("Moving"); break;
        case STATE_ERROR:  C_PRINTLN("Error"); break;
        case STATE_ESTOP:  C_PRINTLN("Emergency Stop"); break;
    }
    
    if (demoRunning) {
        C_PRINT("Demo: RUNNING (");
        C_PRINT(demoStep + 1);
        C_PRINT("/");
        C_PRINT(DEMO_MOVE_COUNT);
        C_PRINTLN(")");
    }
    
    C_PRINT("Profile: ");
    C_PRINTLN(speedProfile.getProfileName());
    
    if (energyManager.isSleeping()) {
        C_PRINTLN("Status: SLEEPING");
    }

    for (int i = 0; i < NUM_AXES; i++) {
        Axis* axis = motorController->getAxis(i);
        int32_t pos = axis->getCurrentPosition();
        float degrees = (float)pos / DEG_TO_STEPS[i];
        
        C_PRINT("Axis "); C_PRINT(i + 1);
        C_PRINT(": "); C_PRINT(pos);
        C_PRINT(" ("); C_PRINT(degrees, 1); C_PRINT("°)");
        C_PRINT(", Homed="); C_PRINT(axis->isHomed() ? "Y" : "N");
        C_PRINT(", En="); C_PRINT(axis->isEnabled() ? "Y" : "N");
        C_PRINT(", Mov="); C_PRINT(axis->isMoving() ? "Y" : "N");
        C_PRINT(", ES="); C_PRINTLN(axis->getEndstopState() ? "Open" : "Trig");
    }
    C_PRINTLN("======================");
}

void handleMoveCommand(String command) {
    int firstSpace = command.indexOf(' ');
    int secondSpace = command.indexOf(' ', firstSpace + 1);
    if (secondSpace == -1) {
        C_PRINTLN("Format: move <axis> <steps>");
        return;
    }
    int axis = command.substring(firstSpace + 1, secondSpace).toInt() - 1;
    int32_t steps = command.substring(secondSpace + 1).toInt();
    if (axis >= 0 && axis < NUM_AXES) {
        if (!motorController->getAxis(axis)->isEnabled()) {
            C_PRINT("!! Axis "); C_PRINT(axis + 1);
            C_PRINTLN(" is DISABLED — send 'enable' or run 'home' first");
        }
        motorController->moveTo(axis, steps);
        C_PRINT("Moving axis "); C_PRINT(axis + 1);
        C_PRINT(" to "); C_PRINT(steps); C_PRINTLN(" steps");
    }
}

void handleDegCommand(String command) {
    int firstSpace = command.indexOf(' ');
    int secondSpace = command.indexOf(' ', firstSpace + 1);
    if (secondSpace == -1) {
        C_PRINTLN("Format: deg <axis> <degrees>");
        return;
    }
    int axis = command.substring(firstSpace + 1, secondSpace).toInt() - 1;
    float degrees = command.substring(secondSpace + 1).toFloat();
    
    if (axis < 0 || axis >= NUM_AXES) {
        C_PRINTLN("Invalid axis");
        return;
    }
    if (degrees < AXIS_MIN_DEG[axis] || degrees > AXIS_MAX_DEG[axis]) {
        C_PRINT("!! Axis "); C_PRINT(axis + 1);
        C_PRINT(" out of range (");
        C_PRINT(AXIS_MIN_DEG[axis], 1);
        C_PRINT("° to ");
        C_PRINT(AXIS_MAX_DEG[axis], 1);
        C_PRINTLN("°)");
        return;
    }
    
    // FIX: قبلاً محورِ غیرفعال بی‌صدا رد می‌شد — حالا صریح می‌گوییم
    if (!motorController->getAxis(axis)->isEnabled()) {
        C_PRINT("!! Axis "); C_PRINT(axis + 1);
        C_PRINTLN(" is DISABLED — send 'enable' or run 'home' first");
    }
    
    int32_t steps = (int32_t)(degrees * DEG_TO_STEPS[axis]);
    motorController->moveTo(axis, steps);
    C_PRINT("Moving axis "); C_PRINT(axis + 1);
    C_PRINT(" to "); C_PRINT(degrees, 1);
    C_PRINT("° ("); C_PRINT(steps); C_PRINTLN(" steps)");
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
            C_PRINT("!! Missing degree for axis "); C_PRINTLN(i + 1);
            return;
        }
        
        float degrees = degStr.toFloat();
        if (degrees < AXIS_MIN_DEG[i] || degrees > AXIS_MAX_DEG[i]) {
            C_PRINT("!! Axis "); C_PRINT(i + 1);
            C_PRINT(" out of range");
            return;
        }
        
        steps[i] = (int32_t)(degrees * DEG_TO_STEPS[i]);
        currentIdx++;
        if (spacePos == -1) break;
        startPos = spacePos + 1;
    }
    
    for (int i = currentIdx; i < NUM_AXES; i++) steps[i] = 0;
    
    bool anyEnabled = false;
    for (int i = 0; i < NUM_AXES; i++) {
        if (motorController->getAxis(i)->isEnabled()) { anyEnabled = true; break; }
    }
    if (!anyEnabled) {
        C_PRINTLN("!! All motors DISABLED — send 'enable' or run 'home' first");
    }
    
    motorController->moveAllAxes(steps);
    C_PRINT("Moving all: ");
    for (int i = 0; i < NUM_AXES; i++) {
        C_PRINT(steps[i]);
        if (i < NUM_AXES - 1) C_PRINT(", ");
    }
    C_PRINTLN(" steps");
}

void executeDemo() {
    if (!demoRunning) return;
    
    unsigned long currentTime = millis();
    if (currentTime - lastDemoMove < DEMO_DELAY_MS) return;
    
    bool allStopped = true;
    for (int i = 0; i < NUM_AXES; i++) {
        if (motorController->getAxis(i)->isMoving()) {
            allStopped = false;
            break;
        }
    }
    if (!allStopped) return;
    
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
                    C_PRINTLN(">> Demo complete!");
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
    C_PRINT(">> Demo step ");
    C_PRINT(demoStep + 1);
    C_PRINT("/");
    C_PRINTLN(DEMO_MOVE_COUNT);
    
    lastDemoMove = currentTime;
    demoStep++;
    
    if (demoStep >= DEMO_MOVE_COUNT) {
        demoStep = 0;
        demoRepeat++;
        if (demoRepeat >= DEMO_MAX_REPEATS) {
            demoRunning = false;
            demoRepeat = 0;
            C_PRINTLN(">> Demo complete!");
        }
    }
}

// FIX: پین ۲۲ روی Mega2560 وقفه‌ی خارجی ندارد (فقط پین‌های 2,3,18,19,20,21)
// و این ISR هرگز attach نمی‌شد (کد مرده). پین E-STOP از قبل داخل
// MotorController::update() با نرخ 1kHz poll می‌شود — همین کافی است.