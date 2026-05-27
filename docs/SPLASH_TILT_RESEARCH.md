# Splash Tilt Research

Date: 2026-05-27

## What Was Found

Hydra can support side-leaning splash physics through three browser/Electron sensor paths:

1. `deviceorientation`, using `gamma` as left/right tilt.
2. `devicemotion`, using `accelerationIncludingGravity.x`.
3. Chromium Generic Sensor API, using `GravitySensor` or `Accelerometer` when available.

The exact MacBook screen hinge angle is a different signal. It is exposed through an Apple HID lid-angle sensor on supported modern MacBooks, but it is not a standard Electron or web API. Adding that would require a native macOS HID bridge, hardware/model compatibility checks, and graceful fallback when the sensor is missing or permission-blocked.

## Current Splash Version Behavior

The current source splash is intentionally denser and longer than the first
Matter.js pass:

- `SPLASH_MIN_VISIBLE_MS = 12000` in `electron/main.js`.
- `HYDRA_SPLASH_DURATION_MS=12000` in `electron/app/windows.js`.
- `HYDRA_SPLASH_EXIT_MS=10000`, so the pile gets about 10 seconds to fall and
  pack before the upward exit flip.
- `HYDRA_SPLASH_TARGET=92`, which is 15% more falling words than the prior
  80-word runtime.
- `HYDRA_SPLASH_DISPOSE_MS=14500`, so the splash has a bounded cleanup window
  after the main transition and cannot leave Matter/RAF/timer work alive.

This is why the next release notes should treat the splash change as part of
the minor `1.1.0` performance/UX tranche, not as a tiny patch note.

## How The Lean Works

Hydra does not wait until letters are already stacked before applying tilt.
The current implementation applies the left/right value in three places:

1. `engine.world.gravity.x`: the Matter.js world gets horizontal gravity during
   physics stepping.
2. Spawn position: new words get a tilt-dependent `W() * 0.18` x-bias, clamped
   inside the viewport walls.
3. Initial velocity: new words get a tilt-dependent horizontal velocity kick.

The raw sensor/fallback value is stored in `hydraSplashTiltGravityX`. The render
loop eases a second value, `hydraSplashLeanX`, toward it each frame:

```js
hydraSplashLeanX += (hydraSplashTiltGravityX - hydraSplashLeanX) * 0.08;
engine.world.gravity.x = hydraSplashLeanX;
```

That smoothing avoids jitter if an OS/browser sensor reports noisy readings.
The fallback path picks a tiny random side lean (`+/-0.035`) so unsupported
machines still get a subtle organic pile instead of a mathematically centered
drop. Real sensors are clamped to `+/-0.65` before use.

Current constants and their intent:

| Value | Current setting | Why |
| --- | --- | --- |
| Visible splash | `12000ms` | Gives the richer falling-word sequence two extra seconds without letting graphics run forever. |
| Exit flip | `10000ms` | Lets the pile settle for most of the splash, then reverses gravity for the upward whoosh. |
| Word target | `92` | 15% denser than the earlier `80`-word Matter.js pass. |
| Sensor clamp | `+/-0.65` | Prevents a noisy sensor or extreme reading from pinning every word into a wall. |
| Fallback lean | `+/-0.035` | Adds a visible but subtle side bias when no real sensor is exposed. |
| Spawn x bias | `tilt * W() * 0.18` | Makes new words enter closer to the lower side instead of only drifting after spawn. |
| Lean smoothing | `0.08` per frame | Reduces jitter from noisy motion/orientation readings. |

The important distinction is "body/device tilt" versus "screen hinge angle."
`deviceorientation`, `devicemotion`, `GravitySensor`, and `Accelerometer` can
only report what Chromium exposes to the renderer. That may correspond to
machine body motion on some laptops/tablets, but it is not guaranteed to expose
the physical MacBook lid angle. True hinge-angle support would need a separate
native macOS bridge that reads Apple's HID lid-angle sensor when present, plus
fallback behavior for machines that do not have or expose that sensor.

The visual result should be:

- on machines with supported sensor data, the pile packs toward the lower side;
- on machines without sensor data, the pile has a mild one-sided bias;
- after the splash exits, all sensor listeners and optional Generic Sensor
  instances are stopped by `disposeHydraSplash()`.

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
- Real or fallback tilt now changes three things: horizontal gravity, the
  initial falling-word x position, and the initial horizontal word velocity.
  That makes the contents visibly lean and pack toward one side instead of
  only drifting slightly after they have already spawned.
- Splash disposal removes event listeners and stops any Generic Sensor instance.

## Why It Matters

The animation should feel more physical when real motion data exists, but it must not add runaway work or a new fragile native dependency to app startup. The current implementation keeps the effect opportunistic: real sensor data wins, and unsupported machines fall back to a tiny randomized side lean.

Performance boundaries are part of the feature, not a separate cleanup:

- one Hydra-owned RAF loop steps Matter.js and throttles drawing;
- Generic Sensor polling is requested at `15 Hz`, not unbounded;
- `disposeHydraSplash()` removes orientation/motion listeners;
- `disposeHydraSplash()` stops the optional Generic Sensor instance;
- Matter bodies/engine state are cleared when the splash exits;
- diagnostics are logged so future packaged runs can prove the splash did not
  leave graphics or sensor work alive after the main window takes over.

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
