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
home / home <1-5>            smart, non-blocking homing
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

---

## Development

`tools/sim_motion.py` simulates the exact motion math (old vs. new firmware)
on a desktop, so speed regressions can be measured without hardware:

```bash
python3 tools/sim_motion.py
```
