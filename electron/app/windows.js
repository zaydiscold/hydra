/**
 * Hydra Electron — Splash & Main Window Creation
 *
 * Splash paints in <100 ms. Main window has navigation guards
 * and explicit webSecurity options.
 */
import { BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDev, ICON_PATH, LOCAL_UI_HOSTS } from './env.js';
import {
  getMainWindow, getWindowURL, getForceQuit, getShuttingDown, getClosePromptPending,
  setSplashWindow, setMainWindow, setForceQuit, setClosePromptPending,
  openExternalUrl,
} from './state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Splash Window — Pica-inspired randomized hex/crypto rain ────────────────
export function createSplashWindow() {
  const win = new BrowserWindow({
    width: 520,
    height: 340,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    icon: ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // ── Symbol pool: cyber-Tokyo / LLM proxy thematic ────────────────────
  // Short `Provider · model` strings (compact at small font sizes), a few
  // bare provider names for variety, and a sprinkle of katakana for the
  // cyber-Tokyo accent. Middle-dot separator gives reading rhythm.
  // Avoid long `meta-llama/llama-4` style — clips visually below 12px.
  const branded = [
    'OpenAI · gpt-4o', 'OpenAI · gpt-4.1',
    'Anthropic · claude-4.5', 'Anthropic · opus',
    'Google · gemini-2.5', 'Google · gemini-flash',
    'DeepSeek · r1', 'DeepSeek · v3',
    'Meta · llama-4', 'Meta · llama-3.3',
    'Mistral · large', 'Mistral · mixtral',
    'xAI · grok-2', 'Cohere · command-r',
  ];
  const providers = ['OpenRouter', 'Anthropic', 'OpenAI', 'Google', 'DeepSeek', 'Meta', 'Mistral'];
  const routes = ['/v1/chat', '/v1/models', '200 ok', '429 try', 'sk-hydra…', 'pool · 12'];
  // Cyber-Tokyo accent — katakana for proxy/route/connect/Hydra
  const katakana = ['ハイドラ', 'ルート', 'プロキシ', '接続', '通信', '応答'];
  const allTokens = [...branded, ...providers, ...routes, ...katakana];

  // ── Generate particles — varied sizes, speeds, opacities, paths ───────
  const particleTypes = ['rain', 'drift', 'spiral', 'pulse'];
  const particleCount = 38;
  const particles = Array.from({ length: particleCount }, (_, i) => {
    const type = particleTypes[i % particleTypes.length];
    const text = allTokens[(i * 7) % allTokens.length];
    const x = 3 + ((i * 17) % 88);
    const y = -10 - ((i * 23) % 80);
    const size = 9 + ((i % 5) * 2);
    // Higher opacity floor so tokens read as solid against the translucent
    // glass backdrop — the card no longer hides them under .97 alpha.
    const opacity = 0.32 + ((i % 6) * 0.08);
    const duration = 5 + ((i % 8) * 1.4) + Math.random() * 2;
    const delay = -(i * 0.31 % 8);
    // Hue band: cyber-Tokyo neon — magenta → cyan, with a hot-pink wedge.
    // 285 (violet) → 200 (cyan), occasional 320 (hot pink).
    const hue = (i % 9 === 0) ? 320 : (200 + (i * 19) % 90);
    const spinDir = (i % 2 === 0 ? 1 : -1);
    const spinDeg = 4 + ((i % 7) * 2);
    return `<span class="p ${type}" style="--x:${x};--y:${y};--s:${size}px;--o:${opacity};--t:${duration}s;--d:${delay}s;--h:${hue};--r:${spinDir * spinDeg}deg">${text}</span>`;
  }).join('');

  const splashHTML = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\' \'unsafe-inline\'"><style>'
    + 'html,body{margin:0;height:100%;background:transparent;font-family:\'SF Mono\',\'JetBrains Mono\',\'Fira Code\',monospace;color:#f8fbff;overflow:hidden}'
    // Frosted-glass card: translucent bg + backdrop-blur lets the desktop
    // bleed through, but the foreground tokens stay solid (high opacity).
    // Cyber-Tokyo aesthetic: magenta + cyan rim glow on a deep-violet base.
    + '.frame{position:absolute;inset:10px;border-radius:22px;background:linear-gradient(145deg,rgba(8,4,22,.55),rgba(18,4,32,.62) 50%,rgba(4,12,24,.55));backdrop-filter:blur(24px) saturate(140%);-webkit-backdrop-filter:blur(24px) saturate(140%);border:1px solid rgba(255,90,200,.18);box-shadow:0 28px 90px rgba(0,0,0,.55),0 0 60px rgba(255,61,180,.10),inset 0 1px 0 rgba(255,255,255,.14),inset 0 0 0 1px rgba(120,200,255,.06);overflow:hidden}'
    + '.frame:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 22% 18%,rgba(120,220,255,.14),transparent 32%),radial-gradient(circle at 82% 22%,rgba(255,80,200,.12),transparent 34%),linear-gradient(rgba(140,200,255,.04) 1px,transparent 1px);background-size:auto,auto,100% 10px;pointer-events:none}'
    + '.field{position:absolute;inset:-160px 0 0;mask-image:linear-gradient(transparent 0%,#000 12%,#000 84%,transparent 100%);overflow:hidden}'
    // Solid neon tokens against the glass — fixed lightness (66%) so colors
    // POP regardless of per-particle opacity. Tighter glow than before.
    + '.p{position:absolute;left:calc(var(--x)*1%);top:var(--y)%;color:hsl(var(--h),85%,66%);font:500 var(--s)/1 \'SF Mono\',\'JetBrains Mono\',\'Hiragino Sans\',monospace;text-shadow:0 0 8px hsl(var(--h),90%,60%,.85),0 0 18px hsl(var(--h),90%,55%,.4);white-space:pre;letter-spacing:0.02em}'
    // ── rain: fast vertical fall with spin ──
    + '.p.rain{animation:rain var(--t) cubic-bezier(.22,.74,.24,1) infinite;animation-delay:var(--d)}'
    + '@keyframes rain{0%{transform:translateY(-120px) rotate(var(--r));opacity:0}8%{opacity:calc(var(--o)+.3)}65%{opacity:calc(var(--o)+.15)}100%{transform:translateY(620px) rotate(calc(var(--r)*1.4));opacity:0}}'
    // ── drift: slow horizontal float ──
    + '.p.drift{animation:drift var(--t) ease-in-out infinite;animation-delay:var(--d)}'
    + '@keyframes drift{0%{transform:translateX(-60px) translateY(0);opacity:0}10%{opacity:calc(var(--o)+.2)}50%{transform:translateX(30px) translateY(-18px);opacity:calc(var(--o)+.1)}90%{opacity:calc(var(--o)+.15)}100%{transform:translateX(70px) translateY(12px);opacity:0}}'
    // ── spiral: circular-ish floating path ──
    + '.p.spiral{animation:spiral var(--t) ease-in-out infinite;animation-delay:var(--d)}'
    + '@keyframes spiral{0%{transform:translate(0,0) rotate(0deg);opacity:0}15%{opacity:calc(var(--o)+.25)}25%{transform:translate(40px,-30px) rotate(120deg)}50%{transform:translate(0,-50px) rotate(240deg)}75%{transform:translate(-40px,-30px) rotate(360deg)}90%{opacity:calc(var(--o)+.1)}100%{transform:translate(0,0) rotate(480deg);opacity:0}}'
    // ── pulse: fade-breathe at fixed position ──
    + '.p.pulse{animation:pulse var(--t) ease-in-out infinite;animation-delay:var(--d)}'
    + '@keyframes pulse{0%,100%{opacity:calc(var(--o)*.5)}40%{opacity:calc(var(--o)+.35)}60%{opacity:calc(var(--o)+.35)}}'
    // ── hero content ──
    + '.content{position:absolute;inset:0;display:grid;place-items:center;text-align:center;z-index:2}'
    + '.mark{position:relative;width:108px;height:108px;margin:0 auto 16px;border-radius:28px;background:linear-gradient(135deg,rgba(255,61,97,.94),rgba(109,72,255,.88) 44%,rgba(40,200,190,.90));box-shadow:0 18px 52px rgba(72,61,255,.32),0 0 0 1px rgba(255,255,255,.18) inset;display:grid;place-items:center}'
    + '.mark:before{content:"";position:absolute;inset:9px;border-radius:22px;background:rgba(3,6,12,.76);box-shadow:inset 0 1px 0 rgba(255,255,255,.14)}'
    + '.mark:after{content:"H";position:relative;font-size:56px;font-weight:900;color:#fff;text-shadow:0 0 28px rgba(255,255,255,.68)}'
    + 'h1{font-size:40px;font-weight:850;letter-spacing:-0.5px;margin:0 0 10px;background:linear-gradient(90deg,#fff 0%,#84e4ff 40%,#ff6b8a 80%,#fff 100%);-webkit-background-clip:text;background-clip:text;color:transparent;animation:shimmer 2.4s ease-in-out infinite}'
    + '@keyframes shimmer{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}'
    + '.sub{font-size:12px;font-weight:600;color:rgba(210,230,255,.56);margin-bottom:18px}'
    + '.bar{width:140px;height:4px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;margin:0 auto}'
    + '.bar i{display:block;width:36%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#3dd6ff,#ff3d6d);box-shadow:0 0 16px rgba(61,214,255,.7);animation:sweep 1.2s ease-in-out infinite}'
    + '@keyframes sweep{0%{transform:translateX(-130%)}55%{transform:translateX(120%)}100%{transform:translateX(260%)}}'
    + '</style></head><body><div class="frame"><div class="field">' + particles + '</div><div class="content"><div><div class="mark"></div><h1>HYDRA</h1><div class="sub">local proxy · starting</div><div class="bar"><i></i></div></div></div></div></body></html>';

  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHTML));
  win.once('closed', () => { setSplashWindow(null); });
  setSplashWindow(win);
}

// ─── Main Window ─────────────────────────────────────────────────────────────
export function createMainWindow({ show = false } = {}) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Hydra',
    icon: ICON_PATH,
    backgroundColor: '#0a0014',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      backgroundThrottling: true,
      devTools: isDev,
    },
    show,
  });

  win.on('close', async (event) => {
    if (getForceQuit() || getShuttingDown()) return;
    event.preventDefault();
    if (getClosePromptPending()) return;
    setClosePromptPending(true);
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Keep Proxy Running', 'Quit Hydra', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Keep Hydra running?',
      message: 'Keep Hydra running in the background?',
      detail: 'The window will close, but the local server and proxy stay online. Choose Quit Hydra to stop the proxy.',
    });
    setClosePromptPending(false);
    if (win.isDestroyed()) return;
    if (response === 0) { win.hide(); return; }
    if (response === 1) { setForceQuit(true); const { app } = await import('electron'); app.quit(); }
  });

  win.on('closed', () => { if (getMainWindow() === win) setMainWindow(null); });

  const isAllowedLocalUrl = (rawUrl) => {
    try {
      const parsed = new URL(rawUrl);
      const expected = getWindowURL() ? new URL(getWindowURL()) : null;
      return parsed.protocol === 'http:' && LOCAL_UI_HOSTS.has(parsed.hostname) && expected && parsed.origin === expected.origin;
    } catch { return false; }
  };

  win.webContents.on('will-navigate', (event, targetUrl) => { if (isAllowedLocalUrl(targetUrl)) return; event.preventDefault(); console.warn(`[electron] blocked navigation: ${targetUrl}`); });
  // #18: will-redirect fires on server 302 redirects. Without this handler,
  // redirect responses (e.g., login redirects from the API) would bypass the
  // will-navigate navigation guard, allowing unintended origins to load.
  win.webContents.on('will-redirect', (event, targetUrl) => { if (isAllowedLocalUrl(targetUrl)) return; event.preventDefault(); console.warn(`[electron] blocked redirect: ${targetUrl}`); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (isAllowedLocalUrl(url)) return { action: 'allow' }; void openExternalUrl(url); return { action: 'deny' }; });

  setMainWindow(win);
  return win;
}
