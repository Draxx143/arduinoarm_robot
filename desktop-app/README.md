# AXIS-5 Robot Control — Desktop App

Industrial English-language **desktop application** (Electron) for the 5-DOF Arduino Mega 2560 robot arm firmware (`RobotArm_Firmware.ino`).

## 🆕 What's new in v1.0.38

- **THE root cause of "بعد از E-STOP هوم کار نمی‌کند" + demo-noise found (re-flash)** — `EMERGENCY_STOP_PIN 22` was polled every 1 ms and **ANY LOW level immediately re-latched the E-STOP**. A floating/noisy wire on pin 22 (or a held physical button) meant: homing cleared the latch and got re-estopped within 1 ms (homing NEVER worked), and random mid-motion estops left all steppers energized at hold current — the loud demo whine. The hardware input is now **debounced (25 consecutive LOW reads ≈ 25 ms) and edge-triggered**: noise has zero effect, a real held button trips once, and homing always recovers. Host test T8 drives noise spikes (no trip), a held press (exactly one trip), then proves homing + moves recover.
- **Firmware version gate (re-flash guidance built in)** — the board now prints `AXIS-5 Firmware v1.0.38` at boot and `FW: v1.0.38` in every status block. Both apps parse it and show a prominent warning + toast when the connected board runs an older build: *"the E-STOP / smooth-J2 / homing fixes are NOT on this board — flash firmware/RobotArm_Firmware/ then reconnect"*. No more silent "I updated the app but the board still misbehaves".
- Everything from v1.0.37 is included: S-curve accel, carry-speed slider retarget, soft homing-seek ramp, non-blocking pre-homing back-off, real soft `stop`, POS slider sync, park-0 homing, honest guards.
- Tested before release: firmware host tests (test_mc T1–T8, test_cli, test_ino T1–T15) + 41 jsdom UI checks across the desktop app and the web GUI.

## 🆕 What's new in v1.0.37

- **J2 is smooth everywhere now (re-flash)** — the accel/decel curve was rebuilt as a true S-curve (smoothstep, slope-zero at both ends; the old curve had a mid-curve kink that J2 made audible) starting from 15 % of max speed (no crawl-start), and a **same-direction retarget now carries the current speed** instead of slam-stop + jump-start — rapid slider changes glide. Homing search gets a soft 400 st/s ramp instead of an instant 1000–1200 st/s jump. Proven by host tests: pulse gaps uniform (333 µs ±0), all-axis demo move min gap 285–610 µs (no bursts), retarget stream never stalls.
- **E-STOP is answered instantly, even while homing starts (re-flash)** — a REAL bug: the pre-homing endstop back-off busy-waited up to **5.2 s** (X: 5200 steps × 1 ms) with serial dead — an E-STOP sent in that window was read only after it (the classic "باید چند بار بزنم"). The back-off is now a non-blocking phase of the step scheduler; host test T11 presses E-STOP mid-back-off and gets an immediate `EMERGENCY STOP!`.
- **Soft `stop` no longer sends phantom pulses (re-flash)** — it only switched the drivers off while the scheduler kept stepping (lost steps + stepper noise + corrupted position). It now truly halts every axis, stops demo/playback, disables the drivers (E-STOP latch is NOT set — `home` right after works, no `reset` needed), and emits `>> POS …`.
- **Demo = Motion, verified** — demo steps run the exact same guarded motion path; host test T5 drives ALL five axes together and proves every pulse is ≥285 µs apart (the old burst engine that made steppers scream is gone).
- **Flood-proof typing** — host test T14 fires 60 commands while a move is running: zero `Unknown command` (150 ms idle-flush + 120-char guard + app-side coalescing ≤2 commands per slider gesture).
- **teach / play / slots / sleep / wake proven end-to-end** — new host tests T12 (record → play returns the axis to the recorded pose) and T13 (soft stop), on top of T4 (sleep/wake) and T6 (EEPROM slots across power-cycle).
- 14 firmware simulation tests + 7 motor-level tests + 35 jsdom UI checks all green before release.

## 🆕 What's new in v1.0.36

- **Sliders follow the board (POS sync channel)** — the firmware now emits `>> POS d1,…,d5` (degrees) after every completed move, homing, `deg`/`move`/`moveall`, `loadpos`, demo step, IK solution and timer fire. The Motion sliders, numeric boxes and degree labels ride along live — including moves you typed in the terminal. A slider you are currently dragging is never overwritten.
- **E-STOP is single-press now** — the header has a real **⛔ E-STOP** button (Esc still works). The app drops pending slider sends so the stop goes out first, and automatically re-sends (up to 2 retries) until the board confirms with `EMERGENCY STOP!`.
- **Homing works again after E-STOP → reset** — a real firmware bug: `clearEstopForHoming()` returned after the FIRST cleared axis, leaving the other four E-STOP-latched so recovery homing stalled. Now all five axes clear (host test T3).
- **Homing parks every axis at 0.0°** — the zero reference is now the end of the back-off travel (park position), so after every homing the Motion sliders land exactly on 0 — ready to move.
- **New motion engine — J2 is smooth** — per-axis step scheduler with a dynamically re-programmed Timer1 OCR (step-interval clamp 50 µs…32 ms, prescaler 8): exact pulse timing without catch-up bursts, so J2 (and every axis) accelerates and cruises without jerk or noise. Motor-level host test proves FAST < NORMAL < SLOW timings on the real state machine.
- **Demo behaves like Motion-tab moves** — every demo step prints `>> Demo step k/N` + its own `>> POS …` and runs through the same guarded motion path (no misfires, no noise).
- **teach / teach step / play / savepos / loadpos / sleep / wake / autosleep / timer really act** — honest guards everywhere: moves while sleeping / E-STOPPED / not homed / disabled are refused with a clear `!!` reason (board and simulator behave identically). `timer <ms> <axis> [<target-steps>]` takes an optional target; slots persist in EEPROM (`(persisted in EEPROM)`).
- **`profile` reply text matches the board** (`>> Applied: speed x1.00, accel x1.00`), and the profile affects homing AND normal moves.
- **Everything tested before release** — firmware host suites (`test_mc`, `test_cli`, `test_ino` T1–T10) run the real `.ino` translation unit; jsdom UI suites drive the desktop app AND the web GUI end-to-end: homing → sliders zero, POS sync, ≤2 commands per slider drag, single-press E-STOP → refusal → recovery → move again, sleep/wake gating, clear screen.

## 🆕 What's new in v1.0.35

- **Speed profile REALLY works (re-flash)** — the 1 kHz loop allowed at most one step per tick (~1000 steps/s ceiling); axes now catch up within safe bounds so `profile slow/normal/fast` is clearly visible, on homing as well as normal moves.
- **Homing order J1 → J2 → J3 → J4 → J5** with the **J2/J3 choreography** — J2 nudges forward 250 steps, holds while J3 homes, then returns exactly to its back-off position.
- **J3 range 0…+70°** (firmware + soft limits + both UIs).
- **Clear screen fixed**; the console became a real free-floating window (drag/resize, position remembered across restarts — both apps).
- **User firmware edits merged** (widened joint limits, `AXIS_Y_BACKOFF` 400) with step soft-limits synced end-to-end.
- **Duplicate slider send fixed** (a release sends exactly once) and **split-line "Unknown command" fixed** (150 ms idle-flush; fragments shorter than 3 chars are never executed).

## 🆕 What's new in v1.0.26–v1.0.34 (condensed)

- **v1.0.31** — python-bridge serial transport (Linux default, PTY-tested), 🔬 Port Test, mainRX/diag, true-silence ACK mode (ON = board silent), `SerialCLI` firmware module, 120-char line guard, console always visible on every tab, quick chips below the terminal, fixed-viewport layout (Esc/F4/F2 shortcuts), slider-flood coalescing, "why doesn't it move?" hints, IK honesty (clamped results shown).
- **v1.0.32/33** — DTR auto-reset on connect (board reboots like the Arduino IDE), RX hardening (dual delivery + 15 ms pump), backoff proof line in the board output, resizable splitter between content and console (remembered).
- **v1.0.34** — your own `.ino`/`Config.h` edits taken over verbatim (plus disclosed consistency fixes), floating console window (drag/resize both axes, persisted) in both apps.

## ✨ Features

- **Program Sequencer** — build a step list of poses with dwell times, run it end-to-end (moveall → wait for motion → dwell → next), reorder/delete steps, export/import as JSON
- **Keyboard jog** — press 1–5 to pick a joint, ←/→ to jog (Shift = ×3)
- **Real serial link** to the board (Web Serial inside Electron, 115200 8N1) with an in-app COM-port chooser
- **Full command coverage**: home/status/enable/disable/estop/reset, demo, `moveall`/`deg`/`move`, position store (10 slots), teach & playback, timers, speed profiles, IK/FK, sleep/wake/autosleep, on-board logger
- **Built-in firmware simulator** — test everything without hardware
- **PLC-style status lamps**, industrial “Steel & Amber” HMI theme
- **Smart event feed** — duplicate events collapse into ×N badges, pause & clear controls, status-poll spam filtered out
- **Connection card** — scan/select the Arduino's port with one click, auto-connect on start, live link badge
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
| `AXIS5-Robot-Control-Setup-1.0.31.exe` | Windows 10/11 x64 | Run the installer (desktop + start-menu shortcuts) |
| `AXIS5-Robot-Control-Portable-1.0.31.exe` | Windows 10/11 x64 | Single file — just run it, no installation |
| `AXIS5-Robot-Control-1.0.31-amd64.deb` | Ubuntu / Debian | `sudo apt install ./AXIS5-Robot-Control-1.0.31-amd64.deb` |
| `AXIS5-Robot-Control-1.0.31-x86_64.AppImage` | Any Linux x64 | `chmod +x *.AppImage` then run |

Every push to the app also rebuilds the installers (see `.github/workflows/build.yml`).

## 📦 Build installers yourself (optional)

| OS | Command | Output |
|---|---|---|
| Windows | `npm run dist:win` | `dist/AXIS5-Robot-Control-Setup-1.0.31.exe` (installer) + `AXIS5-Robot-Control-Portable-1.0.31.exe` (portable) |
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
