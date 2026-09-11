# 5 DOF Robot Arm Firmware for Arduino Mega2560

## Overview

This is a complete firmware for a 5-DOF robot arm controlled by an Arduino Mega2560 with ROS integration via rosserial. The firmware handles real-time motor control while ROS handles high-level tasks like inverse kinematics and trajectory planning.

## Features

- **5 Independent Axes Control**: Each axis has its own motion profile
- **Trapezoidal Acceleration/Deceleration**: Smooth motion profiles
- **Homing Sequence**: Automatic homing with configurable order
- **ROS Integration**: Full rosserial communication
- **Emergency Stop**: Hardware and software emergency stop
- **Software Limits**: Configurable soft limits for each axis
- **Modular Design**: Clean, object-oriented code structure

## Hardware Requirements

- Arduino Mega2560
- 5 Stepper Motors (NEMA17/NEMA23)
- 5 Stepper Drivers (A4988/TB6600)
- 5 Endstop Switches (NO, NC compatible)
- USB connection to ROS computer

## Pin Configuration

| Axis | STEP | DIR | ENABLE | ENDSTOP |
|------|------|-----|--------|---------|
| X    | A0   | A1  | 38     | 3       |
| Y    | A6   | A7  | A2     | 14      |
| Z    | 46   | 48  | A8     | 18      |
| A    | 26   | 28  | 24     | 2       |
| B    | 36   | 34  | 30     | 15      |

## Installation

### 1. Install Arduino IDE

Download and install Arduino IDE from [arduino.cc](https://www.arduino.cc/en/software)

### 2. Install rosserial

```bash
sudo apt-get install ros-<distro>-rosserial-arduino
sudo apt-get install ros-<distro>-rosserial

### 3. Open the sketch

Open `RobotArm_Firmware.ino` in the Arduino IDE, select **Arduino Mega 2560**,
and upload.

> `ROS_Interface.cpp` needs the `rosserial_arduino` library. The shipped
> firmware runs in **TEST MODE (no ROS)**, but the file is still part of the
> sketch folder, so rosserial must be installed for the build to succeed.

---

## Speed & motion tuning

Full background (in Persian) in [`SPEED_FIX.md`](SPEED_FIX.md).

The step engine is driven by Timer1 at `STEP_TICK_FREQ` (default **20 kHz**).
That value is the absolute ceiling for step rate:

```
max steps/second per axis = STEP_TICK_FREQ
degrees/second            = MAX_SPEED / (STEPS_PER_REV * MICROSTEP * GEAR_RATIO / 360)
ramp length (steps)       = MAX_SPEED^2 / (2 * ACCELERATION)
ramp time (s)             = MAX_SPEED / ACCELERATION
```

Rule of thumb: pick `ACCELERATION` so the ramp takes **0.2 – 0.4 s**.

### Runtime commands (Serial Monitor @ 115200)

```
speeds                       show the effective speed table
speed <percent>              global speed scale, e.g. speed 150
profile slow|normal|fast     50% / 100% / 150%
maxspeed <axis> <steps/s>    per-axis MAX_SPEED
accel <axis> <steps/s2>      per-axis ACCELERATION
homespeed <axis> <steps/s>   per-axis homing speed
status                       position, homed, moving, live speed, endstops
```

Changes apply to the **next** move (never mid-move).

### Motion commands

```
home                         home ALL joints, in priority order J1 -> J2 -> J3 -> J4 -> J5
home <1-5>                   home a single joint
homeorder                    show the current homing priority
homeorder <j1> <j2> <j3> <j4> <j5>
                             change the priority at runtime (each joint exactly once)
abort                        abort homing / motion
move <axis> <steps>          absolute move in steps
deg <axis> <degrees>         absolute move in degrees
moveall <d1> <d2> <d3> <d4> <d5>
traj line <d1..d5> <ms>      all axes arrive together in <ms>
demo / stopdemo
enable / disable [<axis>]
estop / reset / stop
savepos / loadpos / listpos / clearpos
timer <ms> <axis> <degrees>
teach / teach step / teach stop / play / play stop
ik <x> <y> <z> / fk <a1..a5>
log on|off|show|clear
sleep / wake / autosleep on|off
```

### Homing sequence

Homing is **strictly sequential by priority** and completely non-blocking
(no `delay()` inside the timer ISR, so the serial prompt stays alive and
`abort` works at any time).

For every joint, in priority order (`J1 -> J2 -> J3 -> J4 -> J5` by default):

```
   [endstop already pressed?] --yes--> RELEASE: creep off the switch
                                        |
   SEARCH  : move toward the endstop at AXIS_x_HOMING_SPEED
                                        |  endstop hit
   BACKOFF : dwell HOMING_DWELL_MS, then move away by AXIS_x_BACKOFF steps
                                        |
   VERIFY  : the endstop MUST be released -> position := 0, joint marked homed
                                        |
                              next joint starts only now
```

Guarantees:

* **The backoff is mandatory** — no joint is ever zeroed without backing off.
  The measured backoff distance is always at least `AXIS_x_BACKOFF` steps.
* **The endstop release is verified.** If the switch is still pressed after
  the backoff, homing continues up to `HOMING_BACKOFF_EXTRA_STEPS` more
  steps; if it is *still* pressed, homing **fails loudly** instead of
  silently zeroing on top of a pressed switch (which used to corrupt the
  whole position reference).
* `home` re-homes **all** joints even if they are already marked homed.
* A failing joint **aborts the sequence** — the remaining joints are not
  homed and are reported as not homed.

Reported fault reasons:

| message | meaning |
|---|---|
| `endstop not found within search limit` | switch never triggered — wiring / mount / travel |
| `endstop stuck - never released, even during backoff` | switch stays closed while moving away |
| `endstop still pressed after backoff` | backoff too short for this switch's hysteresis |
| `emergency stop active` | `estop` engaged — send `reset` first |

Tuning in `Config.h`:

```c
#define HOMING_ORDER         {0, 1, 2, 3, 4}   // priority: joint 1 first
#define HOMING_VERIFY_BACKOFF      true        // verify the switch released
#define HOMING_BACKOFF_EXTRA_STEPS 400         // extra travel to free a switch
#define AXIS_X_BACKOFF        5200             // per-joint backoff distance
#define AXIS_X_HOMING_SPEED    900             // per-joint homing speed
```

> Note: joint 1 (`X`) has a large `AXIS_X_BACKOFF` (5200 steps ≈ 117°).
> Since the position zero is defined **at the end of the backoff**, that
> value is part of your machine's geometry — change it only if you know the
> switch is mounted that far from the working zero.

---

## Development

`tools/hosttest/run_tests.sh` builds the **real firmware sources** with g++
against an Arduino stub, links them (so `undefined reference` errors are caught
before flashing), runs `setup()` + `loop()` and feeds **90 serial commands**
through the actual handlers, then runs a behavioural simulation of the 20 kHz
step ISR: homing priority/backoff, trapezoid timing accuracy, speed ceilings,
estop, soft limits and mid-move retargeting.

```bash
bash tools/hosttest/run_tests.sh     # compile + link + smoke test + simulation
```

`tools/sim_motion.py` simulates the exact motion math (old vs. new firmware)
on a desktop, so speed regressions can be measured without hardware:

```bash
python3 tools/sim_motion.py
```
