# Hydra Design Engineering

Hydra is an operator tool. Its interface stays dense, legible, and predictable
while using motion to clarify state transitions rather than decorate every
surface.

## Splash Portal

The packaged splash uses Matter.js bodies and one owned canvas render loop.
Words fall as bodies on an irregular recursive timeout cadence, shatter into
individually simulated glyphs, then spend the final three seconds tightening
into an accelerating center orbit. The welcome rectangle stays hidden during
the shower and enters shortly after the portal starts, giving the transition a
stable visual anchor without interrupting the letter rain.

The canvas adds a radial glow, rotating elliptical rings, orbiting motes, and
glyph-level pulse depth during the portal phase. These layers share the
existing 30 fps canvas paint cap and deterministic Matter teardown. Three.js
was deliberately not added: a second renderer and animation loop would cost
more lifecycle complexity without improving this bounded 2D scene.

Word scale is sampled once before body creation in the range `0.86..1.90`.
Shattered glyphs inherit the resulting font size, preserving readable variety
inside the bounded `72`-word physics budget. Shower spawn lanes and lateral
velocities also vary so the rain does not resolve into an even metronomic
curtain.

The portal's first frames apply a stronger inward lift before the tangential
spin dominates, pulling the floor pile into the ring instead of leaving most
glyphs behind. Only every fifth glyph receives canvas shadow blur during the
portal; the radial glow and ring layers preserve depth while avoiding the
largest repeated paint cost.

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

The welcome overlay uses a nine-cell dial-pad grid. The north, west, center,
east, and south cells form a denser glass cross behind the product state. The
four corners stay translucent so the portal remains legible around the launch
rectangle. The center cell carries the strongest material and glow, keeping the
greeting readable without flattening the animation into an opaque modal.

## Proximity Fields

Dashboard account cards and primary sidebar navigation use proximity response,
not only binary hover. A reusable `useProximityField()` hook measures the
cursor's Euclidean distance from each tagged target and writes restrained CSS
variables for scale, lift, horizontal shift, and brightness.

The implementation batches pointer work through one tracked animation frame
per field, changes only composited transforms and filters, resets cleanly on
leave or unmount, and disables the effect under `prefers-reduced-motion`.
Account cards use a slightly larger field and vertical lift. Sidebar targets
use a smaller field and horizontal nudge. Form inputs, destructive actions,
and dense Vault table rows remain stationary so precision is not compromised.

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
executable, installer, and uninstaller artwork continue to use the shared ICO
asset.
