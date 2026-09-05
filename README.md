# 5 DOF Robot Arm Firmware for Arduino Mega2560

## 🖥️ GUI Control Panel (جدید)

A complete dedicated GUI for this firmware is available in the [`gui/`](gui/) folder — **no installation needed**.

- Open `gui/index.html` in **Chrome or Edge** → it connects directly to the Mega2560 over **Web Serial** (115200 baud)
- Full coverage of every firmware command: homing, jog, moveall, demo, position store (10 slots), teach & playback, timers, speed profiles, IK/FK, energy manager, on-board logger and a full serial console
- Live 2D visualizer (side + top view), status polling & parsing, one-click **E-STOP**
- Includes a **built-in firmware simulator** so you can test the whole panel without hardware

See [`gui/README-GUI.md`](gui/README-GUI.md) for the full guide (فارسی).

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
