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
    Serial.begin(115200);
    delay(500);
    Serial.println("======================================");
    Serial.println("5 DOF Robot Arm - TEST MODE (No ROS)");
    Serial.println("======================================");
    Serial.println("Basic Commands:");
    Serial.println("  home, home <1-5>     - Smart homing");
    Serial.println("  status               - Show status");
    Serial.println("  enable/disable       - Motor control");
    Serial.println("  move/deg/moveall     - Movement");
    Serial.println("  demo                 - Demo loop");
    Serial.println("Advanced Commands:");
    Serial.println("  savepos <slot>       - Save current position");
    Serial.println("  loadpos <slot>       - Load saved position");
    Serial.println("  listpos              - List saved positions");
    Serial.println("  timer <ms> <axis> <target>");
    Serial.println("  teach / teach stop / play");
    Serial.println("  log on/off/show/clear");
    Serial.println("  profile slow/normal/fast");
    Serial.println("  traj line/circle");
    Serial.println("  ik <x> <y> <z>");
    Serial.println("  fk <a1> <a2> <a3>");
    Serial.println("  sleep / wake / autosleep on/off");
    Serial.println("======================================");

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
    Serial.println("System initialized.");
    Serial.println("======================================");
}

// FIX: اجرای واقعی تایمر — قبلاً TimerManager فقط پیام چاپ می‌کرد
void onTimerFire(uint8_t axis, int32_t target) {
    if (axis >= NUM_AXES) return;
    if (systemState != STATE_READY && systemState != STATE_MOVING) return;
    motorController->moveTo(axis, target);
    Serial.print(">> Moving axis ");
    Serial.print(axis + 1);
    Serial.print(" to ");
    Serial.println(target);
}

void loop() {
    updateSystemState();
    updateHeartbeat();
    handleSerialCommands();
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
                Serial.println(">> System ready!");
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
                Serial.println(">> Move complete.");
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
        
        Serial.print("> "); 
        Serial.println(command);
        
        logger.log(command.c_str());

        // ==================== Basic Commands ====================
        if (command == "home") {
            Serial.println("Starting smart homing...");
            motorController->smartHoming();
            systemState = STATE_HOMING;
        }
        else if (command.startsWith("home ")) {
            int axis = command.substring(5).toInt() - 1;
            if (axis >= 0 && axis < NUM_AXES) {
                motorController->smartHomingAxis(axis);
                systemState = STATE_HOMING;
            } else {
                Serial.println("Invalid axis");
            }
        }
        else if (command == "status") {
            printStatus();
        }
        else if (command == "enable") {
            motorController->enableAllMotors();
            Serial.println("All motors enabled");
        }
        else if (command.startsWith("enable ")) {
            int axis = command.substring(7).toInt() - 1;
            if (axis >= 0 && axis < NUM_AXES) motorController->enableAxis(axis);
            else Serial.println("Invalid axis");
        }
        else if (command == "disable") {
            motorController->disableAllMotors();
            Serial.println("All motors disabled");
        }
        else if (command.startsWith("disable ")) {
            int axis = command.substring(8).toInt() - 1;
            if (axis >= 0 && axis < NUM_AXES) motorController->disableAxis(axis);
            else Serial.println("Invalid axis");
        }
        else if (command == "estop") {
            motorController->emergencyStop();
            systemState = STATE_ESTOP;
            demoRunning = false;
            Serial.println("EMERGENCY STOP!");
        }
        else if (command == "reset") {
            motorController->clearEmergencyStop();
            systemState = STATE_READY;
            Serial.println("Emergency stop cleared");
        }
        else if (command == "demo") {
            startDemo();
        }
        else if (command == "stopdemo") {
            demoRunning = false;
            Serial.println(">> Demo stopped");
        }
        else if (command == "stop") {
            demoRunning = false;
            motorController->disableAllMotors();
            Serial.println(">> Stopped");
        }
        else if (command.startsWith("moveall ")) {
            demoRunning = false;
            handleMoveAllCommand(command);
        }
        else if (command == "moveall") {
            Serial.println("Format: moveall <d1> <d2> <d3> <d4> <d5>");
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
                Serial.println(">> Moving to saved position");
            }
        }
        else if (command == "listpos") {
            positionStore.list();
        }
        else if (command.startsWith("clearpos ")) {
            int slot = command.substring(9).toInt();
            positionStore.clear(slot);
            Serial.print(">> Position slot ");
            Serial.print(slot);
            Serial.println(" cleared");
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
                    Serial.print(">> Timer set: axis ");
                    Serial.print(axis + 1);
                    Serial.print(" in ");
                    Serial.print(delayMs);
                    Serial.println(" ms");
                }
            }
        }
        else if (command == "timers") {
            Serial.print(">> Active timers: ");
            Serial.println(timerManager.getActiveCount());
        }
        else if (command == "cleartimers") {
            timerManager.clear();
            Serial.println(">> All timers cleared");
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
            Serial.print(">> Recorded steps: ");
            Serial.println(teachMode.getStepCount());
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
            else Serial.println("Use: profile slow/normal/fast");
        }
        else if (command == "profile") {
            Serial.print(">> Current profile: ");
            Serial.println(speedProfile.getProfileName());
        }
        // ==================== Trajectory ====================
        else if (command.startsWith("traj line ")) {
            // traj line <d1> <d2> <d3> <d4> <d5> <ms>
            // فعلاً ساده: فقط می‌گه که فعال شده
            Serial.println(">> Trajectory line set (not fully implemented)");
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
                    Serial.print(">> IK solution: ");
                    for (int i = 0; i < NUM_AXES; i++) {
                        Serial.print(angles[i], 1);
                        Serial.print("°");
                        if (i < NUM_AXES - 1) Serial.print(", ");
                    }
                    Serial.println();
                    
                    // FIX: محدودسازی زوایا به محدوده مجاز هر محور
                    // (قبلاً زاویه خارج از محدوده مستقیم می‌رفت و moveAllAxes
                    // آن محور را رد می‌کرد → حرکت ناقص و ناهماهنگ)
                    bool clamped = false;
                    for (int i = 0; i < NUM_AXES; i++) {
                        float c = constrain(angles[i], AXIS_MIN_DEG[i], AXIS_MAX_DEG[i]);
                        if (c != angles[i]) { angles[i] = c; clamped = true; }
                    }
                    if (clamped) {
                        Serial.println(">> Angles clamped to joint limits");
                    }
                    
                    // تبدیل به steps و حرکت
                    int32_t steps[NUM_AXES];
                    for (int i = 0; i < NUM_AXES; i++) {
                        steps[i] = (int32_t)(angles[i] * DEG_TO_STEPS[i]);
                    }
                    motorController->moveAllAxes(steps);
                } else {
                    Serial.println("!! Position out of reach");
                }
            } else {
                Serial.println("Format: ik <x> <y> <z>");
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
                Serial.print(">> FK result: X=");
                Serial.print(x, 1);
                Serial.print(", Y=");
                Serial.print(y, 1);
                Serial.print(", Z=");
                Serial.println(z, 1);
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
            Serial.println("Unknown command");
        }
    }
}

void startDemo() {
    if (demoRunning) {
        Serial.println("!! Demo already running");
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
        Serial.println("!! Not all axes are homed");
        return;
    }
    demoRunning = true;
    demoStep = 0;
    demoRepeat = 0;
    lastDemoMove = 0;
    Serial.println(">> Starting demo");
}

void printStatus() {
    Serial.println("=== System Status ===");
    Serial.print("State: ");
    switch (systemState) {
        case STATE_INIT:   Serial.println("Initializing"); break;
        case STATE_HOMING: Serial.println("Homing"); break;
        case STATE_READY:  Serial.println("Ready"); break;
        case STATE_MOVING: Serial.println("Moving"); break;
        case STATE_ERROR:  Serial.println("Error"); break;
        case STATE_ESTOP:  Serial.println("Emergency Stop"); break;
    }
    
    if (demoRunning) {
        Serial.print("Demo: RUNNING (");
        Serial.print(demoStep + 1);
        Serial.print("/");
        Serial.print(DEMO_MOVE_COUNT);
        Serial.println(")");
    }
    
    Serial.print("Profile: ");
    Serial.println(speedProfile.getProfileName());
    
    if (energyManager.isSleeping()) {
        Serial.println("Status: SLEEPING");
    }

    for (int i = 0; i < NUM_AXES; i++) {
        Axis* axis = motorController->getAxis(i);
        int32_t pos = axis->getCurrentPosition();
        float degrees = (float)pos / DEG_TO_STEPS[i];
        
        Serial.print("Axis "); Serial.print(i + 1);
        Serial.print(": "); Serial.print(pos);
        Serial.print(" ("); Serial.print(degrees, 1); Serial.print("°)");
        Serial.print(", Homed="); Serial.print(axis->isHomed() ? "Y" : "N");
        Serial.print(", En="); Serial.print(axis->isEnabled() ? "Y" : "N");
        Serial.print(", Mov="); Serial.print(axis->isMoving() ? "Y" : "N");
        Serial.print(", ES="); Serial.println(axis->getEndstopState() ? "Open" : "Trig");
    }
    Serial.println("======================");
}

void handleMoveCommand(String command) {
    int firstSpace = command.indexOf(' ');
    int secondSpace = command.indexOf(' ', firstSpace + 1);
    if (secondSpace == -1) {
        Serial.println("Format: move <axis> <steps>");
        return;
    }
    int axis = command.substring(firstSpace + 1, secondSpace).toInt() - 1;
    int32_t steps = command.substring(secondSpace + 1).toInt();
    if (axis >= 0 && axis < NUM_AXES) {
        if (!motorController->getAxis(axis)->isEnabled()) {
            Serial.print("!! Axis "); Serial.print(axis + 1);
            Serial.println(" is DISABLED — send 'enable' or run 'home' first");
        }
        motorController->moveTo(axis, steps);
        Serial.print("Moving axis "); Serial.print(axis + 1);
        Serial.print(" to "); Serial.print(steps); Serial.println(" steps");
    }
}

void handleDegCommand(String command) {
    int firstSpace = command.indexOf(' ');
    int secondSpace = command.indexOf(' ', firstSpace + 1);
    if (secondSpace == -1) {
        Serial.println("Format: deg <axis> <degrees>");
        return;
    }
    int axis = command.substring(firstSpace + 1, secondSpace).toInt() - 1;
    float degrees = command.substring(secondSpace + 1).toFloat();
    
    if (axis < 0 || axis >= NUM_AXES) {
        Serial.println("Invalid axis");
        return;
    }
    if (degrees < AXIS_MIN_DEG[axis] || degrees > AXIS_MAX_DEG[axis]) {
        Serial.print("!! Axis "); Serial.print(axis + 1);
        Serial.print(" out of range (");
        Serial.print(AXIS_MIN_DEG[axis], 1);
        Serial.print("° to ");
        Serial.print(AXIS_MAX_DEG[axis], 1);
        Serial.println("°)");
        return;
    }
    
    // FIX: قبلاً محورِ غیرفعال بی‌صدا رد می‌شد — حالا صریح می‌گوییم
    if (!motorController->getAxis(axis)->isEnabled()) {
        Serial.print("!! Axis "); Serial.print(axis + 1);
        Serial.println(" is DISABLED — send 'enable' or run 'home' first");
    }
    
    int32_t steps = (int32_t)(degrees * DEG_TO_STEPS[axis]);
    motorController->moveTo(axis, steps);
    Serial.print("Moving axis "); Serial.print(axis + 1);
    Serial.print(" to "); Serial.print(degrees, 1);
    Serial.print("° ("); Serial.print(steps); Serial.println(" steps)");
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
            Serial.print("!! Missing degree for axis "); Serial.println(i + 1);
            return;
        }
        
        float degrees = degStr.toFloat();
        if (degrees < AXIS_MIN_DEG[i] || degrees > AXIS_MAX_DEG[i]) {
            Serial.print("!! Axis "); Serial.print(i + 1);
            Serial.print(" out of range");
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
        Serial.println("!! All motors DISABLED — send 'enable' or run 'home' first");
    }
    
    motorController->moveAllAxes(steps);
    Serial.print("Moving all: ");
    for (int i = 0; i < NUM_AXES; i++) {
        Serial.print(steps[i]);
        if (i < NUM_AXES - 1) Serial.print(", ");
    }
    Serial.println(" steps");
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
                    Serial.println(">> Demo complete!");
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
    Serial.print(">> Demo step ");
    Serial.print(demoStep + 1);
    Serial.print("/");
    Serial.println(DEMO_MOVE_COUNT);
    
    lastDemoMove = currentTime;
    demoStep++;
    
    if (demoStep >= DEMO_MOVE_COUNT) {
        demoStep = 0;
        demoRepeat++;
        if (demoRepeat >= DEMO_MAX_REPEATS) {
            demoRunning = false;
            demoRepeat = 0;
            Serial.println(">> Demo complete!");
        }
    }
}

// FIX: پین ۲۲ روی Mega2560 وقفه‌ی خارجی ندارد (فقط پین‌های 2,3,18,19,20,21)
// و این ISR هرگز attach نمی‌شد (کد مرده). پین E-STOP از قبل داخل
// MotorController::update() با نرخ 1kHz poll می‌شود — همین کافی است.