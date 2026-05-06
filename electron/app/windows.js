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

  // Shuffle for visual variety and slice to fit
  const shuffled = items.sort(() => Math.random() - 0.5);
  const chips = shuffled.slice(0, 28).map((item, i) => {
    const delay = (i * 0.07).toFixed(2);
    const cls = item.tag === 'brand' ? 'chip-brand' : 'chip-model';
    const style = item.color ? ' style="--c:' + item.color + '"' : '';
    return '<span class="' + cls + '"' + style + ' style="animation-delay:' + delay + 's">' + item.text + '</span>';
  }).join('');

  const splashHTML = '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' \'unsafe-inline\'">'
    + '<style>'
    + '*{margin:0;padding:0;box-sizing:border-box}'
    + 'html,body{height:100%;background:transparent;'
    + 'font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",system-ui,sans-serif;'
    + 'color:#fff;overflow:hidden;-webkit-font-smoothing:antialiased}'
    // Glass card
    + '.card{position:absolute;inset:10px;border-radius:18px;'
    + 'background:rgba(14,14,18,.93);'
    + 'backdrop-filter:blur(40px) saturate(130%);-webkit-backdrop-filter:blur(40px) saturate(130%);'
    + 'border:1px solid rgba(255,255,255,.07);'
    + 'box-shadow:0 20px 70px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.05);'
    + 'display:flex;flex-direction:column;align-items:center;padding:28px 24px 20px;overflow:hidden}'
    // Header
    + '.header{text-align:center;margin-bottom:18px}'
    + 'h1{font-size:32px;font-weight:700;letter-spacing:-.02em;color:#fff;margin-bottom:4px}'
    + '.sub{font-size:11px;font-weight:500;color:rgba(255,255,255,.35);letter-spacing:.1em;text-transform:uppercase}'
    // Chip cloud — brands + models intermixed
    + '.cloud{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:8px;width:100%;flex:1;align-content:center;padding:8px 0}'
    + '.chip-brand,.chip-model{font-size:11px;font-weight:600;padding:4px 10px;border-radius:6px;'
    + 'animation:chip-in .4s ease-out both}'
    + '.chip-brand{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.85)}'
    + '.chip-model{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);color:rgba(255,255,255,.45)}'
    + '@keyframes chip-in{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}'
    // Progress bar
    + '.bar{width:180px;height:2px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:12px}'
    + '.bar::after{content:"";display:block;width:35%;height:100%;border-radius:inherit;'
    + 'background:linear-gradient(90deg,rgba(99,102,241,.6),rgba(139,92,246,.6));'
    + 'animation:sweep 1.5s ease-in-out infinite}'
    + '@keyframes sweep{0%{transform:translateX(-100%)}55%{transform:translateX(150%)}100%{transform:translateX(300%)}}'
    + '@media(prefers-reduced-motion:reduce){.chip-brand,.chip-model,.bar::after{animation:none}}'
    + '</style></head><body>'
    + '<div class="card">'
    + '<div class="header"><h1>Hydra</h1><div class="sub">local proxy &middot; starting</div></div>'
    + '<div class="cloud">' + chips + '</div>'
    + '<div class="bar"></div>'
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
