# AXIS-5 Robot Control — Desktop App

Industrial English-language **desktop application** (Electron) for the 5-DOF Arduino Mega 2560 robot arm firmware (`RobotArm_Firmware.ino`).

## 🆕 What's new in v1.0.7 (firmware audit + GUI fixes)

**Firmware (`RobotArm_Firmware.ino` + modules):**
- **Homing no longer freezes the board** — `processHoming()` ran `delay(10)` + a blocking back-off loop (up to ~5 s for axis X) *inside the 1 kHz timer ISR*, starving the serial link and the main loop. It is now fully non-blocking (phase-based: seek → back-off at 1 kHz → zero).
- **`timer` command actually moves** — `TimerManager` fired and only printed a message; the motion call was a stub. It now drives `motorController->moveTo()` through a proper callback wired in `setup()`.
- **IK/FK consistency** — `solveIK` targeted the end of L2 while checking reachability against L1+L2+L3, and `solveFK` ignored L3 entirely. Both now model the effective forearm L2+L3 (wrist collinear at J4=J5=0) — FK is now the exact inverse of IK, and the GUI preview matches the board.
- **`ik` clamps to joint limits** before moving (no more partial/rejected multi-axis moves); sim mirrors this.
- **Y soft-limit fixed** — `AXIS_Y_SOFT_MAX` was 8889 steps (≈166°) instead of 5333 (100°).
- Dead `emergencyStopISR()` (never attached — pin 22 is not an external-int pin on the Mega) replaced with a comment; E-STOP pin is polled at 1 kHz as before.

**Desktop app:**
- **Quick chips rebuilt** — only high-use, complete commands; enable/disable appear once; every chip string is verified against the parser (zero "Unknown command" chips).
- **J2/J3 slider fill fixed** — the colored fill bar appeared half-filled at 0 on first open; fills are now painted correctly at build time.

## ✨ Features

- **Program Sequencer** — build a step list of poses with dwell times, run it end-to-end (moveall → wait for motion → dwell → next), reorder/delete steps, export/import as JSON
- **Live telemetry** — per-axis speed (°/s) computed from firmware status polling
- **Keyboard jog** — press 1–5 to pick a joint, ←/→ to jog (Shift = ×3)
- **Real serial link** to the board (Web Serial inside Electron, 115200 8N1) with an in-app COM-port chooser
- **Full command coverage**: home/status/enable/disable/estop/reset, demo, `moveall`/`deg`/`move`, position store (10 slots), teach & playback, timers, speed profiles, IK/FK, sleep/wake/autosleep, on-board logger
- **Compact telemetry panel** — per-joint digital readouts with position scales, target markers, live deg/s speeds and the FK tool position (X/Y/Z/R). No gimmick drawings, just data
- **Built-in firmware simulator** — test everything without hardware
- **PLC-style status lamps**, industrial “Steel & Amber” HMI theme
- **Smart event feed** — duplicate events collapse into ×N badges, pause & clear controls, status-poll spam filtered out
- Serial console with history, quick-command chips and log export
- `Esc` = E-STOP, `Ctrl+K` = console focus

## ▶ Run from source

Requires [Node.js LTS](https://nodejs.org) (18+).

```bash
cd desktop-app
npm install
npm start
```

## ⬇ Download ready-made installers

Prebuilt installers are published automatically by GitHub Actions to the repo's **Releases** page:

**https://github.com/Draxx143/arduinoarm_robot/releases/latest**

| File | Platform | How to install |
|---|---|---|
| `AXIS5-Robot-Control-Setup-1.0.7.exe` | Windows 10/11 x64 | Run the installer (desktop + start-menu shortcuts) |
| `AXIS5-Robot-Control-Portable-1.0.7.exe` | Windows 10/11 x64 | Single file — just run it, no installation |
| `AXIS5-Robot-Control-1.0.7-amd64.deb` | Ubuntu / Debian | `sudo apt install ./AXIS5-Robot-Control-1.0.7-amd64.deb` |
| `AXIS5-Robot-Control-1.0.7-x86_64.AppImage` | Any Linux x64 | `chmod +x *.AppImage` then run |

Every push to the app also rebuilds the installers (see `.github/workflows/build.yml`).

## 📦 Build installers yourself (optional)

| OS | Command | Output |
|---|---|---|
| Windows | `npm run dist:win` | `dist/AXIS5-Robot-Control-Setup-1.0.7.exe` (installer) + `AXIS5-Robot-Control-Portable-1.0.7.exe` (portable) |
| Linux | `npm run dist:linux` | `dist/AXIS5-Robot-Control-1.0.1-x64.AppImage` + `.deb` |

Build both from Linux/macOS: `npm run dist` (Windows builds cross-compile fine from Linux).

Prebuilt binaries are attached to the repository's GitHub Releases when available.

## 🗂 Structure

```
desktop-app/
├── main.js            Electron main process (window, serial permissions, chooser bridge)
├── preload.js         contextBridge API for the renderer
├── package.json       build config (electron-builder)
└── renderer/
    ├── index.html     the whole UI (English, RTL-free)
    ├── css/industrial.css
    ├── assets/icon.png
    └── js/
        ├── core.js    firmware mirror: constants, parser, command builder, kinematics
        ├── serial.js  Web Serial transport + Electron chooser bridge
        ├── sim.js     in-app firmware simulator
        ├── viz.js     canvas visualizer (side + top views)
        └── app.js     UI logic
```


## 🛟 Linux troubleshooting (Ubuntu 23.10 / 24.04 / 26.x)

| Symptom | Fix |
|---|---|
| App dies instantly from the menu icon | Use the terminal launcher `axis5-robot-control`, then check `~/.axis5/last-run.log` |
| `The SUID sandbox helper…` / `zygote_host_impl_linux.cc Check failed` | The deb wrapper already passes `--no-sandbox`. For the **AppImage**, run it with `--no-sandbox` too |
| `failed to execvp: /opt/AXIS…` | Fixed in v1.0.6 — the install path no longer contains spaces. Upgrade the .deb |
| Garbled/blank window in a VM | Run `AXIS5_SAFE=1 axis5-robot-control` (disables GPU accel) |
| Serial port missing | `sudo usermod -aG dialout $USER` then log out/in |

## 🔌 How the serial chooser works (Electron)

Electron has no built-in serial chooser dialog. When the renderer calls
`navigator.serial.requestPort()`, the main process receives the system port
list via the `select-serial-port` event and forwards it to the renderer,
which shows the in-app dialog. Selecting a port resolves the original
request — the rest of the transport is pure Web Serial.
