# Splash Tilt Research

Date: 2026-05-27

## What Was Found

Hydra can support side-leaning splash physics through three browser/Electron sensor paths:

1. `deviceorientation`, using `gamma` as left/right tilt.
2. `devicemotion`, using `accelerationIncludingGravity.x`.
3. Chromium Generic Sensor API, using `GravitySensor` or `Accelerometer` when available.

The exact MacBook screen hinge angle is a different signal. It is exposed through an Apple HID lid-angle sensor on supported modern MacBooks, but it is not a standard Electron or web API. Adding that would require a native macOS HID bridge, hardware/model compatibility checks, and graceful fallback when the sensor is missing or permission-blocked.

## How

Local probes:

```bash
ioreg -r -c AppleSMCMotionSensor
system_profiler SPMotionSensorDataType
```

Both returned no sensor data on this Mac, so current packaged verification can only prove fallback tilt cleanup locally.

Code paths now used by the splash:

- `electron/app/windows.js` listens for `deviceorientation` and `devicemotion`.
- `electron/app/windows.js` also attempts `new (window.GravitySensor || window.Accelerometer)({ frequency: 15 })`.
- Splash diagnostics record `tilt.source`, `tilt.sensorApi`, `tilt.gravityX`, and `tilt.error`.
- Splash disposal removes event listeners and stops any Generic Sensor instance.

## Why It Matters

The animation should feel more physical when real motion data exists, but it must not add runaway work or a new fragile native dependency to app startup. The current implementation keeps the effect opportunistic: real sensor data wins, and unsupported machines fall back to a tiny randomized side lean.

## Raw Evidence

- MDN describes `deviceorientation` / `devicemotion` as orientation and motion sensor APIs and notes that desktop environments can have hardware limitations: https://developer.mozilla.org/en-US/docs/Web/API/Device_orientation_events
- Chromium's Generic Sensor platform notes list macOS accelerometer support through `SMCMotionSensor`: https://chromium.googlesource.com/chromium/src/+/eb6a38f/services/device/generic_sensor/
- Public reverse-engineering projects document MacBook lid angle through Apple HID device `VID=0x05AC`, `PID=0x8104`, usage page `0x0020`, usage `0x008A`: https://github.com/tcsenpai/pybooklid and https://github.com/iannuttall/fartscroll-lid
- Local `ioreg` and `system_profiler` probes returned no motion-sensor data on this Mac.

## Reproducibility

Run the local probes above. Then run:

```bash
node --check electron/app/windows.js
npm run test:ui-static
npm run test:electron-main-process
```

On a supported sensor-equipped Mac, launch the packaged app and inspect `~/Library/Logs/Hydra/main.log` for `[hydra-splash] diagnostics`. A real sensor path should report `tilt.supported: true` with `tilt.source` set to `deviceorientation`, `devicemotion`, `GravitySensor`, or `Accelerometer`.
