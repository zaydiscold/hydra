# Management Key Prefix Finding — Finding #47 (Resolved)

## What

OpenRouter management keys use the `sk-or-v1-` prefix, **not** `sk-or-mgmt-` as previously assumed. This was confirmed empirically in session 21 by examining actual stored keys in the Hydra vault and testing against the OpenRouter API.

The `MGMT_KEY_RE` regex at `dashboard-api.js:46` (`/sk-or-v1-[A-Za-z0-9]{20,}/`) was **correct all along**. The `key-utils.js` fix from session 17/18 that reclassified `sk-or-v1-` as a non-management key was **wrong** and has been reverted/corrected.

## How

1. Provisioned a management key via the OpenRouter dashboard
2. Observed the returned key prefix: `sk-or-v1-` (not `sk-or-mgmt-`)
3. Verified the key works with `GET /api/v1/auth/key` (mgmt key auth endpoint)
4. Confirmed `MGMT_KEY_RE` at `dashboard-api.js:46` correctly matches real mgmt keys
5. Updated `key-utils.js` to classify `sk-or-v1-` as a management key (reverting the incorrect session 17 change)

## Why It Matters

- **Key provisioning silently fails** if the regex doesn't match the key prefix. The `createManagementKey` Server Action response is parsed with `MGMT_KEY_RE` — if the regex misses the prefix, the newly created key is never stored in the vault, and the operator gets no error (silent failure).
- **Key classification affects routing.** If `key-utils.js` classifies a management key as a regular API key, it won't be stored in the management-key-store, won't be used for balance queries, and won't appear in the management keys section of AccountDetail.
- **This is a cross-file consistency bug.** Two files had contradictory assumptions about the same prefix. Without empirical testing, either one could appear correct in code review.

## Evidence

- `MGMT_KEY_RE` at `dashboard-api.js:46`: `/sk-or-v1-[A-Za-z0-9]{20,}/` — matches real keys
- Actual provisioned key format: `sk-or-v1-<40+ alphanumeric chars>`
- `key-utils.js` classification: `sk-or-v1-` → `'management'` (corrected in session 21)
- OpenRouter API confirms: `GET /api/v1/auth/key` with `Authorization: Bearer sk-or-v1-...` returns `{ data: { ... } }` (management key accepted)

## Reproducibility

1. Provision a new management key via `POST /api/accounts/:id/provision` or the OR dashboard
2. Observe the returned key starts with `sk-or-v1-`
3. Validate against `GET https://openrouter.ai/api/v1/auth/key` with `Authorization: Bearer <key>`
4. Check `key-utils.js:classifyKey(key)` returns `'management'` for `sk-or-v1-` prefix

## Resolution

- Session 17/18 incorrectly changed `key-utils.js` to classify `sk-or-v1-` as a separate category from management keys
- Session 21 corrected this: `sk-or-v1-` keys ARE management keys
- `MGMT_KEY_RE` in `dashboard-api.js` was already correct and did not need changes
