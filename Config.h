#ifndef CONFIG_H
#define CONFIG_H

// ============================================
// ROBOT ARM CONFIGURATION
// ============================================

// Number of Joints
#define NUM_AXES 5

// ============================================
// AXIS X (Joint 1)
// ============================================
#define AXIS_X_STEP_PIN     A0    // Digital 54
#define AXIS_X_DIR_PIN      A1    // Digital 55
#define AXIS_X_ENABLE_PIN   38
#define AXIS_X_ENDSTOP_PIN  3
//هر 4000 تا ۹۰ درجه
#define AXIS_X_STEPS_PER_REV  200    // NEMA17 200 steps/rev
#define AXIS_X_MICROSTEP      16     // 1/16 microstepping
#define AXIS_X_GEAR_RATIO     5    // Gear ratio
#define AXIS_X_INVERT_DIR     true
#define AXIS_X_MAX_SPEED      2000   // steps/second
#define AXIS_X_ACCELERATION   700    // steps/s²
#define AXIS_X_BACKOFF        5200   // steps to back off after homing

// ============================================
// AXIS Y (Joint 2)
// ============================================
#define AXIS_Y_STEP_PIN     A6    // Digital 60
#define AXIS_Y_DIR_PIN      A7    // Digital 61
#define AXIS_Y_ENABLE_PIN   A2    // Digital 56
#define AXIS_Y_ENDSTOP_PIN  14
//هر 4800 تا ۹۰ درجه
#define AXIS_Y_STEPS_PER_REV  200
#define AXIS_Y_MICROSTEP      16     // ❌ اشتباه! باید 16 باشه
#define AXIS_Y_GEAR_RATIO     6
#define AXIS_Y_INVERT_DIR     true
#define AXIS_Y_MAX_SPEED      2000
#define AXIS_Y_ACCELERATION   1000
#define AXIS_Y_BACKOFF        300

// ============================================
// AXIS Z (Joint 3)
// ============================================
#define AXIS_Z_STEP_PIN     46
#define AXIS_Z_DIR_PIN      48
#define AXIS_Z_ENABLE_PIN   A8    // Digital 62
#define AXIS_Z_ENDSTOP_PIN  18
//هر 6400 تا ۹۰ درجه
#define AXIS_Z_STEPS_PER_REV  200
#define AXIS_Z_MICROSTEP      16
#define AXIS_Z_GEAR_RATIO     8
#define AXIS_Z_INVERT_DIR     true
#define AXIS_Z_MAX_SPEED      1000
#define AXIS_Z_ACCELERATION   500
#define AXIS_Z_BACKOFF        200

// ============================================
// AXIS A (Joint 4)
// ============================================
#define AXIS_A_STEP_PIN     26
#define AXIS_A_DIR_PIN      28
#define AXIS_A_ENABLE_PIN   24
#define AXIS_A_ENDSTOP_PIN  2
//هر 2400 تا ۹۰ درجه
#define AXIS_A_STEPS_PER_REV  200
#define AXIS_A_MICROSTEP      16
#define AXIS_A_GEAR_RATIO     3
#define AXIS_A_INVERT_DIR     true
#define AXIS_A_MAX_SPEED      1000
#define AXIS_A_ACCELERATION   500
#define AXIS_A_BACKOFF        3000

// ============================================
// AXIS B (Joint 5)
// ============================================
#define AXIS_B_STEP_PIN     36
#define AXIS_B_DIR_PIN      34
#define AXIS_B_ENABLE_PIN   30
#define AXIS_B_ENDSTOP_PIN  15
//هر 2000 تا ۹۰ درجه
#define AXIS_B_STEPS_PER_REV  200
#define AXIS_B_MICROSTEP      16
#define AXIS_B_GEAR_RATIO     2.5
#define AXIS_B_INVERT_DIR     true
#define AXIS_B_MAX_SPEED      1000
#define AXIS_B_ACCELERATION   500
#define AXIS_B_BACKOFF        200

// ============================================
// SYSTEM CONFIGURATION
// ============================================

// Timer Configuration (16-bit Timer)
#define TIMER_PRESCALER      64
#define TIMER_FREQUENCY      16000000L
#define TIMER_TICK_FREQ      (TIMER_FREQUENCY / TIMER_PRESCALER)  // 250kHz

// Control Loop Frequency (Hz)
#define CONTROL_LOOP_FREQ    1000    // 1kHz control loop

// ROS Communication
#define ROS_BAUDRATE         57600

// Homing Order (Z first, then Y, X, A, B)
#define HOMING_ORDER         {2, 1, 0, 3, 4}  // Z, Y, X, A, B

// Emergency Stop Pin (optional)
#define EMERGENCY_STOP_PIN   22

// Software Limits (in steps from home)
#define AXIS_X_SOFT_MIN      -4888   // -110° (محور 1: +110/-110)
#define AXIS_X_SOFT_MAX      4888    // +110°

#define AXIS_Y_SOFT_MIN      0       // 0° (محور 2: فقط +100)
#define AXIS_Y_SOFT_MAX      8889  
  // 100° × 88.89
#define AXIS_Z_SOFT_MIN      0       // 0° (محور 3: فقط +55)
#define AXIS_Z_SOFT_MAX      3911    // +55°

#define AXIS_A_SOFT_MIN      -2400   // -90° (محور 4: +90/-90)
#define AXIS_A_SOFT_MAX      2400    // +90°

#define AXIS_B_SOFT_MIN      -2000   // -90° (محور 5: +90/-90)
#define AXIS_B_SOFT_MAX      2000    // +90°

// ============================================
// DEBUG
// ============================================
// FIX: تعریف دوگانه حذف شد — فقط یک تعریف داخل include guard باقی ماند
#define DEBUG_SERIAL         false
#define DEBUG_ROS            false

#endif // CONFIG_H
