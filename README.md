# 5 DOF Robot Arm Firmware for Arduino Mega2560

## 🖥️ Desktop App — AXIS-5 Robot Control (new)

A native **desktop application** (Electron) for Windows & Linux lives in [`desktop-app/`](desktop-app/):
fully in **English**, with an industrial "Steel & Amber" HMI theme.

```bash
cd desktop-app
npm install          # first run downloads the Electron runtime
npm start            # run the app
npm run dist:win     # build .exe installer + portable (Windows)
npm run dist:linux   # build .AppImage + .deb (Linux)
```

One-click builders: `build-windows.bat` (Windows) / `build-linux.sh` (Linux).
See [`desktop-app/README.md`](desktop-app/README.md).

## 🌐 GUI Control Panel (browser version)

A zero-install web version of the same panel is available in the [`gui/`](gui/) folder (Persian, RTL).
Open `gui/index.html` in **Chrome or Edge** — it connects directly to the Mega2560 over **Web Serial**.

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
