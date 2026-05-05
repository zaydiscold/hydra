# Hydra launch and packaging research

This document summarizes launch options for Hydra and explains why the browser
UI cannot start the local server by itself.

## Current launch model

Hydra has two supported local launch modes:

- `npm run dev` starts the Express API on `http://localhost:3001` and the Vite
  client on `http://localhost:5173`.
- `npm start` runs `launch.js`, verifies the environment, starts the Express
  server, and serves the built client from `dist/`.

After `npm link`, the global `hydra` command runs the production-style launch,
and `hydra dev` runs the development pair.

## Why the browser cannot start Hydra

A standard browser tab cannot spawn `node server/index.js` on the local machine.
That is a browser sandbox boundary, not a missing Hydra endpoint. In development,
if Vite is running while Express is down, frontend requests fail before they
receive an HTTP status. The UI handles this by showing a copyable command such
as `npm run dev`; it does not add a route that can launch the server.

## Packaging options

| Option | Fit | Notes |
| --- | --- | --- |
| Current CLI | Best current path | Keeps the local-first model simple and explicit. |
| Electron | Good future app shell | Main process can start Express and load the local UI. Needs Prisma and SQLite packaging work. |
| Docker | Useful for repeatable environments | Adds operational overhead and volume management for a local-first vault. |
| Native launcher scripts | Already supported | `Start Hydra.command` and `Start Hydra.bat` cover simple desktop launch flows. |

## Recommendation

Keep the current CLI and launcher scripts as the supported path. If Hydra needs
a one-click desktop app, prefer Electron because it can own the server process
lifecycle directly instead of asking a browser tab to escape its sandbox.
