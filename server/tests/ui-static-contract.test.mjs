// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function readRepoFile(path) {
  return readFileSync(join(ROOT, path), 'utf-8');
}

function listFiles(dir, predicate) {
  const root = join(ROOT, dir);
  const files = [];
  const walk = (absolute, relative) => {
    for (const entry of readdirSync(absolute)) {
      const entryAbsolute = join(absolute, entry);
      const entryRelative = `${relative}/${entry}`;
      const stat = statSync(entryAbsolute);
      if (stat.isDirectory()) {
        walk(entryAbsolute, entryRelative);
      } else if (predicate(entryRelative)) {
        files.push(entryRelative);
      }
    }
  };
  walk(root, dir);
  return files.sort();
}

function cssRuleBlock(css, selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `missing CSS selector ${selector}`);
  const tail = css.slice(start);
  const end = tail.indexOf('\n}');
  assert.notEqual(end, -1, `missing CSS rule close for ${selector}`);
  return tail.slice(0, end + 2);
}

test('bulk email parsing preserves duplicate remainders when used rows are cleared', async () => {
  const { parseEmailEntries, remainingEmailTextAfterUse } = await import('../../src/utils/auth.js');
  const parsed = parseEmailEntries('A@Example.com\na@example.com\nb@example.com');

  assert.deepEqual(parsed.emails, ['a@example.com', 'b@example.com']);
  assert.deepEqual(parsed.duplicates, ['a@example.com']);
  assert.equal(
    remainingEmailTextAfterUse('a@example.com\na@example.com\nb@example.com', ['a@example.com']),
    'a@example.com\nb@example.com',
  );
});

test('bulk import copy points OpenRouter users at OTP instead of an unverified callback setup', () => {
  const page = readRepoFile('src/pages/BulkAuthWizard.jsx');
  const tab = readRepoFile('src/components/EmailLinkTab.jsx');
  const authUtils = readRepoFile('src/utils/auth.js');

  assert.match(page, /Owner-only; not OpenRouter/);
  assert.match(page, /Email Link is an owner-only advanced relay/);
  assert.match(page, /same direct HTTPS email-code login used by account cards/);
  assert.match(page, /Use Generator for a brand-new signup/);
  assert.match(page, /magicLinkCapability=\{auth\.magicLinkCapability\}/);
  assert.match(page, /onRefreshCapability=\{auth\.refreshMagicLinkCapability\}/);
  assert.match(tab, /bulk-auth-email-link-capability/);
  assert.match(tab, /Use OTP instead/);
  assert.match(tab, /disabled=\{creating \|\| callbackUnavailable\}/);
  assert.match(tab, /2\. Send status/);
  assert.doesNotMatch(page, /One click link/);
  assert.doesNotMatch(tab, /Parallel status/);
  assert.match(authUtils, /Email Link works only when its capability banner says ready/);
  assert.match(authUtils, /Generator handles a new OpenRouter signup through its isolated interactive flow/);
  assert.doesNotMatch(authUtils, /Try the Email Link tab instead/);
  assert.match(authUtils, /Too many OTP requests sent from this IP/);
  assert.doesNotMatch(authUtils, /Too many OTP requests send from this IP/);
});

test('Electron app chrome draws its own drag strip on macOS with traffic-light clearance', () => {
  const app = readRepoFile('src/App.jsx');
  const css = readRepoFile('src/index.css');
  const windowsJs = readRepoFile('electron/app/windows.js');
  const chromeStart = app.indexOf('function AppChrome()');
  assert.notEqual(chromeStart, -1);
  const chromeEnd = app.indexOf('export default function App()', chromeStart);
  const appChrome = app.slice(chromeStart, chromeEnd);

  // macOS: hiddenInset titlebar in Electron + bespoke renderer drag strip,
  // with traffic lights inset at (14, 12) — matches the CSS left padding.
  assert.match(windowsJs, /titleBarStyle: 'hiddenInset'/);
  assert.match(windowsJs, /trafficLightPosition: \{ x: 14, y: 12 \}/);

  // AppChrome now renders on every Electron platform; mac variant is the
  // slim drag strip with no custom window controls (OS traffic lights handle that).
  assert.match(app, /function isMacUserAgent\(\)/);
  assert.match(appChrome, /app-chrome app-chrome--mac/);
  assert.match(appChrome, /className="app-chrome__name">Hydra/);
  assert.match(appChrome, /<img src="\/hydra_dragon\.png" alt="" \/>/);
  assert.match(app, /className="sidebar-logo-icon">\s*<img src="\/hydra_dragon\.png" alt="" \/>/);
  assert.match(css, /\.app-chrome__mark img\s*\{[\s\S]*?object-fit:\s*cover;/);
  assert.match(app, /function AppVersionStamp\(\)/);
  assert.match(app, /className="app-version-stamp"/);
  assert.match(app, /import\.meta\.env\.VITE_APP_VERSION/);
  assert.match(windowsJs, /class="splash-version">v' \+ versionSafe \+ '<\/div>/);
  assert.match(css, /\.app-version-stamp\s*\{[\s\S]*?position:\s*fixed;/);
  assert.match(css, /\.app-version-stamp\s*\{[\s\S]*?right:\s*10px;/);
  assert.match(css, /\.app-version-stamp\s*\{[\s\S]*?bottom:\s*8px;/);
  assert.match(app, /const rendererChrome = electronMode;/);
  assert.doesNotMatch(appChrome, /\{title\}/);
  assert.doesNotMatch(app, /<AppChrome\s+title=/);

  // Base chrome stays draggable, controls stay no-drag (for non-mac), and the
  // mac variant left-pads enough room for traffic lights.
  assert.match(css, /\.app-chrome\s*\{[\s\S]*?-webkit-app-region:\s*drag;/);
  assert.match(css, /\.app-chrome__controls\s*\{[\s\S]*?-webkit-app-region:\s*no-drag;/);
  assert.match(css, /\.app-chrome--mac\s*\{[\s\S]*?padding-left:\s*82px;/);
});

test('detailed Hydra dragon stays the curated platform-icon master', () => {
  const pkg = JSON.parse(readRepoFile('package.json'));
  const microMarkGenerator = readRepoFile('scripts/generate-hydra-source-icon.mjs');
  const iconDocs = readRepoFile('desktop/icons/README.md');

  assert.equal(pkg.scripts['icons:generate'], 'node scripts/generate-icons.mjs --source public/hydra_dragon.png');
  assert.match(microMarkGenerator, /const microBadgePng = path\.join\(publicDir, 'hydra_micro_badge\.png'\)/);
  assert.match(microMarkGenerator, /must not overwrite[\s\S]*platform-icon source/);
  assert.match(iconDocs, /curated 1024×1024 detailed[\s\S]*three-headed Hydra raster/);
  assert.match(iconDocs, /does not overwrite the detailed platform-icon master/);
});

test('packaged renderer startup assets stay same-origin and offline-capable', () => {
  const html = readRepoFile('index.html');
  const css = readRepoFile('src/index.css');

  assert.match(html, /<link rel="icon" type="image\/png" href="\/hydra_dragon\.png" \/>/);
  assert.doesNotMatch(html, /data:image\/svg\+xml/);
  assert.doesNotMatch(css, /fonts\.googleapis\.com/);
});

test('ambient app chrome animations settle after launch instead of running forever', () => {
  const app = readRepoFile('src/App.jsx');
  const css = readRepoFile('src/index.css');

  assert.match(app, /const \[ambientMotion, setAmbientMotion\] = useState\(true\)/);
  assert.match(app, /setTrackedTimeout\('App\.ambientMotion', \(\) => setAmbientMotion\(false\), 12_000\)/);
  assert.match(app, /clearTrackedTimeout\(timer\)/);
  assert.match(app, /document\.hidden/);
  assert.match(app, /app-shell--ambient-motion/);
  assert.match(app, /app-shell--motion-settled/);

  assert.doesNotMatch(cssRuleBlock(css, '.nebula-glow {'), /animation:/);
  assert.doesNotMatch(cssRuleBlock(css, '.starfield::before {'), /animation:/);
  assert.doesNotMatch(cssRuleBlock(css, '.starfield::after {'), /animation:/);
  assert.doesNotMatch(cssRuleBlock(css, '.meteor {'), /animation:/);
  assert.doesNotMatch(cssRuleBlock(css, '.sidebar-logo-icon {'), /animation:/);

  assert.match(css, /\.app-shell--ambient-motion \.nebula-glow\s*\{[\s\S]*?animation:\s*nebulaFlow 20s ease-in-out infinite alternate;/);
  assert.match(css, /\.app-shell--ambient-motion \.starfield::before\s*\{[\s\S]*?animation:\s*twinkle 4s ease-in-out infinite alternate;/);
  assert.match(css, /\.app-shell--ambient-motion \.meteor\s*\{[\s\S]*?animation:\s*meteorFall linear infinite;/);
  assert.match(css, /\.app-shell--ambient-motion \.sidebar-logo-icon\s*\{[\s\S]*?animation:\s*logo-breathing 4s ease-in-out infinite;/);
  assert.match(css, /\.app-shell--motion-settled \.meteor-container\s*\{[\s\S]*?display:\s*none;/);
  assert.doesNotMatch(css, /\.edm-bar\s*\{/);
  assert.doesNotMatch(css, /@keyframes edm-flow/);
});

test('steady status dots keep their glow without perpetual compositor animation', () => {
  const css = readRepoFile('src/index.css');

  assert.doesNotMatch(cssRuleBlock(css, '.status-dot.success {'), /animation:/);
  assert.doesNotMatch(cssRuleBlock(css, '.status-dot.error {'), /animation:/);
  assert.doesNotMatch(cssRuleBlock(css, '.status-dot.warning, .status-dot.loading {'), /animation:/);
  assert.match(cssRuleBlock(css, '.status-dot.success {'), /box-shadow:\s*0 0 6px color-mix/);
  assert.match(cssRuleBlock(css, '.status-dot.error {'), /box-shadow:\s*0 0 6px color-mix/);
  assert.match(cssRuleBlock(css, '\n.status-dot.loading {'), /animation:\s*dotPulse 1\.2s ease-in-out 3;/);
  assert.doesNotMatch(cssRuleBlock(css, '\n.status-dot.loading {'), /infinite/);
});

test('actionable recovery frames settle instead of sweeping forever', () => {
  const css = readRepoFile('src/index.css');

  const selector = '.hydra-load-frame--error .hydra-load-meter i,\n.hydra-load-frame--warning .hydra-load-meter i {';
  const recoveryMeter = cssRuleBlock(css, selector);
  assert.match(recoveryMeter, /width:\s*100%/);
  assert.match(recoveryMeter, /transform:\s*translateX\(0\)/);
  assert.match(recoveryMeter, /animation:\s*none/);
});

test('fallback recovery frames do not allocate permanently hidden glyph DOM', () => {
  const app = readRepoFile('src/App.jsx');
  const css = readRepoFile('src/index.css');

  assert.doesNotMatch(app, /hydra-letter-rain/);
  assert.doesNotMatch(app, /length:\s*compact\s*\?\s*18\s*:\s*34/);
  assert.doesNotMatch(css, /\.hydra-letter-rain/);
});

test('splash owns one throttled physics and render loop', () => {
  const windowsJs = readRepoFile('electron/app/windows.js');
  const splashLabels = [...windowsJs.matchAll(/\{ text: '([^']+)',\s+tag: '(?:brand|model)'/g)]
    .map(([, label]) => label);

  assert.match(windowsJs, /HYDRA_SPLASH_DURATION_MS=16000/);
  assert.match(windowsJs, /HYDRA_SPLASH_EXIT_MS=13000/);
  assert.match(windowsJs, /HYDRA_SPLASH_PORTAL_MS=3000/);
  assert.match(windowsJs, /HYDRA_SPLASH_EXIT_FADE_DELAY_MS=2700/);
  assert.match(windowsJs, /HYDRA_SPLASH_DISPOSE_MS=18500/);
  assert.match(windowsJs, /HYDRA_SPLASH_TARGET=72/);
  assert.ok(splashLabels.length >= 72, 'splash corpus must cover the bounded queue without refill');
  assert.equal(new Set(splashLabels).size, splashLabels.length, 'splash corpus labels must stay unique');
  assert.doesNotMatch(windowsJs, /Bod\.rectangle\(w\/2,-WT\/2,lx,WT/);
  assert.match(windowsJs, /m\.kind="shattered";hydraSplashDiagnostics\.shatteredWordCount\+\+/);
  assert.match(windowsJs, /shuffle\(items\)\.slice\(0,Math\.min\(n,items\.length\)\)/);
  assert.match(windowsJs, /<div class="aperture" aria-hidden="true"><\/div>/);
  assert.match(windowsJs, /\.aperture::before/);
  assert.doesNotMatch(windowsJs, /dial-cell/);
  assert.match(windowsJs, /const maxPixels=2800000/);
  assert.match(windowsJs, /Math\.sqrt\(maxPixels\/\(w\*h\)\)/);
  assert.match(windowsJs, /tiltBias=hydraSplashTiltGravityX\*\(W\(\)\*0\.18\)/);
  assert.match(windowsJs, /hydraSplashTiltGravityX\*2\.2/);
  assert.match(windowsJs, /hydraSplashLeanX\+= \(hydraSplashTiltGravityX-hydraSplashLeanX\)\*0\.08/);
  assert.match(windowsJs, /HYDRA_SPLASH_PHYSICS_STEP_MS=1000\/45/);
  assert.match(windowsJs, /HYDRA_SPLASH_RENDER_FRAME_MS=1000\/30/);
  assert.match(windowsJs, /const physicsStep=hydraSplashExitStartedAt\?HYDRA_SPLASH_RENDER_FRAME_MS:HYDRA_SPLASH_PHYSICS_STEP_MS/);
  assert.match(windowsJs, /while\(hydraSplashPhysicsCarry>=physicsStep&&steps<2\)\{Eng\.update\(engine,physicsStep\)/);
  assert.match(windowsJs, /window\.__HYDRA_SPLASH_DIAGNOSTICS__=hydraSplashDiagnostics/);
  assert.match(windowsJs, /window\.addEventListener\("deviceorientation",onHydraSplashDeviceOrientation\)/);
  assert.match(windowsJs, /window\.GravitySensor\|\|window\.Accelerometer/);
  assert.match(windowsJs, /hydraSplashTiltSensor\.start\(\)/);
  assert.match(windowsJs, /hydraSplashTiltSensor\.stop\(\)/);
  assert.match(windowsJs, /engine\.world\.gravity\.x=hydraSplashLeanX/);
  assert.match(windowsJs, /portalRadius=Math\.min\(W\(\),H\(\)\)\*\(0\.46-0\.27\*easedExit\)/);
  assert.match(windowsJs, /portalSpeed=4\.4\+18\.6\*easedExit/);
  assert.match(windowsJs, /liftBoost=\(1-portalRatio\)\*10/);
  assert.match(windowsJs, /releaseLift=\(1-portalRatio\)\*7\.5/);
  assert.match(windowsJs, /b\.collisionFilter\.mask=0;b\.isSensor=true/);
  assert.match(windowsJs, /hydraSplashDiagnostics\.portalCollisionDisabled=true/);
  assert.match(windowsJs, /hydraSplashDiagnostics\.portalLiftApplied=true/);
  assert.match(windowsJs, /const stems=9/);
  assert.match(windowsJs, /baseFontSize\*\(0\.86\+Math\.random\(\)\*1\.04\)/);
  assert.match(windowsJs, /hydraSplashSetTimeout\(scheduleNextWord,delay\)/);
  assert.match(windowsJs, /Welcome, /);
  assert.match(windowsJs, /function drawHydraPortal\(now,ratio\)/);
  assert.match(windowsJs, /const bend=\(Math\.random\(\)-0\.5\)\*length\*0\.26,segments=Math\.max\(3,7-depth\)/);
  assert.match(windowsJs, /d\+=" L"\+px\.toFixed\(1\)\+" "\+py\.toFixed\(1\)/);
  assert.doesNotMatch(windowsJs, /path\.setAttribute\("d","M"\+x\.toFixed\(1\)\+" "\+y\.toFixed\(1\)\+" C"/);
  assert.match(windowsJs, /ctx\.globalCompositeOperation="lighter"/);
  assert.match(windowsJs, /drawHydraPortal\(now,portalRatio\)/);
  assert.match(windowsJs, /document\.body\.classList\.add\("is-settling"\)/);
  assert.match(windowsJs, /hydraSplashDiagnostics\.physicsSteps\+=steps/);
  assert.doesNotMatch(windowsJs, /Run\.create/);
  assert.doesNotMatch(windowsJs, /Run\.run/);
  assert.doesNotMatch(windowsJs, /Run\.stop/);
});

test('vault status totals avoid self-nested account lookups', () => {
  const vault = readRepoFile('src/pages/Vault.jsx');

  assert.match(vault, /const statusSource = \(account\) => liveStatuses\?\.\[account\.id\] \|\| account\.sessionStatus/);
  assert.match(vault, /accounts\.filter\(\(a\) => statusSource\(a\) === 'active'\)/);
  assert.doesNotMatch(vault, /statusSource\(id\)[\s\S]*accounts\.find\(\(a\) => a\.id === id\)/);
});

test('ScrambleText clears delayed intervals on unmount', () => {
  const source = readRepoFile('src/components/ScrambleText.jsx');

  assert.match(source, /let interval = null/);
  assert.match(source, /interval = setTrackedInterval\('ScrambleText\.reveal', \(\) => \{/);
  assert.match(source, /if \(interval\) clearTrackedInterval\(interval\)/);
  assert.doesNotMatch(source, /return \(\) => clearInterval\(interval\);\s*\}, delay\)/);
});

test('short-lived renderer feedback timers are cleared on unmount', () => {
  const diagnostics = readRepoFile('src/lib/runtimeDiagnostics.js');
  const ownedTimeouts = readRepoFile('src/hooks/useOwnedTimeouts.js');
  const visibleRecurring = readRepoFile('src/hooks/useVisibleRecurringTask.js');
  const app = readRepoFile('src/App.jsx');
  const accountDetail = readRepoFile('src/pages/AccountDetail.jsx');
  const settings = readRepoFile('src/pages/Settings.jsx');
  const codeRedemption = readRepoFile('src/pages/CodeRedemption.jsx');
  const poolManager = readRepoFile('src/pages/PoolManager.jsx');
  const diagnosticsPage = readRepoFile('src/pages/Diagnostics.jsx');
  const createdKeyModal = readRepoFile('src/components/CreatedKeyModal.jsx');
  const devBackendHint = readRepoFile('src/components/DevBackendHint.jsx');
  const registerKeyModal = readRepoFile('src/components/RegisterKeyModal.jsx');
  const otpTab = readRepoFile('src/components/OtpTab.jsx');

  assert.match(diagnostics, /__HYDRA_RENDERER_DIAGNOSTICS__/);
  assert.match(diagnostics, /activeTotal: timeouts\.active \+ intervals\.active \+ animationFrames\.active \+ animations\.active/);
  assert.match(diagnostics, /setTrackedTimeout\(owner, fn, ms\)/);
  assert.match(diagnostics, /setTrackedInterval\(owner, fn, ms\)/);
  assert.match(diagnostics, /requestTrackedAnimationFrame\(owner, fn\)/);
  assert.match(ownedTimeouts, /timersRef = useRef\(new Set\(\)\)/);
  assert.match(ownedTimeouts, /clearTrackedTimeout\(timer\)/);
  assert.match(ownedTimeouts, /timersRef\.current\.delete\(timer\)/);
  assert.match(visibleRecurring, /document\.addEventListener\('visibilitychange', handleVisibility\)/);
  assert.match(visibleRecurring, /if \(document\.hidden\) \{[\s\S]*clear\(\);[\s\S]*abort\(\);/);
  assert.match(visibleRecurring, /if \(cancelled \|\| document\.hidden\) return/);
  assert.match(app, /useOwnedTimeouts/);
  assert.doesNotMatch(app, /setTimeout\(\(\) => setToasts/);
  assert.match(accountDetail, /copyTimerRef = useRef\(null\)/);
  assert.match(accountDetail, /transientTimersRef = useRef\(new Set\(\)\)/);
  assert.match(accountDetail, /for \(const timer of transientTimersRef\.current\) clearTrackedTimeout\(timer\)/);
  assert.match(settings, /copiedTimerRef = useRef\(null\)/);
  assert.match(settings, /if \(copiedTimerRef\.current\) clearTrackedTimeout\(copiedTimerRef\.current\)/);
  assert.match(codeRedemption, /historyRefreshTimerRef = useRef\(null\)/);
  assert.match(codeRedemption, /if \(historyRefreshTimerRef\.current\) clearTrackedTimeout\(historyRefreshTimerRef\.current\)/);
  assert.match(poolManager, /copyResetTimerRef = useRef\(null\)/);
  assert.match(poolManager, /modelCopyResetTimerRef = useRef\(null\)/);
  assert.match(diagnosticsPage, /copiedResetTimerRef = useRef\(null\)/);
  assert.match(createdKeyModal, /copiedResetTimerRef = useRef\(null\)/);
  assert.match(devBackendHint, /copyResetTimerRef = useRef\(null\)/);
  assert.match(registerKeyModal, /focusTimerRef = useRef\(null\)/);
  assert.match(otpTab, /copyStatusTimerRef\.current = null/);
});

test('renderer auto-refresh timers pause instead of waking while hidden', () => {
  const app = readRepoFile('src/App.jsx');
  const useMetrics = readRepoFile('src/hooks/useMetrics.js');
  const useTraffic = readRepoFile('src/hooks/useTraffic.js');
  const vault = readRepoFile('src/pages/Vault.jsx');

  assert.match(app, /useVisibleRecurringTask\('App\.upstreamHealth', refreshUpstreamHealth, 30_000, \{ enabled: authState === 'app' \}\)/);
  assert.match(useMetrics, /useVisibleRecurringTask\('useMetrics\.autoRefresh', refreshVisibleDashboard, 5 \* 60 \* 1000\)/);
  assert.match(useTraffic, /useVisibleRecurringTask\('useTraffic\.autoRefresh', refreshVisibleTraffic, 30000\)/);
  assert.match(vault, /useVisibleRecurringTask\('Vault\.autoRefresh', refreshVisibleVault, 10 \* 60 \* 1000\)/);
  assert.doesNotMatch(app, /if \(document\.hidden \|\| inFlight\) return/);
  assert.doesNotMatch(useMetrics, /if \(!document\.hidden\) await fetchDashboard/);
  assert.doesNotMatch(useTraffic, /if \(!document\.hidden\) await fetchTraffic/);
  assert.doesNotMatch(vault, /if \(!document\.hidden\) await loadAccounts/);
});

test('renderer visible refresh work aborts when hidden or unmounted', () => {
  const app = readRepoFile('src/App.jsx');
  const api = readRepoFile('src/api.js');
  const visibleRecurring = readRepoFile('src/hooks/useVisibleRecurringTask.js');
  const metrics = readRepoFile('src/hooks/useMetrics.js');
  const traffic = readRepoFile('src/hooks/useTraffic.js');
  const vault = readRepoFile('src/pages/Vault.jsx');

  assert.match(visibleRecurring, /const taskController = new AbortController\(\)/);
  assert.match(visibleRecurring, /await task\(taskController\.signal\)/);
  assert.match(visibleRecurring, /if \(document\.hidden\) \{[\s\S]*clear\(\);[\s\S]*abort\(\);/);
  assert.match(visibleRecurring, /cancelled = true;[\s\S]*clear\(\);[\s\S]*abort\(\);/);

  assert.match(api, /function wait\(ms, signal\)/);
  assert.match(api, /clearTrackedTimeout\(timer\)/);
  assert.match(api, /getDashboard = \(signal\) => request\('\/dashboard', \{ signal \}\)/);
  assert.match(api, /getDashboardQuiet = \(signal\) => request\('\/dashboard', \{ signal, trackLoading: false \}\)/);
  assert.match(api, /getSessionStatus = \(id, signal\) => request\(`\/accounts\/\$\{id\}\/session-status`, \{ signal \}\)/);
  assert.match(api, /getSessionStatusQuiet = \(id, signal\) =>\s*request\(`\/accounts\/\$\{id\}\/session-status`, \{ signal, trackLoading: false \}\)/);
  assert.match(api, /getTraffic = \(signal\) => request\('\/pool\/traffic', \{ signal \}\)/);
  assert.match(api, /getTrafficQuiet = \(signal\) => request\('\/pool\/traffic', \{ signal, trackLoading: false \}\)/);
  assert.match(api, /getSystemHealth = \(signal\) => request\('\/system\/health', \{ signal \}\)/);
  assert.match(api, /getSystemHealthQuiet = \(signal\) => request\('\/system\/health', \{ signal, trackLoading: false \}\)/);

  assert.match(app, /api\.getSystemHealthQuiet\(signal\)/);
  assert.match(metrics, /requestAbortRef\.current\?\.abort\(\)/);
  assert.match(metrics, /quietLoading \? api\.getDashboardQuiet : api\.getDashboard/);
  assert.match(metrics, /quietLoading \? api\.getPoolSyncStatusQuiet : api\.getPoolSyncStatus/);
  assert.match(metrics, /api\.getSessionStatusQuiet\(acct\.id, controller\.signal\)/);
  assert.match(metrics, /fetchDashboard\(true, signal, true\)/);
  assert.match(traffic, /requestAbortRef\.current\?\.abort\(\)/);
  assert.match(traffic, /quietLoading \? api\.getTrafficQuiet : api\.getTraffic/);
  assert.match(traffic, /fetchTraffic\(true, signal, true\)/);
  assert.match(vault, /loadAbortRef\.current\?\.abort\(\)/);
  assert.match(vault, /probeAbortRef\.current\?\.abort\(\)/);
  assert.match(vault, /quietLoading \? api\.getDashboardQuiet : api\.getDashboard/);
  assert.match(vault, /api\.getSessionStatusQuiet\(acct\.id, controller\.signal\)/);
  assert.match(vault, /loadAccounts\(true, signal, true\)/);
});

test('passive background observers avoid foreground loading animation', () => {
  const api = readRepoFile('src/api.js');
  const bulkAuth = readRepoFile('src/hooks/useBulkAuth.js');
  const codeRedemption = readRepoFile('src/pages/CodeRedemption.jsx');
  const generator = readRepoFile('src/pages/Generator.jsx');

  assert.match(api, /const \{ method = 'GET', body, skipAuth = false, signal, keepalive = false, trackLoading = true \} = options/);
  assert.match(api, /checkSessionLive = \(id, signal\) => request\(`\/accounts\/\$\{id\}\/session-check`, \{ signal \}\)/);
  assert.match(api, /checkSessionLiveQuiet = \(id, signal\) =>\s*request\(`\/accounts\/\$\{id\}\/session-check`, \{ signal, trackLoading: false \}\)/);
  assert.match(api, /getMagicLinkStatusQuiet = \(id, signInId, signal\) =>\s*request\(`\/accounts\/\$\{id\}\/magic-link\/status\/\$\{encodeURIComponent\(signInId\)\}`, \{ signal, trackLoading: false \}\)/);
  assert.match(api, /getGeneratorJobStatusQuiet = \(taskId, signal\) =>\s*request\(`\/generator\/status\/\$\{taskId\}`, \{ signal, trackLoading: false \}\)/);
  assert.match(api, /heartbeatGeneratorJobQuiet = \(taskId, signal\) =>\s*request\(`\/generator\/\$\{taskId\}\/heartbeat`, \{ method: 'POST', signal, trackLoading: false \}\)/);
  assert.match(api, /getPoolSyncStatusQuiet = \(signal\) => request\('\/pool\/sync-status', \{ signal, trackLoading: false \}\)/);
  assert.match(api, /preflightRedeemAccountsQuiet = \(accountIds, signal\) =>\s*request\('\/codes\/preflight', \{ method: 'POST', body: \{ accountIds \}, signal, trackLoading: false \}\)/);
  assert.match(api, /getRedemptionLogsQuiet = \(signal\) => request\('\/codes\/history', \{ signal, trackLoading: false \}\)/);
  assert.match(bulkAuth, /api\.getMagicLinkStatusQuiet\(poll\.accountId, poll\.signInId, signal\)/);
  assert.match(bulkAuth, /api\.checkSessionLiveQuiet\(poll\.accountId, signal\)/);
  assert.doesNotMatch(bulkAuth, /api\.getMagicLinkStatus\(poll\.accountId, poll\.signInId, signal\)/);
  assert.match(codeRedemption, /api\.preflightRedeemAccountsQuiet\(ids, signal\)/);
  assert.match(codeRedemption, /fetchHistory\(signal, true\)/);
  assert.match(codeRedemption, /quietLoading \? api\.getRedemptionLogsQuiet : api\.getRedemptionLogs/);
  assert.match(generator, /api\.getGeneratorJobStatusQuiet\(taskId, controller\.signal\)/);
  assert.match(generator, /api\.heartbeatGeneratorJobQuiet\(taskId, controller\.signal\)/);
});

test('Pool Manager aborts status probes on refresh and unmount', () => {
  const pools = readRepoFile('src/hooks/usePools.js');
  const api = readRepoFile('src/api.js');

  assert.match(pools, /proxyStatusAbortRef\.current\?\.abort\(\)/);
  assert.match(pools, /poolDataAbortRef\.current\?\.abort\(\)/);
  assert.match(pools, /const controller = new AbortController\(\)/);
  assert.match(pools, /api\.getPoolData\(controller\.signal\)/);
  assert.match(pools, /api\.getMasterKey\(controller\.signal\)/);
  assert.match(pools, /api\.getPoolModels\(controller\.signal\)/);
  assert.match(pools, /api\.getPoolSyncStatus\(controller\.signal\)/);
  assert.match(pools, /api\.getProxyStatus\(controller\.signal\)/);
  assert.match(pools, /api\.getPoolStatus\(controller\.signal\)/);
  assert.match(pools, /if \(unmountedRef\.current \|\| proxyStatusAbortRef\.current !== controller\) return/);
  assert.match(pools, /finally \{[\s\S]*clearTrackedTimeout\(timeoutTimer\)/);
  assert.match(pools, /return \(\) => \{[\s\S]*unmountedRef\.current = true;[\s\S]*proxyStatusAbortRef\.current\?\.abort\(\)/);
  assert.doesNotMatch(pools, /Promise\.race\(\[api\.getPoolStatus/);
  assert.match(api, /getPoolData = \(signal\) => request\('\/pool', \{ signal \}\)/);
  assert.match(api, /getPoolStatus = \(signal\) => request\('\/pool\/status', \{ signal \}\)/);
  assert.match(api, /getMasterKey = \(signal\) => request\('\/pool\/master-key', \{ signal \}\)/);
  assert.match(api, /getPoolModels = \(signal\) => request\('\/pool\/models', \{ signal \}\)/);
  assert.match(api, /getPoolSyncStatus = \(signal\) => request\('\/pool\/sync-status', \{ signal \}\)/);
  assert.match(api, /getProxyStatus = \(signal\) => request\('\/system\/proxy-status', \{ signal \}\)/);
});

test('global form controls cannot fall back to white native browser styling', () => {
  const css = readRepoFile('src/index.css');

  assert.match(css, /input,\s*\ntextarea,\s*\nselect,\s*\n\.input\s*\{/);
  assert.match(css, /input,[\s\S]*?\.input\s*\{[\s\S]*?background:\s*var\(--bg-tertiary\);/);
  assert.match(css, /input,[\s\S]*?\.input\s*\{[\s\S]*?color:\s*var\(--text-primary\);/);
  assert.match(css, /input,[\s\S]*?\.input\s*\{[\s\S]*?color-scheme:\s*dark;/);
  assert.match(css, /input:-webkit-autofill,[\s\S]*?box-shadow:\s*0 0 0 1000px var\(--bg-tertiary\) inset;/);
  assert.doesNotMatch(css, /var\(--bg-hover\)/);
});

test('settings exposes encrypted account proxy pool controls', () => {
  const settings = readRepoFile('src/pages/Settings.jsx');
  const api = readRepoFile('src/api.js');

  assert.match(settings, /Account Proxy Pool/);
  assert.match(settings, /ip:port:user:pass/);
  assert.match(settings, /Save Proxies/);
  assert.match(settings, /Stored encrypted/);
  assert.match(settings, /including direct HTTPS and browser fallback/);
  assert.match(settings, /api\.getAccountProxies\(\)/);
  assert.match(settings, /api\.setAccountProxies\(accountProxies\)/);
  assert.match(api, /getAccountProxies/);
  assert.match(api, /setAccountProxies/);
});

test('settings explains the bounded desktop unlock window', () => {
  const settings = readRepoFile('src/pages/Settings.jsx');

  assert.match(settings, /Successful unlocks persist for up to 24 hours on this device\./);
});

test('traffic and panel headers keep readable foreground contrast over the background', () => {
  const css = readRepoFile('src/index.css');
  const traffic = readRepoFile('src/pages/Traffic.jsx');

  assert.match(css, /\.page-header--panel\s*\{[\s\S]*?rgba\(3,\s*5,\s*9,\s*0\.94\)/);
  assert.match(css, /\.page-header h2\s*\{[\s\S]*?color:\s*var\(--text-primary\);/);
  assert.match(css, /\.page-header h2\s*\{[\s\S]*?text-shadow:/);
  assert.match(css, /\.traffic-page \.page-header--panel\s*\{[\s\S]*?rgba\(3,\s*6,\s*12,\s*0\.96\)/);
  assert.match(traffic, /variant="scanline"/);
  assert.match(css, /\.anime-text--scanline \.char,[\s\S]*?text-shadow:/);
  assert.doesNotMatch(css, /letter-spacing:\s*-0\.04em/);
});

test('AnimeText uses current splitText addEffect cleanup pattern', () => {
  const animeText = readRepoFile('src/components/AnimeText.jsx');

  assert.match(animeText, /import \{ animate, createTimeline, splitText, stagger \} from 'animejs';/);
  assert.match(animeText, /splitOptions\.lines = \{ wrap: 'clip' \}/);
  assert.match(animeText, /splitter\.addEffect/);
  assert.match(animeText, /\(\{ lines, words, chars \}\)/);
  assert.match(animeText, /createTimeline/);
  assert.match(animeText, /variant === 'signal'/);
  assert.match(animeText, /stagger\(delay, \{ from: 'first' \}\)/);
  assert.match(animeText, /stagger\(Math\.max\(6, Math\.floor\(delay \/ 2\)\), \{ from: 'last' \}\)/);
  assert.match(animeText, /trackRendererAnimation\(`AnimeText\.\$\{variant\}`, animation\)/);
  assert.match(animeText, /for \(const dispose of animationDisposers\.splice\(0\)\) dispose\(\)/);
  assert.match(animeText, /splitter\.revert\(\)/);
  assert.match(animeText, /prefers-reduced-motion: reduce/);
});

test('primary page headers use the shared AnimeText treatment', () => {
  const pages = [
    ['src/pages/Dashboard.jsx', /<AnimeText as="h1" mode="words" variant="signal"[\s\S]*Command<\/AnimeText>/],
    ['src/pages/Vault.jsx', /<AnimeText as="h2" mode="words" variant="scanline"[\s\S]*Vault<\/AnimeText>/],
    ['src/pages/Settings.jsx', /<AnimeText as="h2" mode="words" variant="scanline"[\s\S]*Settings<\/AnimeText>/],
    ['src/pages/Diagnostics.jsx', /<AnimeText as="h2" mode="words" variant="scanline"[\s\S]*Diagnostics<\/AnimeText>/],
    ['src/pages/PoolManager.jsx', /<AnimeText mode="words" variant="scanline"[\s\S]*Pool Manager<\/AnimeText>/],
    ['src/pages/BulkAuthWizard.jsx', /<AnimeText as="h2" mode="lines" variant="scanline"[\s\S]*Bulk Account Import<\/AnimeText>/],
    ['src/pages/CodeRedemption.jsx', /<AnimeText as="h2" mode="words"[\s\S]*Code Redeemer<\/AnimeText>/],
    ['src/pages/Generator.jsx', /<AnimeText as="h2" mode="words" variant="scanline"[\s\S]*Account Generator<\/AnimeText>/],
    ['src/pages/Traffic.jsx', /<AnimeText as="h2" mode="chars" variant="scanline"[\s\S]*Traffic Console<\/AnimeText>/],
  ];

  for (const [path, pattern] of pages) {
    assert.match(readRepoFile(path), pattern, `${path} should animate its primary header`);
  }
});

test('global app shell polish keeps dense desktop layout stable', () => {
  const css = readRepoFile('src/index.css');

  assert.match(css, /body\s*\{[\s\S]*?linear-gradient\(90deg, rgba\(0,\s*229,\s*255,\s*0\.035\) 1px, transparent 1px\)/);
  assert.match(css, /\.sidebar\s*\{[\s\S]*?rgba\(9,\s*10,\s*13,\s*0\.96\)/);
  assert.match(css, /\.nav-link\s*\{[\s\S]*?min-height:\s*44px;/);
  assert.match(css, /\.nav-link\.active\s*\{[\s\S]*?inset 3px 0 0 var\(--accent-secondary\)/);
  assert.match(css, /\.main-content\s*\{[\s\S]*?width:\s*min\(100%, 1400px\);/);
  assert.match(css, /\.page-header\s*\{[\s\S]*?gap:\s*var\(--space-md\);/);
  assert.match(css, /\.anime-text--signal \.char,[\s\S]*?text-shadow:/);
});

test('dashboard command center uses live fleet health data and compact account cards', () => {
  const dashboard = readRepoFile('src/pages/Dashboard.jsx');
  const accountCard = readRepoFile('src/components/AccountCard.jsx');
  const css = readRepoFile('src/index.css');

  assert.match(dashboard, /<AnimeText as="h1"[\s\S]*>Command<\/AnimeText>/);
  assert.match(dashboard, /className=\{`fleet-status-pill fleet-status-pill--\$\{statusClass\}`\}/);
  assert.match(dashboard, /className="dashboard-last-sync"/);
  assert.match(dashboard, /\{refreshing \? 'Syncing\.\.\.' : 'Sync'\}/);
  assert.match(dashboard, />Add Account<\/span>/);
  assert.match(dashboard, /const dashboardView = useMemo\(\(\) => \{/);
  assert.match(dashboard, /fleetHealth: getFleetHealth\(accounts, liveStatuses\)/);
  assert.match(dashboard, /activity: getDashboardActivity\(accounts, liveStatuses, cooldownMap\)/);
  assert.match(dashboard, /className="dashboard-command-layout"/);
  assert.match(dashboard, /<FleetHealthPanel[\s\S]*fleetHealth=\{fleetHealth\}/);
  assert.match(dashboard, /data-testid="fleet-health-donut"/);
  assert.match(dashboard, /strokeDasharray=\{`\$\{healthyLen\} \$\{circumference\}`\}/);
  assert.match(dashboard, /<ActivityPanel events=\{activity\} \/>/);
  assert.match(dashboard, /className="accounts-grid dashboard-mini-grid proximity-field"/);
  assert.match(dashboard, /<AccountCard[\s\S]*compact\s*\/>/);
  assert.match(dashboard, /className="dashboard-view-toggle"/);
  assert.match(dashboard, /<span className="active">GRID<\/span>/);
  assert.match(dashboard, /<span>LIST<\/span>/);
  assert.match(dashboard, /<span>MAP<\/span>/);
  assert.doesNotMatch(dashboard, /dashboard-stats-strip/);
  assert.doesNotMatch(dashboard, /<SummaryCard/);
  assert.match(dashboard, /function getFleetHealth\(accounts, liveStatuses = \{\}\)/);
  assert.match(dashboard, /function getDashboardActivity\(accounts, liveStatuses = \{\}, cooldownMap = \{\}\)/);
  assert.match(dashboard, /function getLastSyncLabel\(accounts\)/);
  assert.match(dashboard, /function formatHeaderSyncLabel\(label\)/);

  assert.match(accountCard, /compact = false/);
  assert.match(accountCard, /account-card--compact/);
  assert.match(accountCard, /\{!compact && \(/);
  assert.match(accountCard, /<div className="account-card-auth-wrap">/);
  assert.match(accountCard, /function areAccountCardPropsEqual\(prevProps, nextProps\)/);
  assert.match(accountCard, /prevProps\.liveStatuses\?\.\[accountId\] !== nextProps\.liveStatuses\?\.\[accountId\]/);
  assert.match(accountCard, /\}, areAccountCardPropsEqual\);/);

  assert.match(css, /\.dashboard-command-layout\s*\{/);
  assert.match(css, /\.dashboard-command-actions\s*\{/);
  assert.match(css, /\.dashboard-last-sync\s*\{/);
  assert.match(css, /\.dashboard-view-toggle\s*\{/);
  assert.match(css, /\.fleet-donut-ready\s*\{[\s\S]*?var\(--status-success\)/);
  assert.match(css, /\.fleet-donut-attention\s*\{[\s\S]*?var\(--status-warning\)/);
  assert.match(css, /\.fleet-donut-error\s*\{[\s\S]*?var\(--status-error\)/);
  assert.match(css, /\.activity-row--warning\s*\{[\s\S]*?var\(--status-warning\)/);
  assert.match(css, /\.account-card--compact\s*\{/);
  assert.match(css, /\.dashboard-mini-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
  assert.doesNotMatch(css, /\.dashboard-stats-strip\s*\{/);
  assert.match(css, /@media \(max-width: 1120px\)[\s\S]*?\.dashboard-command-layout\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.dashboard-mini-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);
});

test('Pool Manager list rows use stable callback props so React memoization remains effective', () => {
  const pools = readRepoFile('src/hooks/usePools.js');
  const poolManager = readRepoFile('src/pages/PoolManager.jsx');
  const accountRow = readRepoFile('src/components/AccountRow.jsx');
  const keyRow = readRepoFile('src/components/KeyRow.jsx');

  assert.match(pools, /const handleToggleKey = useCallback\(async \(hash, isPooled\) => \{/);
  assert.match(pools, /const handleAutoProvision = useCallback\(async \(accountId\) => \{/);
  assert.match(pools, /const handleSyncKeys = useCallback\(async \(accountId\) => \{/);
  assert.match(pools, /const handleDisableKey = useCallback\(async \(hash, currentlyEnabled\) => \{/);
  assert.match(pools, /const handleDeleteKey = useCallback\(async \(hash\) => \{/);
  assert.match(poolManager, /const onRegisterKey = useCallback\(\(hash, name\) => setRegistering\(\{ hash, name \}\), \[\]\)/);
  assert.match(poolManager, /const onAccountAction = useCallback\(\(id, action\) => \{/);
  assert.match(poolManager, /onRegisterKey=\{onRegisterKey\}/);
  assert.match(poolManager, /onAccountAction=\{onAccountAction\}/);
  assert.match(accountRow, /const AccountRow = memo\(function AccountRow\(/);
  assert.match(keyRow, /const KeyRow = memo\(function KeyRow\(/);
});

test('every source JSX button has an executable action or form submit contract', () => {
  const files = listFiles('src', (file) => /\.(jsx|js)$/.test(file));
  const issues = [];

  for (const file of files) {
    const source = readRepoFile(file);
    for (const match of source.matchAll(/<button\b[\s\S]*?>/g)) {
      const tag = match[0];
      const hasAction =
        /\bonClick\s*=/.test(tag) ||
        /\bonMouseDown\s*=/.test(tag) ||
        /\bonPointerDown\s*=/.test(tag) ||
        /\btype\s*=\s*["']submit["']/.test(tag) ||
        /\btype\s*=\s*["']reset["']/.test(tag) ||
        /\bformAction\s*=/.test(tag);
      if (!hasAction) {
        const line = source.slice(0, match.index).split('\n').length;
        issues.push(`${file}:${line}: ${tag.replace(/\s+/g, ' ').slice(0, 140)}`);
      }
    }
  }

  assert.deepEqual(issues, []);
});

test('every source JSX button declares an explicit button type', () => {
  const files = listFiles('src', (file) => /\.(jsx|js)$/.test(file));
  const issues = [];

  for (const file of files) {
    const source = readRepoFile(file);
    for (const match of source.matchAll(/<button\b[\s\S]*?>/g)) {
      const tag = match[0];
      const typeAttrs = tag.match(/\btype\s*=/g) ?? [];
      if (typeAttrs.length !== 1) {
        const line = source.slice(0, match.index).split('\n').length;
        issues.push(`${file}:${line}: ${tag.replace(/\s+/g, ' ').slice(0, 140)}`);
      }
    }
  }

  assert.deepEqual(issues, []);
});

test('active source JSX buttons do not guard required click handlers into silent no-ops', () => {
  const files = listFiles('src', (file) => /\.(jsx|js)$/.test(file));
  const issues = [];
  const guardedHandlerPattern = /onClick=\{\s*\(\s*[^)]*\s*\)\s*=>\s*on[A-Z][A-Za-z0-9_]*\s*&&\s*on[A-Z][A-Za-z0-9_]*\s*\(/g;

  for (const file of files) {
    const source = readRepoFile(file);
    for (const match of source.matchAll(guardedHandlerPattern)) {
      const line = source.slice(0, match.index).split('\n').length;
      issues.push(`${file}:${line}: ${match[0].replace(/\s+/g, ' ')}`);
    }
  }

  assert.deepEqual(issues, []);
});

test('generator keeps instructions compact instead of a second desktop-sized panel', () => {
  const generator = readRepoFile('src/pages/Generator.jsx');
  const css = readRepoFile('src/index.css');

  assert.match(generator, /className="generator-steps"/);
  assert.match(generator, /1\. Email alias/);
  assert.doesNotMatch(generator, /className="card generator-instructions/);
  assert.match(css, /\.generator-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(css, /\.generator-steps\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/);
});

test('first-run setup is a guided password key tour instead of a login dead end', () => {
  const app = readRepoFile('src/App.jsx');
  const css = readRepoFile('src/index.css');

  assert.match(app, /const \[setupStage, setSetupStage\] = useState\('password'\)/);
  assert.match(app, /setSetupStage\('key'\)/);
  assert.match(app, /async function handleManagementKeySubmit/);
  assert.match(app, /api\.addAccount\(trimmedAlias, trimmedKey\)/);
  assert.match(app, /Paste a management key or skip this step/);
  assert.match(app, /setSetupStage\('tour'\)/);
  assert.match(app, /Enter Dashboard/);
  assert.match(app, /onSuccess\(\)/);
  assert.match(css, /\.setup-stepper\s*\{/);
  assert.match(css, /\.setup-management-key-input\s*\{/);
  assert.match(css, /\.setup-tour\s*\{/);
});

test('desktop auth bootstrap renders password fallback while Touch ID release is pending', () => {
  const app = readRepoFile('src/App.jsx');
  const checkAuthStart = app.indexOf('const checkAuth = useCallback(async () => {');
  const checkAuthEnd = app.indexOf('\n  useEffect(() => {\n    checkAuth();', checkAuthStart);
  const checkAuth = app.slice(checkAuthStart, checkAuthEnd);

  assert.notEqual(checkAuthStart, -1);
  assert.notEqual(checkAuthEnd, -1);
  assert.ok(
    checkAuth.indexOf('const initialRes = await api.getAuthStatus()') < checkAuth.indexOf('storedToken = await api.hydrateToken()'),
    'server auth status must render before the optional native Touch ID token gate',
  );
  assert.match(checkAuth, /const initialState = renderAuthPayload\(initialPayload\)/);
  assert.match(checkAuth, /if \(initialState !== 'login'\) return/);
  assert.match(checkAuth, /authStateRef\.current !== 'login'/);
  assert.match(checkAuth, /Persisted desktop unlock unavailable/);
  assert.match(app, /authBootstrapRef\.current \+= 1/);
});

test('sidebar navigation paths are backed by concrete routes', () => {
  const app = readRepoFile('src/App.jsx');
  const navStart = app.indexOf('const navItems = [');
  assert.notEqual(navStart, -1);
  const navEnd = app.indexOf('];', navStart);
  const navBlock = app.slice(navStart, navEnd);

  const navPaths = [...navBlock.matchAll(/path:\s*'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(navPaths, [
    '/dashboard',
    '/bulk-auth',
    '/vault',
    '/pool',
    '/codes',
    '/generator',
    '/traffic',
    '/settings',
  ]);

  const routePaths = new Set([...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]));
  for (const path of navPaths) {
    assert.equal(routePaths.has(path), true, `${path} is missing a <Route>`);
  }

  assert.match(app, /<Route path="\/diagnostics" element=\{<Navigate to="\/settings#diagnostics" replace \/>\}/);
  assert.match(readRepoFile('src/pages/Settings.jsx'), /location\.hash !== '#diagnostics'/);
});

test('Electron document title follows the active app route', () => {
  const app = readRepoFile('src/App.jsx');

  assert.match(app, /location\.pathname\.startsWith\('\/account\/'\)/);
  assert.match(app, /'\/bulk-auth': 'Bulk Account Import'/);
  assert.match(app, /'\/pool': 'Pool Manager'/);
  assert.match(app, /'\/traffic': 'Traffic Console'/);
  assert.match(app, /location\.hash === '#diagnostics' \? 'Diagnostics' : 'Settings'/);
  assert.match(app, /document\.title = `Hydra — \$\{routeTitle\}`/);
  assert.match(app, /\}, \[location\.hash, location\.pathname\]\)/);
});

test('diagnostics are embedded in settings and present real server facts', () => {
  const settings = readRepoFile('src/pages/Settings.jsx');
  const diagnostics = readRepoFile('src/pages/Diagnostics.jsx');
  const systemController = readRepoFile('server/controllers/SystemController.js');

  assert.match(settings, /<DiagnosticsPanel addToast=\{addToast\} embedded \/>/);
  assert.match(settings, /id="diagnostics"/);
  assert.match(diagnostics, /Server Process Uptime:\s*\$\{formatUptime\(health\.uptime\)\}/);
  assert.match(diagnostics, /Server Started At:\s*\$\{health\.startedAt\}/);
  assert.match(diagnostics, /Server Clock:\s*\$\{health\.serverNow\}/);
  assert.match(diagnostics, /Server PID:\s*\$\{health\.pid\}/);
  assert.match(diagnostics, /Available \(dev runtime\)/);
  assert.doesNotMatch(diagnostics, /Placeholder/);
  assert.match(diagnostics, /const refreshAbortRef = useRef\(null\)/);
  assert.match(diagnostics, /refreshAbortRef\.current\?\.abort\(\)/);
  assert.match(diagnostics, /api\.getSystemHealth\(signal\)/);
  assert.match(diagnostics, /api\.getProxyStatus\(signal\)/);
  assert.match(diagnostics, /if \(!isCurrent\(\)\) return/);

  assert.match(systemController, /const uptime = process\.uptime\(\);/);
  assert.match(systemController, /const serverNow = new Date\(\);/);
  assert.match(systemController, /startedAt: new Date\(serverNow\.getTime\(\) - uptime \* 1000\)\.toISOString\(\)/);
  assert.match(systemController, /pid: process\.pid/);
});

test('settings toggles are backed by persisted native preferences', () => {
  const settings = readRepoFile('src/pages/Settings.jsx');
  const nativeBridge = readRepoFile('src/lib/native.js');
  const ipc = readRepoFile('electron/app/ipc.js');
  const prefs = readRepoFile('electron/app/userPrefs.js');
  const prefsTest = readRepoFile('server/tests/user-prefs.test.mjs');

  assert.match(settings, /tryNative\(native\.prefsGetAll\)/);
  assert.match(settings, /const resolvedBiometricInfo = biometricInfo \|\|/);
  assert.match(settings, /\{inElectron && \(/);
  assert.match(settings, /await native\.prefsSet\(key, value\)/);
  assert.match(settings, /setPrefs\(\(p\) => \(\{ \.\.\.\(p \|\| \{\}\), \[key\]: value \}\)\)/);
  assert.match(settings, /checked=\{Boolean\(prefs\?\.biometricEnabled\)\}/);
  assert.match(settings, /onChange=\{\(e\) => togglePref\('biometricEnabled', e\.target\.checked\)\}/);
  assert.match(settings, /checked=\{Boolean\(prefs\.telemetryEnabled\)\}/);
  assert.match(settings, /onChange=\{\(e\) => togglePref\('telemetryEnabled', e\.target\.checked\)\}/);

  assert.match(nativeBridge, /prefsGetAll: \(\) => invokeNative\('prefsGetAll'\)/);
  assert.match(nativeBridge, /prefsSet: \(key, value\) => invokeNative\('prefsSet', key, value\)/);
  assert.match(ipc, /ipcMain\.handle\('native:prefs:get-all'/);
  assert.match(ipc, /ipcMain\.handle\('native:prefs:set'/);
  assert.match(ipc, /await setPref\(key, value\)/);
  assert.match(ipc, /if \(key === 'telemetryEnabled'\) await setTelemetryEnabled\(value\)/);

  assert.match(prefs, /const DEFAULTS = Object\.freeze\(\{/);
  assert.match(prefs, /biometricEnabled: false/);
  assert.match(prefs, /telemetryEnabled: false/);
  assert.match(prefs, /await rename\(tmp, dest\)/);
  assert.match(prefsTest, /user preferences persist across cache reset and keep owner-only permissions/);
});

test('frontend API failures surface backend-down recovery guidance', () => {
  const api = readRepoFile('src/api.js');

  assert.match(api, /HYDRA_DEV_START_COMMAND\s*=\s*['"]npm run dev['"]/);
  assert.match(api, /HYDRA_DEV_API_ONLY_COMMAND\s*=\s*['"]npm run server['"]/);
  assert.match(api, /Hydra API unreachable/);
  assert.match(api, /Express backend is not running/);
  assert.match(api, /npm run dev \(starts API \+ UI together\)/);
  assert.match(api, /Hydra API unavailable\. Check that the local server is running\./);
  assert.match(api, /err\.hydraCopyCommand\s*=\s*HYDRA_DEV_START_COMMAND/);
  assert.match(api, /updateLoadingState\(\)/);
  assert.match(api, /trackLoading = true/);
  assert.match(api, /if \(trackLoading\) \{[\s\S]*activeRequests\+\+;[\s\S]*updateLoadingState\(\);[\s\S]*\}/);
  assert.match(api, /if \(trackLoading\) \{[\s\S]*activeRequests--;[\s\S]*updateLoadingState\(\);[\s\S]*\}/);
  assert.match(api, /INVALID_API_RESPONSE/);
  assert.match(api, /Hydra API returned an invalid response from \$\{path\} \(\$\{res\.status\}\)/);
  assert.match(api, /err\.cause = parseErr/);
  assert.match(api, /async function readAuthErrorPayload\(res, path\)/);
  assert.match(api, /Hydra API returned an invalid auth response from \$\{path\} \(\$\{res\.status\}\)/);
  assert.doesNotMatch(api, /res\.clone\(\)\.json\(\); errMsg = d\?\.error \|\| errMsg; \} catch \(err\) \{ void err; \}/);
});

test('authenticated app shell surfaces upstream offline state without hiding cached local data', () => {
  const app = readRepoFile('src/App.jsx');
  const css = readRepoFile('src/index.css');
  const api = readRepoFile('src/api.js');
  const visibleRecurring = readRepoFile('src/hooks/useVisibleRecurringTask.js');

  assert.match(api, /export const getSystemHealthQuiet = \(signal\) => request\('\/system\/health', \{ signal, trackLoading: false \}\)/);
  assert.match(app, /function UpstreamStatusBanner\(\{ upstream \}\)/);
  assert.match(app, /OPENROUTER OFFLINE/);
  assert.match(app, /OPENROUTER STATUS UNKNOWN/);
  assert.match(app, /Cached local data remains available/);
  assert.match(app, /Proxy, provisioning, signup, OTP, and code redemption may fail until connectivity returns/);
  assert.match(app, /const \[upstreamHealth, setUpstreamHealth\] = useState\(null\)/);
  assert.match(app, /if \(authState !== 'app'\)/);
  assert.match(app, /authStateRef\.current !== 'app'/);
  assert.match(app, /api\.getSystemHealthQuiet\(signal\)/);
  assert.match(app, /useVisibleRecurringTask\('App\.upstreamHealth', refreshUpstreamHealth, 30_000, \{ enabled: authState === 'app' \}\)/);
  assert.match(visibleRecurring, /if \(document\.hidden\) \{[\s\S]*clear\(\);[\s\S]*abort\(\);/);
  assert.match(visibleRecurring, /clearTrackedTimeout\(timer\)/);
  assert.match(app, /<UpstreamStatusBanner upstream=\{upstreamHealth\} \/>/);

  assert.match(css, /\.upstream-banner\s*\{/);
  assert.match(css, /\.upstream-banner--offline\s*\{/);
  assert.match(app, /role="status"/);
  assert.match(app, /aria-live="polite"/);
});

test('clipboard actions await write failures instead of failing silently', () => {
  const files = [
    'src/pages/AccountDetail.jsx',
    'src/pages/Diagnostics.jsx',
    'src/pages/PoolManager.jsx',
    'src/pages/Settings.jsx',
    'src/components/CreatedKeyModal.jsx',
    'src/components/DevBackendHint.jsx',
    'src/components/OtpTab.jsx',
  ];

  for (const file of files) {
    const source = readRepoFile(file);
    const lines = source.split('\n');
    for (const [index, line] of lines.entries()) {
      if (!line.includes('clipboard') || !line.includes('writeText')) continue;
      assert.match(line, /await\s+navigator\.clipboard(?:\.|\?\.)writeText/, `${file}:${index + 1} does not await clipboard write`);
    }
  }

  const accountDetail = readRepoFile('src/pages/AccountDetail.jsx');
  const poolManager = readRepoFile('src/pages/PoolManager.jsx');
  const createdKeyModal = readRepoFile('src/components/CreatedKeyModal.jsx');
  const otpTab = readRepoFile('src/components/OtpTab.jsx');
  const settings = readRepoFile('src/pages/Settings.jsx');
  const devBackendHint = readRepoFile('src/components/DevBackendHint.jsx');
  const vault = readRepoFile('src/pages/Vault.jsx');
  const diagnostics = readRepoFile('src/pages/Diagnostics.jsx');
  const registerKeyModal = readRepoFile('src/components/RegisterKeyModal.jsx');
  const metrics = readRepoFile('src/hooks/useMetrics.js');
  const pools = readRepoFile('src/hooks/usePools.js');

  assert.match(accountDetail, /Clipboard copy failed/);
  assert.match(poolManager, /Copy failed/);
  assert.match(poolManager, /\[POOL_MANAGER\] Copy \$\{label\} failed:/);
  assert.match(poolManager, /\[POOL_MANAGER\] Copy model id failed for \$\{modelId\}:/);
  assert.match(createdKeyModal, /Clipboard copy failed/);
  assert.match(createdKeyModal, /Failed to add key to pool/);
  assert.match(otpTab, /Clipboard copy failed/);
  assert.match(settings, /if \(!didCopy\) return/);
  assert.match(settings, /Clipboard fallback copy failed/);
  assert.match(settings, /Failed to open \$\{label\}/);
  assert.match(devBackendHint, /Copy failed/);
  assert.match(devBackendHint, /Clipboard copy failed/);
  assert.match(vault, /session status probe\(s\) failed/);
  assert.match(vault, /\[VAULT\] Live session check before provisioning failed:/);
  assert.match(vault, /Live session check required before provisioning/);
  assert.doesNotMatch(vault, /provisioning readiness check\(s\) failed/);
  assert.match(accountDetail, /\[ACCOUNT_DETAIL\] Live session probe failed for/);
  assert.match(accountDetail, /Live session check failed\. Showing cached session state\./);
  assert.match(metrics, /\[METRICS\] Pool sync status unavailable:/);
  assert.match(metrics, /\[METRICS\] Display session probe failed for/);
  assert.match(metrics, /\[METRICS\] Provision session gate failed for/);
  assert.match(metrics, /Live session check failed before provisioning/);
  assert.match(metrics, /\[METRICS\] Silent refresh failed for/);
  assert.match(metrics, /silent refresh failed\. Sign in again/);
  assert.match(pools, /console\.warn\(`\[POOLS\] \$\{label\} unavailable:`/);
  assert.match(pools, /optionalPoolCall\('model catalog', api\.getPoolModels\(controller\.signal\)\)/);
  assert.match(pools, /optionalPoolCall\('sync status', api\.getPoolSyncStatus\(controller\.signal\)\)/);
  assert.match(pools, /optionalPoolCall\('proxy toggle status', api\.getProxyStatus\(controller\.signal\)\)/);
  assert.match(pools, /\[POOLS\] Proxy status probe failed:/);
  assert.match(diagnostics, /Diagnostics refresh incomplete:/);
  assert.match(diagnostics, /Support bundle copy failed/);
  assert.match(diagnostics, /Failed to open \$\{label\}/);
  assert.match(registerKeyModal, /Clipboard unavailable; paste the key manually\./);
});

test('Account Detail click handlers do not pass React events into AbortSignal parameters', () => {
  const accountDetail = readRepoFile('src/pages/AccountDetail.jsx');

  assert.doesNotMatch(accountDetail, /onClick=\{(?:probeSession|fetchSnapshot|fetchManagementKeys)\}/);
  assert.equal((accountDetail.match(/onClick=\{\(\) => void probeSession\(\)\}/g) || []).length, 2);
  assert.equal((accountDetail.match(/onClick=\{\(\) => void fetchSnapshot\(\)\}/g) || []).length, 2);
  assert.equal((accountDetail.match(/onClick=\{\(\) => void fetchManagementKeys\(\)\}/g) || []).length, 6);
});

test('non-fatal renderer cleanup and history failures stay visible', () => {
  const generator = readRepoFile('src/pages/Generator.jsx');
  const codeRedemption = readRepoFile('src/pages/CodeRedemption.jsx');

  assert.match(generator, /\[GENERATOR\] Cleanup failed:/);
  assert.match(generator, /addToast\?\.\(message, 'warning'\)/);
  assert.match(generator, /\[GENERATOR\] Keepalive cleanup failed:/);
  assert.doesNotMatch(generator, /cleanupGeneratorJob\(currentTaskId,[\s\S]*?\.catch\(\(\) => \{\}\)/);

  assert.match(codeRedemption, /const \[historyError, setHistoryError\] = useState\(''\)/);
  assert.match(codeRedemption, /\[CODES\] Redemption history failed:/);
  assert.match(codeRedemption, /Redemption history unavailable:/);
  assert.doesNotMatch(codeRedemption, /getRedemptionLogs\(\)[\s\S]*?\.catch\(\(\) => \{\}\)/);
});

test('native menu action feedback reaches renderer toasts', () => {
  const app = readRepoFile('src/App.jsx');
  const nativeBridge = readRepoFile('src/lib/native.js');

  assert.match(nativeBridge, /onMenuEvent: \(cb\) =>/);
  assert.match(app, /nativeBridge\.onMenuEvent/);
  assert.match(app, /type === 'native:copied-proxy-url'/);
  assert.match(app, /Proxy URL copied\./);
  assert.match(app, /type === 'native:copy-proxy-url-not-ready'/);
  assert.match(app, /Proxy URL is not ready yet/);
  assert.match(app, /type === 'native:clipboard-copy-failed'/);
  assert.match(app, /clipboard unavailable/);
});

test('app shell native and lifecycle fallbacks stay visible', () => {
  const app = readRepoFile('src/App.jsx');

  assert.match(app, /Upstream health refresh failed:/);
  assert.match(app, /Logout request failed before local lock:/);
  assert.match(app, /Server logout failed; local session was cleared\./);
  assert.match(app, /Hide window failed:/);
  assert.match(app, /Native quit failed; falling back to window\.close:/);
  assert.match(app, /Native shutdown failed; falling back to API shutdown:/);
  assert.match(app, /API shutdown request failed before window close:/);
  assert.doesNotMatch(app, /try \{ await api\.logout\(\); \} catch \{ \/\* fine \*\/ \}/);
  assert.doesNotMatch(app, /try \{ await api\.shutdownServer\(\); \} catch \{ \/\* ok \*\/ \}/);
});

test('active renderer UI does not ship obvious dead-button placeholders', () => {
  const files = [
    'src/App.jsx',
    'src/pages/AccountDetail.jsx',
    'src/pages/BulkAuthWizard.jsx',
    'src/pages/CodeRedemption.jsx',
    'src/pages/Dashboard.jsx',
    'src/pages/Diagnostics.jsx',
    'src/pages/Generator.jsx',
    'src/pages/PoolManager.jsx',
    'src/pages/Settings.jsx',
    'src/pages/Traffic.jsx',
    'src/pages/Vault.jsx',
    'src/components/AccountCard.jsx',
    'src/components/AccountRow.jsx',
    'src/components/AddAccountModal.jsx',
    'src/components/AttachSignInModal.jsx',
    'src/components/CreatedKeyModal.jsx',
    'src/components/DeleteKeyModal.jsx',
    'src/components/EmailLinkTab.jsx',
    'src/components/LoginAccountModal.jsx',
    'src/components/OtpTab.jsx',
    'src/components/PasteManagementKeyModal.jsx',
    'src/components/RegisterKeyModal.jsx',
  ];

  for (const file of files) {
    const source = readRepoFile(file);
    assert.doesNotMatch(source, /onClick=\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/, `${file} has an empty click handler`);
    assert.doesNotMatch(source, /href=["']#["']/, `${file} has a hash-only link`);
    assert.doesNotMatch(source, /alert\(/, `${file} uses alert() instead of app feedback`);
    assert.doesNotMatch(source, /coming soon|not implemented/i, `${file} exposes placeholder copy`);
  }
});

test('session ages are labeled as historical context while live probes show observation time', () => {
  const accountDetail = readRepoFile('src/pages/AccountDetail.jsx');
  const accountCard = readRepoFile('src/components/AccountCard.jsx');
  const vault = readRepoFile('src/pages/Vault.jsx');

  assert.match(accountDetail, /Live Clerk check \{liveSessionObservedAt \? timeAgo\(liveSessionObservedAt\) : ''\}/);
  assert.match(accountDetail, /Interactive sign-in/);
  assert.match(accountDetail, /last silent renewal/);
  assert.match(accountDetail, /Next local renewal checkpoint/);
  assert.match(accountDetail, /not the login's total lifetime/);
  assert.equal(
    (accountDetail.match(/hasCredentials && accountNeedsSession\(/g) || []).length,
    2,
    'Account Detail must hide re-auth recovery actions while a Clerk session is live',
  );
  assert.match(accountCard, />login \{timeAgo\(account\.lastLoginAt\)\}</);
  assert.match(vault, /login \{timeAgo\(acc\.lastLoginAt\)\}/);
  assert.match(vault, /Live probe: \$\{checkResults\[acc\.id\]\.observedAt\}/);
});

test('dashboard, sidebar, and settings actions use bounded reduced-motion-safe proximity fields', () => {
  const hook = readRepoFile('src/hooks/useProximityField.js');
  const app = readRepoFile('src/App.jsx');
  const dashboard = readRepoFile('src/pages/Dashboard.jsx');
  const settings = readRepoFile('src/pages/Settings.jsx');
  const accountCard = readRepoFile('src/components/AccountCard.jsx');
  const css = readRepoFile('src/index.css');

  assert.match(hook, /requestTrackedAnimationFrame\(owner, paint\)/);
  assert.match(hook, /Math\.hypot\(dx, dy\) \/ radius/);
  assert.match(hook, /prefers-reduced-motion: reduce/);
  assert.match(hook, /const geometryRef = useRef\(null\)/);
  assert.match(hook, /geometryRef\.current = Array\.from\(field\.querySelectorAll\(TARGET_SELECTOR\)/);
  assert.match(hook, /measureTargets\(\)\.forEach\(\(\{ target, bounds \}\) => \{/);
  assert.match(hook, /new ResizeObserver\(invalidateGeometry\)/);
  assert.match(hook, /new MutationObserver\(invalidateGeometry\)/);
  assert.match(hook, /observeField\(field\)/);
  assert.match(hook, /resizeObserverRef\.current\?\.disconnect\(\)/);
  assert.match(hook, /mutationObserverRef\.current\?\.disconnect\(\)/);
  assert.match(hook, /brightnessDelta = 0\.08/);
  assert.match(hook, /maxAttractX = 0/);
  assert.match(hook, /maxAttractY = 0/);
  assert.match(hook, /Math\.max\(-maxAttractX, Math\.min\(maxAttractX, dx \* strength \* 0\.12\)\)/);
  assert.match(hook, /Math\.max\(-maxAttractY, Math\.min\(maxAttractY, dy \* strength \* 0\.1\)\)/);
  assert.match(app, /owner: 'App\.sidebarNav'/);
  assert.match(app, /<div className="sidebar-bottom">[\s\S]*?data-proximity-target className="nav-link"/);
  assert.match(app, /data-studio="frostbyte-zayd-cold"/);
  assert.match(dashboard, /owner: 'Dashboard\.accountGrid'/);
  assert.match(dashboard, /maxAttractX: 10/);
  assert.match(dashboard, /maxAttractY: 8/);
  assert.match(dashboard, /owner: 'Dashboard\.commandActions'/);
  assert.match(settings, /owner: 'Settings\.actionGroup'/);
  assert.match(settings, /className="settings-grid"/);
  assert.match(accountCard, /data-proximity-target/);
  assert.match(css, /\.dashboard-mini-grid \.account-card\[data-proximity-target\]/);
  assert.match(css, /translateX\(var\(--proximity-attract-x\)\)[\s\S]*?translateY\(var\(--proximity-attract-y\)\)/);
  assert.match(css, /\.sidebar \.nav-link\[data-proximity-target\]/);
  assert.match(css, /\.action-proximity-group \[data-proximity-target\]/);
  assert.match(css, /\.settings-grid\s*\{[\s\S]*?grid-auto-rows:\s*1fr;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.proximity-field \[data-proximity-target\]/);
});
