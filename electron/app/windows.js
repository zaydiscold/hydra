/**
 * Hydra Electron — Splash & Main Window Creation
 *
 * Splash: clean brand grid with model names, subtle animation.
 * Main window: navigation guards + security options.
 */
import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDev, ICON_PATH, LOCAL_UI_HOSTS } from './env.js';
import {
  getMainWindow, getWindowURL, getForceQuit, getShuttingDown, getClosePromptPending,
  setSplashWindow, setMainWindow, setForceQuit, setClosePromptPending,
  openExternalUrl,
} from './state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Splash Window — Brand grid, clean modern design ─────────────────────────
export function createSplashWindow() {
  const win = new BrowserWindow({
    width: 540,
    height: 400,
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

  // Separate brand entries and model entries — not paired.
  // Brands show as bold identifiers, models as flowing text.
  const items = [
    // Brand names
    { text: 'OpenAI',     tag: 'brand', color: '#10a37f' },
    { text: 'Anthropic',  tag: 'brand', color: '#d97757' },
    { text: 'Google',     tag: 'brand', color: '#4285f4' },
    { text: 'DeepSeek',   tag: 'brand', color: '#4d6bfe' },
    { text: 'Meta',       tag: 'brand', color: '#0668e1' },
    { text: 'Mistral',    tag: 'brand', color: '#f90' },
    { text: 'xAI',        tag: 'brand', color: '#e5e5e5' },
    { text: 'Cohere',     tag: 'brand', color: '#39594d' },
    { text: 'Kimi',       tag: 'brand', color: '#6c5ce7' },
    { text: 'MiniMax',    tag: 'brand', color: '#ff6b6b' },
    { text: 'Perplexity', tag: 'brand', color: '#1fb8cd' },
    { text: 'Qwen',       tag: 'brand', color: '#615ced' },
    { text: 'HuggingFace',tag: 'brand', color: '#ffbd45' },
    { text: 'Together',   tag: 'brand', color: '#6e56cf' },
    { text: 'Groq',       tag: 'brand', color: '#f55036' },
    { text: 'Fireworks',  tag: 'brand', color: '#fb923c' },
    // Model names
    { text: 'GPT-4o',       tag: 'model' },
    { text: 'GPT-4.1',      tag: 'model' },
    { text: 'Claude 4.5',   tag: 'model' },
    { text: 'Opus 4.5',     tag: 'model' },
    { text: 'Sonnet 4',     tag: 'model' },
    { text: 'Gemini 2.5',   tag: 'model' },
    { text: 'Gemma 3',      tag: 'model' },
    { text: 'Llama 4',      tag: 'model' },
    { text: 'DeepSeek R1',  tag: 'model' },
    { text: 'DeepSeek V3',  tag: 'model' },
    { text: 'Qwen 3',       tag: 'model' },
    { text: 'Qwen Coder',   tag: 'model' },
    { text: 'Mistral Large',tag: 'model' },
    { text: 'Mixtral',      tag: 'model' },
    { text: 'Grok 3',       tag: 'model' },
    { text: 'Command R+',   tag: 'model' },
    { text: 'Kimi K2',      tag: 'model' },
    { text: 'MiniMax M1',   tag: 'model' },
    { text: 'Sonar Pro',    tag: 'model' },
    { text: 'Hermes 3',     tag: 'model' },
    { text: 'Nous Research',tag: 'brand', color: '#a78bfa' },
  ];

  // Pica-inspired falling letters. Pica uses SpriteKit physics; we
  // approximate with CSS keyframes and gravity-feel cubic-bezier easing
  // (ease-in: slow start, fast end — like an object accelerating downward).
  // Each token is plain text — NO chip pills, no borders, no backgrounds.
  // The brand color (when present) tints the word; otherwise muted white.
  const shuffled = items.slice().sort(() => Math.random() - 0.5);
  const drops = shuffled.slice(0, 24).map((item, i) => {
    // Spread across 96% of width, biased to avoid card edges
    const x = 4 + ((i * 31) % 88);
    // Stagger fall start times so words don't all rain at once
    const delay = -(i * 0.42 % 9).toFixed(2);
    // Vary fall duration for natural drift (4–8s)
    const fall = (4 + ((i * 0.71) % 4.4)).toFixed(2);
    // Font sizes vary — bigger for brands, smaller for models, mixed
    const size = item.tag === 'brand' ? (16 + (i % 4) * 2) : (12 + (i % 3) * 2);
    // Slight horizontal drift on the way down
    const swayDir = (i % 2 === 0 ? 1 : -1);
    const swayPx = 8 + (i % 5) * 6;
    // Gentle rotation while falling
    const spinDir = (i % 3 === 0 ? -1 : 1);
    const spinDeg = 4 + ((i % 5) * 4);
    const color = item.color || (item.tag === 'brand' ? 'rgba(255,255,255,.86)' : 'rgba(255,255,255,.42)');
    const weight = item.tag === 'brand' ? 700 : 500;
    return '<span class="d" style="'
      + '--x:' + x + '%;'
      + '--d:' + delay + 's;'
      + '--t:' + fall + 's;'
      + '--s:' + size + 'px;'
      + '--c:' + color + ';'
      + '--w:' + weight + ';'
      + '--sx:' + (swayDir * swayPx) + 'px;'
      + '--sr:' + (spinDir * spinDeg) + 'deg'
      + '">' + item.text + '</span>';
  }).join('');

  const splashHTML = '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' \'unsafe-inline\'">'
    + '<style>'
    + '*{margin:0;padding:0;box-sizing:border-box}'
    + 'html,body{height:100%;background:transparent;'
    + 'font-family:\'SF Mono\',\'JetBrains Mono\',\'Fira Code\',ui-monospace,monospace;'
    + 'color:#fff;overflow:hidden;-webkit-font-smoothing:antialiased}'
    // Frosted-glass card — translucent so desktop bleeds through
    + '.card{position:absolute;inset:10px;border-radius:20px;'
    + 'background:linear-gradient(150deg,rgba(8,4,22,.78),rgba(20,6,34,.82));'
    + 'backdrop-filter:blur(28px) saturate(140%);-webkit-backdrop-filter:blur(28px) saturate(140%);'
    + 'border:1px solid rgba(255,255,255,.07);'
    + 'box-shadow:0 28px 80px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.06);'
    + 'overflow:hidden}'
    // Subtle radial highlights, no pills
    + '.card:before{content:"";position:absolute;inset:0;pointer-events:none;'
    + 'background:radial-gradient(circle at 25% 15%,rgba(120,200,255,.10),transparent 36%),'
    + 'radial-gradient(circle at 80% 25%,rgba(255,90,200,.10),transparent 38%)}'
    // Falling letters field — fills the entire card behind the hero text
    + '.field{position:absolute;inset:-80px 0 0 0;mask-image:linear-gradient(180deg,transparent 0%,#000 14%,#000 78%,transparent 100%);overflow:hidden}'
    // Each falling word — solid color, no background, ease-in (gravity-like)
    + '.d{position:absolute;left:var(--x);top:-40px;'
    + 'color:var(--c);font-size:var(--s);font-weight:var(--w);'
    + 'letter-spacing:.01em;white-space:nowrap;'
    + 'animation:fall var(--t) cubic-bezier(.55,.055,.675,.19) infinite;'
    + 'animation-delay:var(--d)}'
    // Gravity-like keyframes: slow start (ease-in), accelerate, swap-out at bottom.
    // translateY from -60 → 480, with horizontal sway + slight rotation.
    + '@keyframes fall{'
    + '0%{transform:translate3d(0,-60px,0) rotate(0);opacity:0}'
    + '8%{opacity:.85}'
    + '60%{opacity:.85}'
    + '100%{transform:translate3d(var(--sx),520px,0) rotate(var(--sr));opacity:0}}'
    // Hero content (above the rain)
    + '.hero{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 24px;z-index:2}'
    + 'h1{font-size:42px;font-weight:800;letter-spacing:-.025em;'
    + 'background:linear-gradient(180deg,#fff 0%,rgba(255,255,255,.78) 100%);'
    + '-webkit-background-clip:text;background-clip:text;color:transparent;'
    + 'text-shadow:0 2px 30px rgba(120,80,255,.35);margin-bottom:6px}'
    + '.sub{font-size:11px;font-weight:600;color:rgba(220,200,255,.55);letter-spacing:.18em;text-transform:uppercase}'
    + '.bar{width:160px;height:2px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:18px;position:relative}'
    + '.bar::after{content:"";display:block;width:38%;height:100%;border-radius:inherit;'
    + 'background:linear-gradient(90deg,#a855f7,#ec4899);'
    + 'box-shadow:0 0 14px rgba(168,85,247,.6);'
    + 'animation:sweep 1.4s ease-in-out infinite}'
    + '@keyframes sweep{0%{transform:translateX(-100%)}55%{transform:translateX(155%)}100%{transform:translateX(300%)}}'
    + '@media(prefers-reduced-motion:reduce){.d,.bar::after{animation:none;opacity:.4}}'
    + '</style></head><body>'
    + '<div class="card">'
    + '<div class="field">' + drops + '</div>'
    + '<div class="hero">'
    + '<h1>Hydra</h1>'
    + '<div class="sub">local proxy &middot; starting</div>'
    + '<div class="bar"></div>'
    + '</div>'
    + '</div></body></html>';

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
      buttons: ['Keep Running in Background', 'Quit Hydra'],
      defaultId: 0,
      cancelId: 0,
      title: 'Hydra',
      message: 'The proxy server keeps running when the window is closed.',
      detail: 'Choose "Keep Running" to close the window (proxy stays online; click the tray icon to reopen).\nChoose "Quit" to shut down the proxy and exit completely.',
    });

    setClosePromptPending(false);

    if (response === 1) {
      // User picked Quit — flag it so the second close pass bypasses the
      // dialog, and ask the app to fully quit (triggers before-quit →
      // shutdownEverything → server graceful → app.exit).
      setForceQuit(true);
      app.quit();
      return;
    }

    // User picked Keep Running — destroy the renderer entirely (frees
    // ~250 MB of Chromium renderer memory) and hide the dock icon. The
    // Express server stays alive (window-all-closed is a no-op on macOS).
    // Tray icon stays in the menu bar; clicking it respawns a fresh window.
    if (process.platform === 'darwin') app.dock?.hide();
    win.destroy();  // unconditional close — bypasses the close handler we're inside
  });

  const isAllowedLocalUrl = (url) => {
    try {
      const parsed = new URL(url);
      return LOCAL_UI_HOSTS.some(
        (host) =>
          (parsed.hostname === host || parsed.hostname === `[${host}]`) &&
          (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      );
    } catch {
      return false;
    }
  };

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedLocalUrl(url)) return { action: 'allow' };
    void openExternalUrl(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedLocalUrl(url)) {
      event.preventDefault();
      void openExternalUrl(url);
    }
  });

  setMainWindow(win);
  return win;
}
