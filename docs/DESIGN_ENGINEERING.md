# Hydra Design Engineering

Hydra is an operator tool. Its interface stays dense, legible, and predictable
while using motion to clarify state transitions rather than decorate every
surface.

## Splash Portal

The packaged splash uses Matter.js bodies and one owned canvas render loop.
Words fall as bodies on an irregular recursive timeout cadence, shatter into
individually simulated glyphs, then spend the final `5.2s` tightening into an
accelerating center orbit. The shower enters that portal phase at `9.8s`, using
faster Pica-style intro gravity so the full launch can read as a tighter `15s`
sequence. The welcome rectangle stays hidden during the shower and enters
shortly after the portal starts, giving the transition a stable visual anchor
without interrupting the letter rain.

The canvas adds a radial glow, rotating elliptical rings, orbiting motes, and
glyph-level pulse depth during the portal phase. These layers share the
existing 30 fps canvas paint cap and deterministic Matter teardown. Three.js
was deliberately not added: a second renderer and animation loop would cost
more lifecycle complexity without improving this bounded 2D scene.

Word scale is sampled once before body creation in the range `0.903..1.995`.
Shattered glyphs inherit the resulting font size, preserving readable variety
inside the bounded `72`-word physics budget. Shower spawn lanes and lateral
velocities also vary so the rain does not resolve into an even metronomic
curtain.

The portal's first frames apply a stronger inward lift before the tangential
spin dominates, pulling the floor pile into the ring instead of leaving most
glyphs behind. Only every fifth glyph receives canvas shadow blur during the
portal; the radial glow and ring layers preserve depth while avoiding the
largest repeated paint cost.

Portal entry also changes the Matter cadence from `45 Hz` to the existing
`30 Hz` canvas cadence. Collision response is already disabled at that point,
so the denser step rate no longer adds useful detail. Orbit steering now runs
only when a canvas frame will actually paint and reuses the same body snapshot
for steering, diagnostics, and glyph drawing.

The falling phase keeps Matter collision response so words still shatter into
individual letters and visibly pile up. The viewport has a floor and side
walls, but no ceiling: words spawn just above the visible top edge and must not
overlap a collider before gravity starts. At portal entry, each dynamic glyph
switches to a zero collision mask and sensor behavior. Matter still integrates
the individual orbiting bodies, but it no longer resolves the dense pile's
collision pairs during the spin.

Every shower entry is unique within one launch. The source corpus currently
contains `85` distinct labels, and the bounded queue selects `72` without a
refill path. The UI contract rejects duplicate corpus labels. `shatter()` marks
its parent body before adding glyphs, because one parent can appear in several pairs
inside a single Matter collision batch. Without that one-shot guard, the same
label can clone its letters and colors repeatedly before the removed body
leaves the event list.

The welcome overlay uses one faceted glass aperture instead of a square card or
a dial-pad grid. Its clipped outer shell and tapered translucent side wings
leave the portal legible at the edges. A darker inset center protects the
greeting and startup state without drawing a literal symbol over the animation.
The implementation uses one element plus two pseudo-elements, so the visual
refinement does not add a DOM or compositor-heavy grid during splash work.

The background branches use irregular short line segments rather than smooth
Bezier splines. Each recursively forked branch keeps a broad bend plus bounded
local jitter, which reads more like neurons or winter twigs than perfect
curves. Glow is applied once at the SVG surface instead of once per primary
stem.

## Ambient Planet

The Jupiter-like sidebar planet is intentionally decorative, but it still has to
feel alive. The current accepted treatment is CSS-only and indefinite: each
small moon runs an indefinite `moonOrbitLinear` transform around a larger
outside radius, while the guide ring stays decorative and static. The orbit
uses coarse uniform `steps(...)` cadence rather than full-rate linear
interpolation; the moons keep moving at a predictable speed, but the browser
does not have to repaint the decorative planet at 60fps forever. Paint containment is
intentionally not used on the orbit ring because it clips moons at the track
edge. There is no
React timeout, interval, RAF, or CSS-variable phase writer for the moons. The
paths are deliberately larger than the planet body so the moons read as
orbiting around the planet instead of twitching inside it.

The meteor layer uses the earlier shooting-star geometry. Each meteor is a thin
vertical tail, but the keyframe applies `rotate(...) translateY(...)` in that
order, so the travel happens through the rotated local axis and crosses the
screen diagonally. Avoid changing it to `translate3d(...) rotate(...)`; that
makes the movement fall mostly straight down. Startup can run continuous
ambient meteors, but the settled shell keeps the diagonal shower alive with a
visibility-aware `App.settledMeteorLoop`. That loop fires one short
`meteorBurstFall` window, then idles for a few seconds before the next strike. This keeps
the shower recurring indefinitely without six permanent compositor layers. The
old `App.meteorPulse` scheduler must stay absent. Star twinkle is opacity-only;
the star layer itself no longer shifts.

There is a small hidden space-mode Easter egg, but it shares the same rendering
budget. Five clicks on the lower-right planet, or five clicks on the Hydra
sidebar logo, arms Easter egg mode. Once armed, pressing `P` triggers a short
meteor volley using alternating `meteorVolleyA` / `meteorVolleyB` keyframes so
repeated presses restart cleanly. The key handler ignores text inputs,
textareas, selects, contenteditable regions, and modifier chords.

## Proximity Fields

Dashboard account cards and list rows, command actions, empty-state actions,
primary sidebar navigation, sidebar footer controls, and Settings action
clusters use proximity response, not only binary hover. A reusable
`useProximityField()` hook measures the cursor's Euclidean distance from each
tagged target and writes restrained CSS variables for scale, lift, horizontal
shift, and brightness.

The implementation batches pointer work through one tracked animation frame
per field, snapshots target geometry once per pointer pass, changes only
composited transforms and filters, resets cleanly on leave or unmount, and
disables the effect under `prefers-reduced-motion`. Cached geometry invalidates
when the field resizes, its child structure changes, or the viewport resizes.
That avoids repeated `getBoundingClientRect()` layout reads after transforms
have changed while still handling conditionally mounted account grids.
Account cards use a slightly larger field and vertical lift. Sidebar targets
use a smaller field and horizontal nudge. Compact adjacent buttons receive a
subtle scale/lift response while their stable dimensions prevent layout shift.
Form inputs and dense Vault table rows remain stationary so precision is not
compromised.

The account grid also applies a bounded directional attraction channel. Cards
near the pointer move by at most `10px` horizontally and `8px` vertically
toward it while the pink highlight brightens. Neighboring cards therefore
cluster subtly around the active region without changing CSS grid geometry,
causing reflow, or affecting precision controls elsewhere.

Settings top-row cards use equal grid rows, flex-column interiors, aligned
footers, and one consistent action-button minimum size. System location actions
are grouped together instead of appearing as uneven inline controls.

### Proximity implementation map

- `src/hooks/useProximityField.js` owns the reusable field. Each mounted field
  receives one pointer handler, one tracked RAF slot, one cached geometry
  snapshot, resize and child-list invalidation, and one cleanup path.
- `src/App.jsx` applies the tight sidebar profile: `105px` radius, `3.5%`
  maximum scale, and `3px` horizontal shift. It affects primary navigation and
  footer controls without moving the sidebar track itself.
- `src/pages/Dashboard.jsx` applies the broader account profile: `250px`
  radius, `4%` maximum scale, `5px` lift, `10px` horizontal attraction, `8px`
  vertical attraction, and `14%` brightness headroom. The same page applies a
  smaller lift/scale profile to adjacent command buttons and empty-state
  actions.
- `src/pages/Settings.jsx` applies restrained button-group fields so the
  normalized Settings controls feel related without making form input
  placement unstable.
- `src/index.css` consumes the hook's custom properties through compositor
  transforms and filters. Account attraction is intentionally scoped to
  `.dashboard-mini-grid .account-card[data-proximity-target]` and
  `.dashboard-account-list__row[data-proximity-target]`; the directional
  channel must not leak into precision controls or cause grid reflow.

The visual rule is proximity before hover: neighboring controls should begin
responding as the pointer approaches, then let the existing hover border and
pink highlight provide the final active-state emphasis. The engineering rule
is stable geometry: never animate layout dimensions, grid tracks, or form
control placement for this effect.

## Command Viewport And Content Density

Command keeps its account fleet inside one bounded viewport. Grid and List use
`max-height: clamp(320px, calc(100vh - 230px), 720px)` with internal scrolling,
so the page header and command rail remain stable as the vault grows. Map stays
contained in the same work area. List is a true aligned operator table with
account, balance, control, API, session, and usage columns; it is not a
one-column stack of grid cards. Remaining balances deliberately use
`formatRemainingCurrency()` so fractional values like `19.999...` do not round
up to `$20.00` and overstate available credits. Map mode also shows the
per-account balance on each node instead of hiding it behind API count only.
List, Grid, and Map all route through `getAccountBalanceDisplay()`, which
separates live OpenRouter credits, recent in-memory snapshots, stored fallback
credits, and unavailable/no-control states. If a live credit lookup fails, the
UI may show a clearly marked stored balance; it must not invent or share a
default `$20.00` value across accounts.

Compact density is scoped under `.app-shell--density-compact .main-content`.
It tightens route padding, headers, metric cards, forms, tables, command
panels, Settings sections, generator steps, and redeemer controls. It
deliberately does not target `.sidebar`: the navigation rail retains its
stable dimensions, readable collapsed-icon tooltips, and pronounced proximity
response in both density modes.

## Anime.js Text Treatments

`src/components/AnimeText.jsx` is the shared bounded text-motion primitive for
page headers. It uses Anime.js `splitText()` to animate characters, words, or
lines for short `signal` and `scanline` entrances. It is deliberately not a
general-purpose ambient-animation layer.

Each effect registers with renderer runtime diagnostics through
`trackRendererAnimation()`, cancels its Anime.js instances during React effect
cleanup, and calls `splitter.revert()` so route changes do not leave wrapper
spans or animation handles behind. Reduced-motion preference bypasses the
effect. The lifecycle contract is covered by the UI static suite and packaged
route diagnostics: transient mount effects may appear briefly, but a settled
or unmounted view must return to zero active Anime.js effects.

Use Anime.js for short text entrances where split typography materially helps
hierarchy. Keep persistent motion in CSS only when it communicates a genuinely
transient state, and cap its iterations. Do not attach Anime.js to the splash:
the splash already has one finite Matter.js/canvas owner and should not gain a
second timing system.

The splash uses that same constraint for its portal light wave. Falling glyphs
are approximately `5%` larger and the randomized shower cadence is slightly
tighter so the pile forms during the first `9.8s`; portal entry then owns the
remaining `5.2s` of the tightened `15s` splash. The existing canvas paint loop
computes one traveling sinusoidal highlight across independent glyph bodies
after collisions are disabled. No Anime.js instance, extra RAF, interval, or
additional physics body is introduced for the wave.

## Graphics Maintenance Checklist

When changing motion, preserve these invariants:

- Splash words remain unique within the bounded `72`-entry queue.
- `shatter()` mutates its parent to `kind="shattered"` before adding glyphs.
- Falling words keep collision response; portal glyphs disable collisions but
  remain independent Matter bodies.
- Portal steering runs at the painted `30 Hz` cadence and reuses one body
  snapshot per frame.
- Splash disposal clears tracked timers, RAF, sensor listeners, Matter world,
  and engine state, then reports diagnostics.
- Proximity fields schedule at most one RAF per field and reset variables on
  pointer leave and unmount.
- Anime.js text effects unregister, cancel, and revert split wrappers on
  unmount.
- `prefers-reduced-motion` removes proximity transforms and bypasses decorative
  text entrances.

## Session Truth Copy

Session surfaces use four distinct labels:

- `Live Clerk check`: current login truth.
- `Interactive sign-in`: historical operator action.
- `Last silent renewal`: historical Hydra maintenance.
- `Next local renewal checkpoint`: local scheduling estimate.

The checkpoint is never described as total session lifetime. Forced probes
persist and reload renewal metadata before rendering the result.

## Steady Status Indicators

Success, error, and warning dots use static color-matched glows. They remain
legible at a glance without perpetual compositor animation. Only a genuinely
transient loading dot pulses, and that motion is capped at three `1.2s`
cycles.

This is an empirical design constraint, not only a preference: packaged
Settings dogfood found that two six-pixel success dots running an infinite
`box-shadow` pulse kept the visible renderer and GPU hot. The static treatment
preserves the same hierarchy while allowing the settled app to return to idle.

## Product Signature

Release metadata, About, and Build Info identify `Frostbyte Technology` and
`Developed by Zayd / Cold`. The renderer shell and packaged splash also carry
the subtle non-visible `data-studio="frostbyte-zayd-cold"` signature. Windows
executable, installer, and uninstaller artwork use the shared multi-resolution
ICO asset. The Dock, taskbar, sidebar, and renderer chrome use the restored
detailed three-headed Hydra raster. The simplified H micro-mark remains
separate for tiny favicon and menu-bar surfaces where the detailed raster would
collapse into visual noise.

## 1.3.0 Desktop Refinement

The portal now starts with a bounded upward release after collision masks are
cleared. Each letter body receives a small negative-y kick, then orbit steering
adds a decaying `releaseLift` term while the clockwise velocity accelerates.
The letters remain independent Matter bodies, but the dense collision solver
stays off during the spin. This preserves visible motion without returning to
the laggy pile-against-pile workload.

The organic background now starts from nine primary stems rather than five.
The existing recursive depth and segmented-path budget remain bounded, so the
opening reads as a fuller neuron-like branch field without adding an
unbounded canvas or SVG loop.

Renderer startup assets are now same-origin and offline-capable. The blocked
Google Fonts stylesheet request was removed, and the CSP-rejected inline data
favicon was replaced with `/hydra_dragon.png`. The local font fallback stack
already preserves the intended compact operator-console typography.

Current primary-source guidance reviewed for this pass:

- Electron security and sandbox guidance:
  <https://www.electronjs.org/docs/latest/tutorial/security> and
  <https://www.electronjs.org/docs/latest/tutorial/sandbox>
- Anime.js React cleanup guidance:
  <https://animejs.com/documentation/getting-started/using-with-react>
- Three.js resource cleanup guidance:
  <https://threejs.org/manual/en/how-to-dispose-of-objects.html>
- electron-builder CLI and GitHub Actions packaging guidance:
  <https://www.electron.build/cli> and
  <https://www.electron.build/tutorials/github-actions>

Three.js was evaluated and intentionally not added to the splash. The current
effect is a finite 2D typographic physics scene. A WebGL renderer would add a
second owned animation lifecycle plus explicit geometry, material, texture,
and renderer disposal obligations without improving the requested letter
orbit. Anime.js remains reserved for bounded renderer text micro-interactions;
each `AnimeText` split effect has explicit cleanup and reduced-motion handling.

The source launcher is desktop-first: `npm start` no longer opens a browser.
Intentional web-mode development must opt in with `npm start -- --browser`.
The packaged Electron app remains the acceptance surface.

## README Media Stack

The repository overview intentionally stacks two centered animated assets:

- `videos/hydra_showreel.gif` is the restored Apple-style product reel. It
  communicates the broader native control-plane experience across Vault,
  Command, routing, and terminal surfaces.
- `videos/hydra_splash.gif` is the current packaged-launch capture. It documents
  the falling individualized glyphs, bounded portal treatment, and launch
  identity without replacing the broader product reel.

Keep both assets in that order. The showreel establishes product breadth; the
splash capture follows as a focused implementation detail. Do not replace the
pair with a browser capture or a localhost recording.

## Render-Budget Refinements

The command surfaces keep motion responsive by avoiding unrelated React work:

- `src/pages/Dashboard.jsx` memoizes its derived fleet view so modal state and
  other local changes do not rerun account filters, activity shaping, and
  health calculations.
- `src/components/AccountCard.jsx` uses an account-scoped memo comparator. A
  card observes only its own live-session value, action-session value,
  provisioning membership, and cooldown entries instead of rerendering when an
  aggregate object changes for another account.
- `src/hooks/usePools.js` exposes stable `useCallback()` handlers, while
  `src/pages/PoolManager.jsx` passes stable row callbacks into memoized
  `AccountRow` and `KeyRow` components.

These optimizations protect the proximity field: nearby cards can react to the
pointer without competing with avoidable list reconciliation during background
refreshes or one-account actions.
