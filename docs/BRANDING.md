# 🎨 Branding & Design Guide

Hydra follows a **Neo-Brutalist / Space-Age** aesthetic. This design system is optimized for high-intensity monitoring, professional "fleet" management, and a premium "hacker-cockpit" feel.

## 🏮 The Philosophy

- **High Contrast** — Deep blacks paired with high-intensity neon accents.
- **Sharp Edges** — 0px border radii (Brutalism) to emphasize precision and engineering.
- **Micro-Animations** — Subtle transitions (scrambling, pulsing, spring-loading) to make the interface feel alive.
- **Glassmorphism** — Layered depth using subtle background blurs and semi-transparent dark cards.

---

## 🎨 Color Palette

The core palette is defined as CSS tokens in `src/index.css`.

### Core Backgrounds

- `bg-primary`: `#0a0a0a` (Deep Space)
- `bg-secondary`: `#0f1012` (Onyx)
- `bg-card`: `rgba(18, 20, 24, 0.65)` (Translucent Cockpit)

### High-Intensity Accents

- `accent-primary`: `#ff00ff` (Neon Magenta) — Primary actions & identity.
- `accent-secondary`: `#00ffff` (Cyan) — Secondary interactions & focus states.
- `status-success`: `#00ff88` (Hyper Green) — Valid states & positive balances.
- `status-error`: `#ff2255` (Crimson Warning) — Failures & depleted accounts.

---

## 🔡 Typography

Hydra uses a dual-font system to balance readability with technical data density.

- **System Font: Inter** — Used for all primary interface navigation, labels, and headers. Optimized for clarity.
- **Technical Font: JetBrains Mono** — Used for data values, API keys, logs, and "scrambled" effects. Optimized for precision and developer familiarity.

---

## 🕹️ Interactive Elements

### Buttons & Inputs

- **Brutalist Style** — Heavy borders, 0px radius, and a 2px-4px offset shadow.
- **Interaction** — On hover or focus, buttons should "pop" with a primary accent glow or a slight scale adjustment.

### Scramble Text

The "Scramble" effect is our signature loading/transition state. It uses random character cycling to simulate high-speed data decryption before settling on the final string.

### Vault Indicator

A specialized UI component that shows the "Safe" status of the local environment. It consists of a pulsing green dot and high-contrast blocky text.

---

## 🌌 Space Layer System

The animated background is built from small independent layers in `src/App.jsx` and `src/index.css`. Each layer has a different job, and the combined effect is what gives Hydra its cockpit-like atmosphere.

- **`edm-bar`** — A thin top-edge gradient strip that moves continuously across the viewport. It acts like a subtle status light rather than a focal animation.
- **`starfield`** — The base background. It provides the deep-space field and the twinkling static stars that anchor the scene.
- **`nebula-glow`** — A soft blur layer that adds color haze and depth without moving too aggressively.
- **`meteor-container` / `meteor`** — The diagonal streaks that add motion and energy. Their travel path is intentionally longer than their visible length so they cross more of the screen before fading.
- **`planet` shapes** — Decorative foreground-or-background anchors that give the composition a sense of scale.

The important design rule is that these are not one effect; they are a stack of separate visual systems. The static field keeps the screen grounded, the glow adds atmosphere, the meteors add motion, and the top strip adds a tiny amount of active signal.

---

## 🛰️ Imagery & Icons

- **Icons** — Custom, thin-stroke SVG icons with subtle glows.
- **Logo** — The Hydra Dragon icon, encased in a breathing neon circle.
- **Backgrounds** — Use fixed backgrounds with subtle noise or grainy gradients to add texture to the "Space-Age" feel.
