# Docker Runtime

Hydra's primary product is the Electron desktop app. Docker is the server-style
runtime for always-on hosts and repeatable deployments.

## Local Build

```bash
npm run docker:config
```

Build and run:

```bash
docker compose build
docker compose up
```

or through npm:

```bash
npm run docker:build
npm run docker:up
```

Open `http://127.0.0.1:3001` after the container starts. The compose file bind
mounts `./data` into `/app/data`, so the SQLite database, local encryption
secrets, proxy state, and redemption logs stay outside the image.

## Published Image

The GitHub Actions Docker workflow publishes a multi-arch image for:

- `linux/amd64` — Intel/AMD hosts
- `linux/arm64` — Apple Silicon and ARM Linux hosts

Pull and run:

```bash
docker pull ghcr.io/zaydiscold/hydra:latest
docker compose up -d
```

`npm run docker:smoke` validates compose config, checks that the Docker daemon is
reachable, and builds the image through `scripts/docker-smoke.mjs`. Each step
has an explicit timeout so Docker Desktop hangs fail with a named diagnostic
instead of leaving the release check stuck indefinitely. Override timeouts with
`HYDRA_DOCKER_CONFIG_TIMEOUT_MS`, `HYDRA_DOCKER_INFO_TIMEOUT_MS`, or
`HYDRA_DOCKER_BUILD_TIMEOUT_MS` when a slow host needs more time.

For a bounded runtime probe, run:

```bash
npm run docker:smoke -- --start
```

That starts the compose service, polls `http://127.0.0.1:3001/api/auth/status`,
prints compose state plus recent container logs on failure, and removes the
smoke container afterward with `docker compose down --remove-orphans`. Add
`--keep-running` if the smoke run should leave the server up.

## Operational Constraints

- The container runs the Express server and Vite-built UI, not the native
  Electron shell.
- Docker builds use Node 22 bookworm in both builder and runtime stages so the
  Electron 42 toolchain and Prisma client generation run on the supported Node
  version and the same Debian/glibc platform family.
- Docker build stages use `npm ci --ignore-scripts`; Electron native app
  dependency rebuilds are intentionally skipped because the container runs the
  Express/Vite server runtime, not the Electron shell.
- Browser automation uses Playwright Chromium inside the container.
- Account provisioning from cloud/VPS Docker hosts can be more likely to hit
  anti-bot checks than local residential machines.
- Keep `HYDRA_PROVISION_DEBUG=0` and `HYDRA_PROVISION_NETWORK_LOG=0` for
  persistent containers unless actively debugging.
