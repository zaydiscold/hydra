# OpenAPI generator drift

## What was found

The committed OpenAPI artifact documented the dashboard auth enable and disable routes, but the source generator omitted them. The existing coverage test read the committed artifact, so it could pass while a regeneration silently removed valid operations.

## How it was checked

1. Compared `scripts/generate-hydra-openapi.mjs` with `openapi/hydra-api.openapi.json` and the concrete auth routes.
2. Added the missing `POST /api/auth/disable` and `POST /api/auth/enable` operations to the generator.
3. Generated to a temporary file using `HYDRA_OPENAPI_OUT` and compared the bytes with the committed artifact.
4. Ran `npm run test:openapi-map` and the full test chain.

## Why it matters

Client generators and API-map consumers need the committed specification and its generator to agree. A disposable output path lets CI check freshness without changing the working tree.

## Redacted evidence and reproducibility

The mismatch involved route names only. No account data or credentials were read. Run `npm run test:openapi-map`; the freshness test regenerates into a temporary directory, compares it with the committed JSON, and removes the temporary output afterward.
