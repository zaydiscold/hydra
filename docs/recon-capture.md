# Recon Data Captured from Debug Scripts

Extracted from root-level debug/test scripts before deletion (2026-04-11).

## tRPC Routes Discovered

The following tRPC route names were tested against `https://openrouter.ai/api/trpc/`:

### Management Key Routes
- `managementKeys.list` — **confirmed working** (returns JSON list of management keys)
- `managementKeys.create` — tested, unknown result
- `managementKey.create` — tested
- `keys.createManagement` — tested
- `managementKeys.createKey` — tested
- `managementKeys.createManagementKey` — tested
- `management.createManagementKey` — tested
- `management.createKey` — tested
- `apiKeys.createManagement` — tested
- `apiKeys.createManagementKey` — tested
- `settings.managementKeys.create` — tested
- `dashboard.managementKeys.create` — tested
- `admin.managementKeys.create` — tested
- `user.managementKeys.create` — tested
- `account.managementKeys.create` — tested
- `keys.management.create` — tested
- `keys.managementCreate` — tested

### Other Routes Tested
- `keys.createManagement` — tested
- `apiKeys.create` — tested
- `user.createApiKey` — tested
- `settings.createKey` — tested

## tRPC Request Format

**POST format** (batch):
```
POST /api/trpc/{route}?batch=1
Content-Type: application/json
x-trpc-source: nextjs-react

Body: {"0": {"json": { ...payload... }}}
```

**GET format**:
```
GET /api/trpc/{route}?input=<url-encoded-json>
```

## Cookie/Header Combos for tRPC Auth

Required cookies (in order of testing):
1. `__session` — Clerk session JWT (primary auth)
2. `__client` — Clerk client JWT
3. `__client_uat` — Clerk client user-at timestamp
4. `__cf_bm` — Cloudflare bot management
5. `_cfuvid` — Cloudflare unique visitor ID

Key headers:
- `Cookie: __session=<jwt>; __client=<...>; __client_uat=<...>; __cf_bm=<...>; _cfuvid=<...>`
- `x-trpc-source: nextjs-react`
- `Origin: https://openrouter.ai`
- `Referer: https://openrouter.ai/settings/management-keys`
- `User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ...`

## Clerk FAPI Endpoints

- `GET https://clerk.openrouter.ai/v1/client?_clerk_js_version=5.0.0` — Returns JWT, sessions, client data
  - Response path: `data.response.sessions[0].last_active_token.jwt` or `data.client.sessions[0].last_active_token.jwt`
- `GET https://clerk.openrouter.ai/v1/me`
- `GET https://clerk.openrouter.ai/v1/sessions`

## Next.js Server Actions

- Action ID discovered: `00ba0cca67cdca18c29a01625210c65fbda7039b6d` (from test-server-action.mjs)
- Header: `Next-Action: <action-id>`
- Content-Type: `text/plain;charset=UTF-8`
- Accept: `text/x-component, application/json`

## REST Endpoints Tested

- `/api/v1/management-keys` — POST tested
- `/api/v1/keys` — GET/POST tested
- `/api/auth/keys` — POST tested
- `/api/user/keys` — POST tested
- `/api/account/keys` — POST tested
- `/api/management/keys` — POST tested
- `/api/keys/management` — POST tested
- `/api/settings/keys` — POST tested
- `/api/dashboard/keys` — POST tested
- `/api/keys` — GET tested (confirmed returns key list with Bearer auth)

## Auth Patterns

1. **Bearer token auth**: `Authorization: Bearer <management-key>` for OpenRouter REST API
2. **Cookie auth**: `__session` JWT + Clerk device cookies for tRPC/dashboard routes
3. **Hydra admin auth**: POST to `/api/auth/login` with `{ password }` returns JWT token

## Payload Shapes

Management key creation payloads tested:
- `{ name: '...' }` — most common
- `{ label: '...' }`
- `{ title: '...' }`
- `{ keyName: '...' }`
- `{ name: '...', type: 'management' }`

Key provisioning body format (tRPC batch):
```json
{"0": {"json": {"name": "Hydra Test Key"}}}
```

## OpenRouter REST API Key Operations (Confirmed Working)

From test2.js/test3.js:
- `GET /api/v1/keys` — List keys (Bearer auth with management key)
- `PATCH /api/v1/keys/{hash}` — Update key (body: `{ name: '...' }`)
- `PUT /api/v1/keys/{hash}` — Replace key settings
