# AXIS-5 Robot Control — Desktop App

Industrial English-language **desktop application** (Electron) for the 5-DOF Arduino Mega 2560 robot arm firmware (`RobotArm_Firmware.ino`).

## ✨ Features

- **Drag-to-pose canvas** — grab any joint (side view) or the base ring (top view) and drag to pose the arm; enable “Send on slider release” to move the real arm as you drop
- **Program Sequencer** — build a step list of poses with dwell times, run it end-to-end (moveall → wait for motion → dwell → next), reorder/delete steps, export/import as JSON
- **Live telemetry** — per-axis speed (°/s) computed from firmware status polling
- **Keyboard jog** — press 1–5 to pick a joint, ←/→ to jog (Shift = ×3)
- **Real serial link** to the board (Web Serial inside Electron, 115200 8N1) with an in-app COM-port chooser
- **Full command coverage**: home/status/enable/disable/estop/reset, demo, `moveall`/`deg`/`move`, position store (10 slots), teach & playback, timers, speed profiles, IK/FK, sleep/wake/autosleep, on-board logger
- **Live 2D visualizer** (side + top view) with metallic links, angle-arc indicators, limit sectors, shadows, target crosshair and motion trail
- **Built-in firmware simulator** — test everything without hardware
- **PLC-style status lamps**, industrial “Steel & Amber” HMI theme
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
| `AXIS5-Robot-Control-Setup-1.0.1.exe` | Windows 10/11 x64 | Run the installer (desktop + start-menu shortcuts) |
| `AXIS5-Robot-Control-Portable-1.0.1.exe` | Windows 10/11 x64 | Single file — just run it, no installation |
| `AXIS5-Robot-Control-1.0.1-amd64.deb` | Ubuntu / Debian | `sudo apt install ./AXIS5-Robot-Control-1.0.1-amd64.deb` |
| `AXIS5-Robot-Control-1.0.1-x86_64.AppImage` | Any Linux x64 | `chmod +x *.AppImage` then run |

Every push to the app also rebuilds the installers (see `.github/workflows/build.yml`).

## 📦 Build installers yourself (optional)

| OS | Command | Output |
|---|---|---|
| Windows | `npm run dist:win` | `dist/AXIS5-Robot-Control-Setup-1.0.1.exe` (installer) + `AXIS5-Robot-Control-Portable-1.0.1.exe` (portable) |
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
| `failed to execvp: /opt/AXIS…` | Fixed in v1.0.4 — the install path no longer contains spaces. Upgrade the .deb |
| Garbled/blank window in a VM | Run `AXIS5_SAFE=1 axis5-robot-control` (disables GPU accel) |
| Serial port missing | `sudo usermod -aG dialout $USER` then log out/in |

## 🔌 How the serial chooser works (Electron)

Electron has no built-in serial chooser dialog. When the renderer calls
`navigator.serial.requestPort()`, the main process receives the system port
list via the `select-serial-port` event and forwards it to the renderer,
which shows the in-app dialog. Selecting a port resolves the original
request — the rest of the transport is pure Web Serial.
