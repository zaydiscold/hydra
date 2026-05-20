# Hydra Docker Runtime

Hydra includes Docker support for runtime smoke testing and future hosted-router checks. Docker is not used as proof that the packaged Electron app works; it is a separate runtime gate for the local API/router surface.

## Commands

```bash
npm run docker:build
npm run docker:smoke
```

The smoke path is intentionally bounded. Set `HYDRA_DOCKER_BUILD_TIMEOUT_MS` when CI or a slow local daemon needs more time:

```bash
HYDRA_DOCKER_BUILD_TIMEOUT_MS=300000 npm run docker:smoke
```

## Cleanup

If a smoke run is interrupted or leaves containers behind, clean up with:

```bash
docker compose down --remove-orphans
```

The smoke scripts should treat failed starts as diagnostic evidence, not as silent cleanup. Keep stderr/stdout from Docker commands when filing release-audit notes so failures are reproducible.

## Release Audit Boundary

`node bin/hydra.mjs audit --json` can verify that Docker scripts and documentation exist, but it does not start Docker. Mark Docker runtime as complete only after `npm run docker:smoke` runs against a reachable Docker daemon.
