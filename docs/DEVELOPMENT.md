# 🛠️ Development Workflow

Developing Hydra requires understanding the interplay between the React frontend (Vite) and the Node.js backend (Express + Prisma).

## 🚩 Quick Start (Dev Mode)

1. **Install Dependencies**

   ```bash
   npm install
   ```

2. **Initialize Environment**

   ```bash
   cp .env.example .env
   ```
   *Edit `.env` to set your local PORT and JWT_SECRET.*

3. **Initialize Database**

   ```bash
   npx prisma db push
   ```
   *This syncs your `prisma/schema.prisma` with the local SQLite `dev.db` file.*

4. **Launch Application**

   Run **`npm`** commands from the **repository root** (the directory that contains `package.json`). If you run them from your home directory, npm will error with **ENOENT** / missing `package.json`.

   ```bash
   npm run dev
   ```
   *This uses `concurrently` to run both the Vite dev server and the Express backend simultaneously.*

   Optional Clerk OTP / session tracing (no cookie values logged):

   ```bash
   CLERK_DEBUG_OTP=1 npm run dev
   ```

   Or add **`CLERK_DEBUG_OTP=1`** to **`.env`** and run **`npm run dev`** as usual—restart the API after changing env. With debug on, the server logs lines prefixed **`[CLERK_DEBUG_OTP]`**, and Clerk-related account errors may include **`clerkDebugHint`** in the JSON (surfaced in the OTP/login UI).

   See **`.env.example`** for **`CLERK_DEBUG_OTP`**, **`CLERK_ORIGIN`**, and **`CLERK_REFERER`**. Clerk resolution details: **`docs/ARCHITECTURE_DEEP_DIVE.md`**.

### Development URLs

- `http://localhost:5173` — Vite client development server.
- `http://localhost:3001` — Express API server.

### Why the UI cannot start the server from a button

A normal browser tab **cannot** launch `node server/index.js` on your machine (sandbox security). There is no embedded JSON/JS workaround for that in a standard Vite + Express setup.

- **Development:** Run **`npm run dev`** so **both** Express (`http://localhost:3001`) and Vite (`http://localhost:5173`) start. If you only open the Vite URL while Express is down, the UI will show API errors until the backend is up.
- **Production-style:** **`npm start`** runs [`launch.js`](../launch.js) and serves the built app and API on one port (default `3001`).
- **CLI shortcut:** From the repo root, **`npm link`** once, then run **`hydra`** (production-style) or **`hydra dev`** from anywhere — see [`bin/hydra.mjs`](../bin/hydra.mjs).

Deeper comparison of options (Electron, Docker, etc.) lives in [**HYDRA_LAUNCH_RESEARCH.md**](HYDRA_LAUNCH_RESEARCH.md).

### Electron Desktop Mode

Hydra also runs as a native desktop app via Electron:

- **`npm run dev:electron`** — Development mode: runs Vite HMR alongside `electron .`. The Electron window loads `http://localhost:5173` with full HMR support. Best for testing Electron-specific APIs (IPC, native menus, window behavior).
- **`npx electron .`** — Production/preview mode: runs the Electron app serving the built `dist/` files. Requires `npm run build` first. Use this to verify the exact artifact users will install.
- **`npm run electron:build`** — Packages the app into platform installers (`.dmg` on macOS, `.exe` on Windows, `.AppImage` on Linux).

The `npm run dev` (browser) path is preserved and remains the primary workflow for daily frontend/backend iteration. See [**ELECTRON_MIGRATION_STATUS.md**](ELECTRON_MIGRATION_STATUS.md) for full details.

**Related docs:** How the SPA handles a down backend (no new routes) — [**ARCHITECTURE_DEEP_DIVE.md**](ARCHITECTURE_DEEP_DIVE.md) (*Development: backend-down UX*); `src/api.js` error shape — [**API_REFERENCE.md**](API_REFERENCE.md) (*Frontend API client*); Express route list unchanged — [**SERVER_ARCHITECTURE.md**](SERVER_ARCHITECTURE.md) (*Development vs production*).

### Restart Guidance

The client and backend are started together by `npm run dev`, so there is no separate restart command in the default workflow.

- For changes in `src/`, Vite usually hot-reloads the browser automatically.
- For changes in `server/`, stop `npm run dev` and start it again so the Express process picks up the new code.
- If the UI reports `SERVER OFFLINE`, the backend process is the part that needs to be restarted.

---

## 🗄️ Database Lifecycle

Hydra uses **Prisma** as its ORM (Object-Relational Mapper) with **SQLite** for zero-config local storage.

### Making Schema Changes

1. Modify `prisma/schema.prisma`.
2. Run `npx prisma db push` to apply changes to your local database.
3. Run `npx prisma generate` to refresh the Prisma Client types in your `node_modules`.

### Viewing Data

Use **Prisma Studio** for a GUI to inspect and edit your local data:

```bash
npx prisma studio
```

---

## 🏗️ Build & Deployment

### Production Build

To generate the optimized production bundle:

```bash
npm run build
```

This will compile the React application into the `dist/` directory, which is served statically by the Express server in production mode.

### Production Environment

The `launch.js` script handles production bootups:

```bash
npm start
```

This script performs a pre-flight check, ensures the database is migrated, and starts the unified Express server (serving both the API and the static `dist/` files).

### Testing / smoke

- **`npm run test:session-expiry`** — Node’s built-in test runner; locks in **`sessionExpiry || getJwtExpiry(__session)`** when the vault has a Clerk JWT but **`sessionExpiry`** was never stored (the npm script sets **`DATABASE_URL=file:./prisma/dev.db`** so **`server/config.js`** loads).
- **`npm run test:ensure-session-backfill`** — Module-mocked **`ensureSession`** path: valid **`__session`** JWT + **`sessionExpiry: null`** backfills the vault without calling Clerk refresh / credits validate (requires **`--experimental-test-module-mocks`**; same **`DATABASE_URL`** as above).

**Manual — Clerk session after OTP (no false “session expired”):**

1. OTP sign-in for an account that reproduces the issue (e.g. no management key, or the failing shape you saw).
2. Confirm the vault row gets a non-null **`sessionExpiry`** after the first successful flow or the first **`ensureSession`**-backed action.
3. Hard refresh / navigate; run a session-backed action (dashboard load, provision, redeem, etc.).
4. Optional: set **`sessionExpiry`** to **`null`** in the DB while keeping **`sessionToken`** / **`__session`** — the next **`ensureSession`** should backfill expiry and succeed.

---

## 📜 Coding Patterns

- **Zod Validation** — Always use Zod schemas in `server/validators/` for incoming request payloads.
- **Controller-Service Split** — Routes in `server/routes/` should only handle HTTP concerns and delegate logic to `server/controllers/`, which in turn use `server/services/`.
- **Vanilla CSS** — Use global variables in `src/index.css` for styling. Refrain from TailwindCSS or other utility-first frameworks unless explicitly specified.
- **Standard JS** — Hydra uses ESM (EcmaScript Modules). All files should use `import`/`export` syntax.
- **UI Layering** — The space-themed background is composed in `src/App.jsx` and styled in `src/index.css`; the starfield, nebula glow, meteors, and EDM bar are separate layers that stack together into one scene.
- **Page headers (`src/index.css`)** — `.page-header` is a flex row meant for **title | actions**. Intro-only pages (title + paragraphs, no right-side buttons) must use **`page-header page-header--intro`**, wrap the title and copy in one child, and style lede text with **`.page-header__lede`** / **`.page-header__lede--note`**. Otherwise a bare `<p>` next to `<h2>` becomes a second flex column and wrecks the heading (see `BulkAuthWizard.jsx`).
- **`.info-banner` (`src/index.css`)** — Uses **`display: flex`**. A leading `<span>` plus *sibling* text nodes and inline tags (`<strong>`, `<a>`, etc.) each become separate flex items and produce broken, column-like text. **Fix:** wrap all body content after the label in one child (e.g. `<div style={{ flex: 1, minWidth: 0 }}>`), as in **`BulkAuthWizard.jsx`** stub summary—or avoid `.info-banner` for long prose (**Pool Manager** uses **`.pool-help-trigger`** / **`.pool-help-panel`** instead of a full-width banner).
