# AXIS-5 Robot Control — Desktop App

Industrial English-language **desktop application** (Electron) for the 5-DOF Arduino Mega 2560 robot arm firmware (`RobotArm_Firmware.ino`).

## 🆕 What's new in v1.0.28

- **Layout overhaul (user-driven)** — Dashboard tab removed (redundant), **Motion is now the default landing tab**; the **port picker moved into the top bar right next to ⚡ Connect Arduino** (dropdown + ⟳ rescan + auto-connect checkbox); the **Event Feed card was removed**; the docked serial console got **bigger** (wider sidebar, up to 660 px tall) and the **Quick chips moved into the console's own toolbar** next to ACK/Port Test.

## 🆕 What's new in v1.0.28

- **Always-visible serial console** — the console is now a **fixed dock** at the top of the right sidebar, present on **every tab** (Dashboard, Motion, Kinematics, Memory, Scheduler, Reference). You always see exactly what the app sends (`» deg 2 45`) and what the board replies — no tab switching. The old Console tab is gone; every control (ACK, Port Test, RX meter, input + history, quick chips, clear/export) moved with it, and the sidebar scrolls internally while staying pinned.

## 🆕 What's new in v1.0.28

- **Board resets on connect again** — the python bridge now pulses DTR on open (like the Arduino IDE), so the Mega reboots and its boot banner arrives immediately; no more pressing the physical RESET button. A second silent `status` is sent 3 s after connect as a belt-and-braces sync right after the bootloader window.
- **Slider-flood protection** — rapid slider/spinner changes in Motion are coalesced into at most two commands (leading + trailing, 160 ms). Previously a fast wiggle flooded the AVR's 64-byte UART ring while it was busy; dropped middle bytes produced garbled lines the board reported as *"Unknown command"* or bogus out-of-range angles.
- **Firmware overflow guard (re-flash to get it)** — `SerialCLI` now drops any line longer than 120 chars instead of executing a truncated fragment (`!! line too long - dropped`), and the bridge is PTY-retested with the DTR pulse.

## 🆕 What's new in v1.0.28

- **python-bridge transport (Linux/macOS default)** — the Port Test proved `cat` reads the board perfectly while the node-serialport stream delivered nothing, so the main process now talks to the port through a tiny **python3 termios bridge** (`bridge/serial_bridge.py`): one fd for RX+TX, raw mode, base64-line protocol. This is the exact kernel path that demonstrably worked on the affected machine. node-serialport remains the Windows path.
- **PTY-tested** — the bridge is verified against a real pty: RX delivery, TX delivery and clean close all pass.
- **mainRX/transport kind** in diag now reports `py` vs `sp`, and the duplicate `link closed` console line is gone.

## 🆕 What's new in v1.0.28

- **🔬 Port Test button** — closes the link and reads the port for 2 s with a **raw OS reader** (`cat`), then tells you which side is broken: *"Board IS transmitting (N bytes raw)"* (→ driver path issue, reconnect) or *"Board sent NOTHING"* (→ the board itself is silent: firmware/baud/power). This splits the RX=0 mystery definitively in half.
- **mainRX counter** — the diag line now shows bytes seen *by the main-process driver* (`mainRX`) vs bytes that reached the UI (`appRX`), so a loss between them is visible.
- Port-holders check no longer blames the app itself (its own PID is filtered out).

## 🆕 What's new in v1.0.28

- **True silence** — with ACK **ON** the board prints *nothing at all*: not the echo, not homing progress, not endstop checks — every module's output (`MotorController`, `TeachMode`, `PositionStore`, …) goes through the mute gate (`C_PRINT*` macros). The only exceptions are the `ack` meta replies themselves, so you can always turn sound back on. Commands still **execute** while silent (verified by host tests).
- **RX=0 detective** — when the board sends 0 bytes for 6 s, the app now runs `fuser` on the port and **names the program holding it** (e.g. the Arduino IDE's Serial Monitor) — two readers on one port steal each other's bytes, which is the #1 cause of a dead-looking console.
- ACK button hint corrected to the real semantics.

## 🆕 What's new in v1.0.28

- **ACK semantics inverted (as requested)** — **ON = the board goes SILENT** (no echo, no confirmations, nothing extra over serial); **OFF (default) = confirmations enabled** (`>> ACK: <cmd> - executed` after every command except the auto-polled `status`). Confirmed by the new SerialCLI host tests.
- **RX hardening** — received bytes are now delivered through *both* mechanisms at once (`data` event **and** a 15 ms `read()` pump), the console header shows a live **RX meter**, and the card's `diag:` line reports whether the native driver actually loaded (`driver loaded ✓ / FAILED ✗`) plus the live RX byte count.

## 🆕 What's new in v1.0.28

- **New firmware library: `SerialCLI`** (`SerialCLI.h/.cpp`) — the whole serial-monitor layer now lives in one clean module: non-blocking char-by-char reading (no `readStringUntil`, no timeouts, works with any Serial-Monitor line-ending setting), echo, logger hook, ACK state, and unknown-command reporting. `RobotArm_Firmware.ino` just exposes `handleCommand(cmd) → bool`.
- **ACK button now flips instantly** (optimistic UI) and re-syncs from the board's reply.
- **RX reliability**: the Electron main process now pumps received bytes on a 15 ms poll (immune to Node-stream mode differences), the status-block suppression can never stick (loose footer match + 30-line cap + reply-line breaker), and a live **RX byte meter** sits in the console header — if the board sends nothing for 6 s the app tells you exactly what to check.

## 🆕 What's new in v1.0.28

- **IK honesty** — the IK result box now shows the **clamped** angles (with a *clamped* marker) exactly as the board will execute them, instead of showing ideal angles the joints cannot reach. Board-side `ik` also clamps **before** printing, so the printed solution = the executed solution.
- `Serial.setTimeout(8)` in firmware `setup()` — removes the 1 s stall `readStringUntil` could add on partial lines.
- Full firmware audit re-run: Config soft limits ✓, Logger/EnergyManager/SpeedProfile/PositionStore ✓.

## 🆕 What's new in v1.0.28

- **ACK toggle button** in the Serial Console (both apps) — ON sends `ack on`: the board replies `>> ACK: <command> - executed` after every command it understands; OFF sends `ack off`: the board just runs commands with zero extra traffic. The button state syncs itself from the board's own replies (so manual `ack on` in the console flips it too), and it resets to OFF after a reconnect, because the board reboots on link-open. New firmware commands: `ack on` / `ack off` / `ack` (query) — flash `firmware/RobotArm_Firmware/` to get them; the simulator supports them too.

## 🆕 What's new in v1.0.28

- **Clean console** — the automatic `status` polls still drive the telemetry but no longer print anything to the serial console. The console now shows exactly what you type and the board's real answers (`» deg 2 45` → `Moving axis 2 to 45°`, `!!` complaints, etc.). Sending `status` manually still prints the full block.

## 🆕 What's new in v1.0.28

- **"Why doesn't it move?" is now answered in the UI** — the Mega/CH340 auto-resets when a link opens, so axes come up disabled & unhomed and moves are silently dropped. The Connection card now shows *"Board rebooted on connect — press ⌂ Home All first"* right after the status poll, and any firmware `!!` complaint pops up as a toast.
- Firmware now **says why it refuses**: `deg`/`move` on a disabled axis and `moveall` with all motors disabled print `!! ... DISABLED — send 'enable' or run 'home' first` (previously silent).

## 🆕 What's new in v1.0.28

- Version housekeeping release (the v1.0.15 code shipped under the 1.0.28 number by mistake).

## 🆕 What's new in v1.0.15

- **Smart port-error triage** — the card tells BUSY apart from PERMISSION-DENIED: busy → close the Arduino IDE / Serial Monitor (or a second copy of the app), `sudo fuser -v /dev/ttyUSB0`, stop ModemManager; permission → `dialout` + logout/login. Raw OS error always shown.

## 🆕 What's new in v1.0.28

- **Direct OS serial driver** — card connects now go through `node-serialport` in the Electron main process, completely bypassing Chromium's Web Serial stack. This is the definitive fix for "port visible in Arduino IDE but the app says cancelled": no chooser, no udev scan, no permissions bridge — the main process opens `/dev/ttyUSB0` exactly like the Arduino IDE does.
- The card's device list now comes from the driver itself (with chip names like *QinHeng CH340*), and works even on builds where Web Serial is unavailable.
- Friendly connection label "System driver @ 115200" so you can tell which transport is live.

## 🆕 What's new in v1.0.28

- **OS-level port enumeration** — Scan Ports now lists devices straight from the operating system (`/dev/ttyUSB*`, `/dev/ttyACM*`, `COMx`), so it always matches what the OS and the Arduino IDE see. Fixes the case where Chromium's internal scan returned nothing even though the board was plugged in.
- **Silent auto-pick** — clicking a system port resolves the permission chooser automatically (no modal); a 10 s watchdog reports if the chooser ever fails to respond.
- A small `diag:` line in the card shows Electron version, webSerial status and how many devices the OS scan found — perfect for remote debugging.

## 🆕 What's new in v1.0.28

- **BEST MATCH badge** on the recommended port row (Arduino Mega / CH340 / CP210x / FTDI) in both apps
- 12-second scan watchdog: if the system port list never arrives, the fix-it checklist appears automatically

## 🆕 What's new in v1.0.28

- **Port diagnostics** — the Connection card now names common boards/chips (Arduino Mega 2560, CH340, CP210x, FTDI…) instead of raw USB IDs, shows a fix-it checklist when no device is found (data cable, dialout group, brltty hijack), and turns "Permission denied" into the exact command to run.

## 🆕 What's new in v1.0.28

- **Port-select card added to the Persian web panel too** (`gui/`) — scan/select/auto-connect works in the browser panel exactly like the desktop app.
- **Version badge** in the footer of both apps, so you can always confirm which build is running.

## 🆕 What's new in v1.0.28 (firmware audit + GUI fixes)

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

## 🆕 What's new in v1.0.28

- **Connection card (PORT SELECT)** — a dedicated sidebar section: scans every serial device on the machine, one-click connect per port, live link badge (name + baud), Disconnect button, optional **auto-connect on start** (remembers your last port), and a "New device detected" nudge when you plug the Arduino in later.

## 🆕 What's new in v1.0.8

- **Telemetry panel removed** (by request) — the sidebar now hosts Link Status and the Event Feed; joint positions live on the Motion-tab axis cards, FK readouts in the Kinematics box.
- Repo restructured: firmware moved to `firmware/RobotArm_Firmware/`, full Persian install/uninstall guide (Ubuntu + Windows) in the root `README.md`.

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
| `AXIS5-Robot-Control-Setup-1.0.28.exe` | Windows 10/11 x64 | Run the installer (desktop + start-menu shortcuts) |
| `AXIS5-Robot-Control-Portable-1.0.28.exe` | Windows 10/11 x64 | Single file — just run it, no installation |
| `AXIS5-Robot-Control-1.0.28-amd64.deb` | Ubuntu / Debian | `sudo apt install ./AXIS5-Robot-Control-1.0.28-amd64.deb` |
| `AXIS5-Robot-Control-1.0.28-x86_64.AppImage` | Any Linux x64 | `chmod +x *.AppImage` then run |

Every push to the app also rebuilds the installers (see `.github/workflows/build.yml`).

## 📦 Build installers yourself (optional)

| OS | Command | Output |
|---|---|---|
| Windows | `npm run dist:win` | `dist/AXIS5-Robot-Control-Setup-1.0.28.exe` (installer) + `AXIS5-Robot-Control-Portable-1.0.28.exe` (portable) |
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
