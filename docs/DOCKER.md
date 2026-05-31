# Hydra Docker Runtime

Hydra includes Docker support for runtime smoke testing and future hosted-router checks. Docker is not used as proof that the packaged Electron app works; it is a separate runtime gate for the local API/router surface.

## Commands

```bash
npm run docker:build
npm run docker:smoke
npm run docker:smoke -- --start
```

The smoke path is intentionally bounded. Set `HYDRA_DOCKER_BUILD_TIMEOUT_MS` when CI or a slow local daemon needs more time:

```bash
HYDRA_DOCKER_BUILD_TIMEOUT_MS=300000 npm run docker:smoke
```

Use `--start` for release evidence. It builds the image, starts the container,
waits for Hydra's local health endpoint, and tears compose resources down.

## Playwright Runtime

Hydra's Docker image is a custom `node:22-bookworm` runtime, not the official
Playwright image. The Dockerfile must install Chromium and its Linux shared
libraries together:

```bash
npx playwright install --with-deps chromium
```

Downloading Chromium alone is insufficient. A direct `ldd` probe found missing
NSS, ATK, D-Bus, CUPS, X11, GBM, and audio libraries before this was fixed.
Keep the `--with-deps` flag covered by `server/tests/docker-smoke-script.test.mjs`.

## Build Context

Desktop Electron output and README media do not belong in the API/router image.
`.dockerignore` excludes `release/`, `build/`, `videos/`, and
`splash-previews/`. On 2026-05-31 this reduced the local uncached Docker context
transfer from `187.54 MB` to `361.39 kB` (`99.8%`).

## 2026-05-31 Reproduction

```bash
docker compose down --remove-orphans
npm run docker:smoke -- --start
docker compose ps --all
docker run --rm --entrypoint sh ghcr.io/zaydiscold/hydra:latest -lc \
  'CHROME=$(find /root/.cache/ms-playwright -path "*/chrome-linux/chrome" | head -n 1); ldd "$CHROME" | grep "not found" || true'
```

The hardened image returned HTTP `200`, left no compose resources after
teardown, reported no missing Chromium libraries, and launched a headless
Playwright Chromium instance successfully.

## Cleanup

If a smoke run is interrupted or leaves containers behind, clean up with:

```bash
docker compose down --remove-orphans
```

The smoke scripts should treat failed starts as diagnostic evidence, not as silent cleanup. Keep stderr/stdout from Docker commands when filing release-audit notes so failures are reproducible.

## Release Audit Boundary

`node bin/hydra.mjs audit --json` can verify that Docker scripts and documentation exist, but it does not start Docker. Mark Docker runtime as complete only after `npm run docker:smoke` runs against a reachable Docker daemon.
