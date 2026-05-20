// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function readRepoFile(path) {
  return readFileSync(join(ROOT, path), 'utf-8');
}

test('dashboard non-fatal balance persistence failures are logged', () => {
  const source = readRepoFile('server/controllers/DashboardController.js');

  assert.match(source, /store\.updateAccountBalance\(account\.id,/);
  assert.match(source, /Balance cache update failed \(account=\$\{account\.id\}\): \$\{err\.message\}/);
  assert.doesNotMatch(source, /updateAccountBalance[\s\S]*?\.catch\(\(\) => \{\}\)/);
});

test('generator resource cleanup failures are visible', () => {
  const source = readRepoFile('server/services/account-generator.js');

  assert.match(source, /Page cleanup failed for \$\{taskId\}: \$\{err\.message\}/);
  assert.match(source, /Context cleanup failed for \$\{taskId\}: \$\{err\.message\}/);
  assert.match(source, /Browser cleanup failed for \$\{taskId\}: \$\{err\.message\}/);
  assert.match(source, /Launch-failure cleanup failed for \$\{task\.taskId\}: \$\{cleanupErr\.message\}/);
  assert.match(source, /Password submit click failed for \$\{task\.taskId\}: \$\{clickErr\.message\}/);
  assert.doesNotMatch(source, /closeGeneratorResources\(task\); \} catch \{ \/\* already gone \*\/ \}/);
  assert.doesNotMatch(source, /page\.click\('button\[type="submit"\], button:has-text\("Continue"\)'\)\.catch\(\(\) => \{\}\)/);
});

test('request-log retention shutdown wait failures are logged', () => {
  const source = readRepoFile('server/services/request-log-retention.js');

  assert.match(source, /Stop waited on failed prune: \$\{err\.message\}/);
  assert.doesNotMatch(source, /await prunePromise\.catch\(\(\) => \{\}\)/);
});

test('corrupt-account purge failures are logged', () => {
  const source = readRepoFile('server/services/store.js');

  assert.match(source, /Failed to purge corrupt account id=\$\{account\.id\}: \$\{deleteErr\.message\}/);
  assert.match(source, /Stored session token decrypt failed for account=\$\{account\.id\}: \$\{err\.message\}/);
  assert.match(source, /Skipping unreadable account during uniqueness check id=\$\{account\.id\}: \$\{err\.message\}/);
  assert.doesNotMatch(source, /prisma\.account\.delete\(\{ where: \{ id: account\.id \} \}\)\.catch\(\(\) => \{\s*\}\)/);
  assert.doesNotMatch(source, /catch \{\s*\/\/ Skip corrupt records; they will be purged by getAllAccountsWithKeys\(\)\./);
});

test('redemption history recording does not hide controller-side failures', () => {
  const source = readRepoFile('server/controllers/CodeController.js');

  assert.match(source, /async function recordRedemptionAttempt/);
  assert.match(source, /Redemption history alias lookup failed for account=\$\{accountId\}: \$\{err\.message\}/);
  assert.match(source, /addRedemptionRecord\(\{ code, accountId, accountAlias: alias, success, message, creditsAdded \}\)/);
  assert.doesNotMatch(source, /addRedemptionRecord[\s\S]*?catch \{ \/\* non-fatal \*\/ \}/);
});

test('redemption history file read/write failures are logged', () => {
  const source = readRepoFile('server/services/redemption-log.js');

  assert.match(source, /Failed to write log:/);
  assert.match(source, /Failed to read log:/);
  assert.doesNotMatch(source, /catch \{\s*return \[\];\s*\}/);
});

test('account dedup and silent-refresh fallbacks are logged', () => {
  const source = readRepoFile('server/controllers/AccountController.js');

  assert.match(source, /Bulk add dedup preload failed; duplicates may be reported as skipped errors/);
  assert.match(source, /Bulk OTP dedup preload failed; duplicate emails may not reuse existing rows/);
  assert.match(source, /Silent refresh recovery failed during refresh-login \(account=\$\{req\.params\.id\}\): \$\{err\.message\}/);
  assert.match(source, /Silent refresh failed \(account=\$\{req\.params\.id\}\): \$\{err\.message\}/);
  assert.doesNotMatch(source, /catch \{ \/\* ignore — dedup becomes best-effort \*\/ \}/);
  assert.doesNotMatch(source, /catch \{ \/\* fall through to manual re-auth \*\/ \}/);
});

test('pool status and sync-key registration fallbacks are logged', () => {
  const source = readRepoFile('server/controllers/PoolController.js');

  assert.match(source, /Status fallback used because rotation manager status failed: \$\{err\.message\}/);
  assert.match(source, /Failed to register synced key material for account=\$\{accountId\}: \$\{err\.message\}/);
  assert.match(source, /OpenRouter key validation returned invalid JSON for hash=\$\{hash\}: \$\{err\?\.message \|\| err\}/);
  assert.match(source, /OpenRouter key validation response did not include a hash for selected hash=\$\{hash\}/);
  assert.match(source, /OpenRouter key validation returned an invalid response\. Try again before pooling this key\./);
  assert.doesNotMatch(source, /catch \{\s*\/\/ Pool not loaded yet or DB hiccup/);
  assert.doesNotMatch(source, /catch \{ \/\* key may not be in DB yet/);
  assert.doesNotMatch(source, /orTest\.json\(\)\.catch\(\(\) => null\)/);
});

test('rotation manager weighted-selection fallbacks are logged', () => {
  const source = readRepoFile('server/services/rotation-manager.js');

  assert.match(source, /SELECTION_FALLBACK_LOG_WINDOW_MS/);
  assert.match(source, /Weighted key selection failed for \$\{available\.length\} available key\(s\); using round-robin fallback/);
  assert.match(source, /invalid limitRemaining for key/);
  assert.match(source, /invalid total selection weight/);
  assert.doesNotMatch(source, /catch \{\s*\/\/ safe fallback\s*\}/);
});

test('dashboard session-status fallback is logged', () => {
  const source = readRepoFile('server/controllers/DashboardController.js');

  assert.match(source, /Stored session status payload failed \(account=\$\{snapshot\.id\}\): \$\{err\.message\}/);
  assert.doesNotMatch(source, /catch \{\s*\/\/ Non-fatal: keep existing sessionStatus from meta/);
});

test('debug vampire-mode profile preload fallbacks are logged', () => {
  const source = readRepoFile('server/controllers/DebugController.js');

  assert.match(source, /vampire profile preload returned HTTP \$\{profileRes\.status\} for account=\$\{accountId\}/);
  assert.match(source, /vampire profile preload returned invalid JSON for account=\$\{accountId\}: \$\{err\?\.message \|\| err\}/);
  assert.match(source, /vampire profile preload failed for account=\$\{accountId\}: \$\{err\?\.message \|\| err\}/);
  assert.doesNotMatch(source, /profileRes\.json\(\)\.catch\(\(\) => null\)/);
  assert.doesNotMatch(source, /catch \{ \/\* best-effort — proceed with empty bio \*\/ \}/);
});

test('magic-link cleanup timer is owned by server lifecycle', () => {
  const manager = readRepoFile('server/services/magic-link-manager.js');
  const server = readRepoFile('server/index.js');

  assert.match(manager, /export function startMagicLinkCleanup\(\)/);
  assert.match(manager, /export function stopMagicLinkCleanup\(\)/);
  assert.match(manager, /cleanupTimer\.unref\?\.\(\)/);
  assert.doesNotMatch(manager, /^setInterval\(/m);
  assert.match(server, /startMagicLinkCleanup\(\)/);
  assert.match(server, /stopMagicLinkCleanup\(\)/);
});

test('long-running background timers do not pin idle Node processes', () => {
  const pinger = readRepoFile('server/services/health-pinger.js');
  const refresher = readRepoFile('server/services/session-refresher.js');
  const supervisor = readRepoFile('server/services/task-supervisor.js');
  const retention = readRepoFile('server/services/request-log-retention.js');

  assert.match(pinger, /timer\.unref\?\.\(\)/);
  assert.match(refresher, /_startupTimeoutHandle\.unref\?\.\(\)/);
  assert.match(refresher, /_intervalHandle\.unref\?\.\(\)/);
  assert.match(supervisor, /this\.timer\.unref\?\.\(\)/);
  assert.match(retention, /timer\.unref\?\.\(\)/);
});

test('file logging is rotated for unattended API-router runs', () => {
  const loggerSource = readRepoFile('server/services/logger.js');

  assert.match(loggerSource, /HYDRA_LOG_MAX_SIZE/);
  assert.match(loggerSource, /HYDRA_LOG_MAX_FILES/);
  assert.match(loggerSource, /maxsize:/);
  assert.match(loggerSource, /maxFiles:/);
  assert.match(loggerSource, /tailable: true/);
});

test('dashboard Playwright automation soft failures are logged', () => {
  const source = readRepoFile('server/services/dashboard-api.js');
  const automationSource = source.slice(source.indexOf('async function dismissOpenRouterBlockingOverlays'));

  assert.match(source, /pickAccountProxy/);
  assert.match(source, /ProxyAgent/);
  assert.match(source, /fetchOptionsWithAccountProxy/);
  assert.match(source, /redeemCodeViaServerAction\(sessionCookie, clientCookie, code, accountProxy\)/);
  assert.match(source, /trpcCall\(route, input, sessionCookie, clientCookie, headerOverrides, \{ accountProxy: context\.accountProxy \}\)/);
  assert.match(source, /tryRestApiRedeemCode\(sessionCookie, clientCookie, code, accountProxy\)/);
  assert.match(source, /redeemCodeViaPlaywright\(userId, accountId, sessionCookie, clientCookie, code, accountProxy\)/);
  assert.match(source, /Using account proxy \$\{describeProxy\(accountProxy\)\} for management-key provision account=\$\{accountId\}/);
  assert.match(source, /Using account proxy \$\{describeProxy\(accountProxy\)\} for code redemption account=\$\{accountId\}/);
  assert.match(source, /proxy: toPlaywrightProxy\(accountProxy\)/);
  assert.match(source, /Escape press failed \(\$\{err\.message\}\)/);
  assert.match(source, /dismiss click failed \(\$\{err\.message\}\)/);
  assert.match(source, /captureKeyFromPageImmediate: Copy click failed \(\$\{err\.message\}\)/);
  assert.match(source, /Copy button click failed \(attempt \$\{attempt\}\): \$\{err\.message\}/);
  assert.match(source, /captureKeyFromPageImmediate: DOM eval failed \(\$\{err\.message\}\)/);
  assert.match(source, /\$\{label\} clipboard read failed: \$\{result\.error\}/);
  assert.match(source, /captureKeyFromPageImmediate: after Copy click/);
  assert.match(source, /clipboard read after copy attempt \$\{attempt\}/);
  assert.match(source, /management-key DOM input scan failed: \$\{err\.message\}/);
  assert.match(source, /management-key final clipboard fallback/);
  assert.match(source, /Reveal button click failed \(attempt \$\{attempt\}\): \$\{err\.message\}/);
  assert.match(source, /clipboard permission grant failed: \$\{err\.message\}/);
  assert.match(source, /provision network response log failed: \$\{err\.message\}/);
  assert.match(source, /management-keys title read failed: \$\{err\.message\}/);
  assert.match(source, /management-keys networkidle wait failed: \$\{err\.message\}/);
  assert.match(source, /visible key text wait failed: \$\{err\.message\}/);
  assert.match(source, /Management key Save click failed for account=\$\{accountId\}; retrying with force: \$\{err\?\.message \|\| err\}/);
  assert.match(source, /Management key fallback submit click failed for account=\$\{accountId\}; retrying with force: \$\{err\?\.message \|\| err\}/);
  assert.match(source, /child frame key scan failed: \$\{err\.message\}/);
  assert.match(source, /failure page URL read failed: \$\{err\.message\}/);
  assert.match(source, /Could not stop provision tracing after success:/);
  assert.match(source, /Could not capture provision debug artifacts:/);
  assert.match(source, /Provision browser close failed:/);
  assert.match(source, /Redeem modal open click failed:/);
  assert.match(source, /Redeem browser close failed:/);
  assert.match(source, /Reveal button click failed:/);
  assert.match(source, /Browser close failed:/);
  assert.match(source, /Hash auto-discovery bundle fetch returned HTTP \$\{jsRes\.status\}: \$\{url\}/);
  assert.match(source, /Hash auto-discovery bundle fetch failed for \$\{url\}: \$\{err\?\.message \|\| err\}/);
  assert.match(source, /Self-heal \$\{kind\} hash probe failed for candidate \$\{candidate\}: \$\{err\?\.message \|\| err\}/);
  assert.match(source, /Redeem credit poll failed \(attempt \$\{i \+ 1\}\/\$\{attempts\}\): \$\{err\?\.\message \|\| err\}/);
  assert.match(source, /Redeem tRPC route persistence failed: \$\{err\?\.\message \|\| err\}/);
  assert.match(source, /Redeem tRPC outcome parse failed; falling through to UI\/credits: \$\{err\?\.message \|\| err\}/);
  assert.match(source, /Redeem credits preflight failed for account=\$\{accountId\}: \$\{err\?\.message \|\| err\}/);
  assert.match(source, /Redeem account lookup failed for account=\$\{accountId\}; skipping credits verification: \$\{err\?\.message \|\| err\}/);
  assert.match(source, /getUserProfile tRPC fallback failed: \$\{err\?\.message \|\| err\}/);
  assert.match(source, /syncApiKeys tRPC candidate \$\{route\} failed for account=\$\{accountId\}: \$\{err\?\.message \|\| err\}/);
  assert.doesNotMatch(automationSource, /\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(automationSource, /catch \{\s*(?:void 0;|\/\* skip \*\/)\s*\}/);
  assert.doesNotMatch(automationSource, /catch \{\s*\/\* skip poll \*\/\s*\}/);
  assert.doesNotMatch(automationSource, /catch \{\s*\/\* ignore \*\/\s*\}/);
});

test('CLI, telemetry, and proxy soft failures are logged', () => {
  const cliServices = readRepoFile('bin/lib/services.js');
  const ipc = readRepoFile('electron/app/ipc.js');
  const telemetry = readRepoFile('electron/app/telemetry.js');
  const userPrefs = readRepoFile('electron/app/userPrefs.js');
  const proxy = readRepoFile('server/routes/proxy.js');
  const requestLogBuffer = readRepoFile('server/services/request-log-buffer.js');
  const openrouter = readRepoFile('server/services/openrouter.js');

  assert.match(cliServices, /service shutdown cleanup failed: \$\{err\?\.\message \|\| err\}/);
  assert.doesNotMatch(cliServices, /catch \{ \/\* ignore \*\/ \}/);

  assert.match(ipc, /renderer auth-token chmod failed:/);
  assert.doesNotMatch(ipc, /chmod\(file, 0o600\)\.catch\(\(\) => \{\}\)/);

  assert.match(telemetry, /dropping event because scrub failed:/);
  assert.match(telemetry, /could not read preferences; telemetry disabled:/);
  assert.match(telemetry, /crash reporter start failed:/);
  assert.match(telemetry, /failed to disable Sentry client:/);
  assert.match(telemetry, /failed to capture exception:/);
  assert.doesNotMatch(telemetry, /catch \{ \/\* ignore \*\/ \}/);
  assert.doesNotMatch(telemetry, /catch \{ \/\* some platforms refuse pre-init; ignore \*\/ \}/);

  assert.match(userPrefs, /userData chmod failed:/);
  assert.match(userPrefs, /temp file chmod failed:/);
  assert.doesNotMatch(userPrefs, /chmod\(dir, 0o700\)\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(userPrefs, /chmod\(tmp, 0o600\)\.catch\(\(\) => \{\}\)/);

  assert.match(proxy, /Failed to read OpenRouter 429 response body: \$\{err\?\.\message \|\| err\}/);
  assert.match(proxy, /Live model list fetch returned HTTP \$\{result\.status\}; serving static model fallback/);
  assert.match(proxy, /Model list fallback used because live\/cache lookup failed: \$\{err\?\.message \|\| err\}/);
  assert.match(proxy, /formatPrismaError\(fallbackErr, 'create RequestLog placeholder without keyHash'\)/);
  assert.match(proxy, /enqueueRequestLog/, 'non-stream proxy request logs must use the bounded request-log buffer');
  assert.match(proxy, /MAX_IN_FLIGHT/, 'proxy must have an explicit in-flight guard for sustained router load');
  assert.match(proxy, /logger\.debug\(`\[PROXY\] \$\{req\.method\}/, 'proxy success logging must stay off info level on the hot path');
  assert.doesNotMatch(proxy, /upstreamRes\.text\(\); \} catch \{ \/\* ignore \*\/ \}/);
  assert.doesNotMatch(proxy, /catch \{\s*\/\/ fall through/);
  assert.doesNotMatch(proxy, /handleModelList[\s\S]*catch \{\s*res\.setHeader\('X-Hydra-Models-Source', 'static'\)/);

  assert.match(requestLogBuffer, /MAX_QUEUE/, 'request log buffering must be bounded');
  assert.match(requestLogBuffer, /Queue full; dropped \$\{dropped\} request log row/, 'request log overflow must leave throttled evidence');
  assert.match(requestLogBuffer, /formatPrismaError\(fallbackErr, 'write buffered RequestLog without keyHash'\)/);
  assert.match(requestLogBuffer, /export async function stopRequestLogBuffer/, 'request log buffer must drain on shutdown');
  assert.match(requestLogBuffer, /HYDRA_REQUEST_LOG_SHUTDOWN_DRAIN_MS/, 'shutdown drain must be bounded');
  assert.match(requestLogBuffer, /Promise\.race/, 'shutdown drain must not hang indefinitely on SQLite');
  assert.doesNotMatch(requestLogBuffer, /queue\.push[\s\S]*without bound/);

  assert.match(openrouter, /Account snapshot credits lookup failed: \$\{err\?\.message \|\| err\}/);
  assert.match(openrouter, /Account snapshot key list lookup failed: \$\{err\?\.message \|\| err\}/);
  assert.match(openrouter, /DEFAULT_TIMEOUT_MS = 30000/);
  assert.match(openrouter, /fetchOptions\.signal = AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(openrouter, /OpenRouter API request timed out after \$\{timeoutMs\}ms: \$\{path\}/);
  assert.doesNotMatch(openrouter, /getCredits\(managementKey\)\.catch\(\(\) => \(\{ total: 0, used: 0, remaining: 0 \}\)\)/);
  assert.doesNotMatch(openrouter, /listKeys\(managementKey\)\.catch\(\(\) => \[\]\)/);
});

test('account generator browser signup uses the encrypted proxy pool when present', () => {
  const source = readRepoFile('server/services/account-generator.js');

  assert.match(source, /pickAccountProxy/);
  assert.match(source, /Using account proxy \$\{describeProxy\(accountProxy\)\} for task \$\{task\.taskId\}/);
  assert.match(source, /proxy: toPlaywrightProxy\(accountProxy\)/);
});

test('OpenRouter model-list cache requests are timeout bounded', () => {
  const source = readRepoFile('server/services/model-cache.js');

  assert.match(source, /MODEL_LIST_TIMEOUT_MS = 30000/);
  assert.match(source, /signal: AbortSignal\.timeout\(MODEL_LIST_TIMEOUT_MS\)/);
});

test('auth callback best-effort provisioning and opener notification failures are logged', () => {
  const authRoute = readRepoFile('server/routes/auth.js');

  assert.match(authRoute, /magic-link management-key auto-provision failed for account=\$\{pending\.accountId\}/);
  assert.doesNotMatch(authRoute, /catch \{ \/\* non-fatal \*\/ \}/);
  assert.match(authRoute, /magic-link opener notification failed:/);
  assert.doesNotMatch(authRoute, /catch \(e\) \{ \/\* cross-origin or blocked/);
});

test('session lifetime probe failures keep account-level evidence', () => {
  const source = readRepoFile('server/services/session-refresher.js');
  const store = readRepoFile('server/services/store.js');

  assert.match(source, /Stored session token decrypt failed for account=\$\{account\.id\}: \$\{err\.message\}/);
  assert.match(source, /Live refresh probe failed for account=\$\{account\.id\}: \$\{err\.message\}/);
  assert.match(source, /function _redactAlias\(alias\)/);
  assert.match(source, /function _redactSid\(sid\)/);
  assert.match(source, /alias="\$\{_redactAlias\(account\.alias\)\}" sid=\$\{_redactSid\(sid\)\}/);
  assert.match(source, /old_sid=\$\{_redactSid\(trackedSid\)\}.*new_sid=\$\{_redactSid\(currentSid\)\}/s);
  assert.doesNotMatch(source, /alias="\$\{account\.alias\}" sid=\$\{sid\}/);
  assert.doesNotMatch(source, /old_sid=\$\{trackedSid \?\? 'none'\}.*new_sid=\$\{currentSid\}/s);
  assert.doesNotMatch(source, /try \{ rawJwt = decrypt\(account\.sessionToken\) \|\| ''; \} catch \{ \/\* no-op \*\/ \}/);
  assert.doesNotMatch(source, /catch \{\s*status = 'error';\s*\}/);
  assert.match(store, /Live refresh probe failed for account=\$\{accountId \|\| 'unknown'\}: \$\{err\.message\}/);
  assert.doesNotMatch(store, /catch \{\s*status = 'error';\s*\}/);
});

test('key decrypt fallbacks keep key-scoped evidence', () => {
  const source = readRepoFile('server/services/store.js');
  const firstStoredApiKey = source.slice(
    source.indexOf('export async function getFirstStoredApiKeyString'),
    source.indexOf('export async function getLocalKeys'),
  );
  const localKeys = source.slice(
    source.indexOf('export async function getLocalKeys'),
    source.indexOf('export async function registerKeyString'),
  );

  assert.match(source, /Failed to decrypt first stored API key hash=\$\{keyRecord\.hash\}: \$\{err\.message\}/);
  assert.match(source, /Failed to decrypt local key hash=\$\{keyRecord\.hash\}: \$\{err\.message\}/);
  assert.doesNotMatch(firstStoredApiKey, /catch \{\s*return null;\s*\}/);
  assert.doesNotMatch(localKeys, /catch \{\s*key = null;\s*\}/);
});

test('legacy storage reset probes keep unreadable-field evidence', () => {
  const source = readRepoFile('server/services/legacy-storage.js');

  assert.match(source, /Legacy account config unreadable during migration check: \$\{err\.message\}/);
  assert.match(source, /Legacy account session token unreadable during migration check: \$\{err\.message\}/);
  assert.match(source, /Legacy key ciphertext unreadable during migration check: \$\{err\.message\}/);
  assert.doesNotMatch(source, /catch \{\s*return true;\s*\}/);
});
