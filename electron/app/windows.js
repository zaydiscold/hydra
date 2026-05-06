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

  // Brand + model grid — each card shows a brand identifier and cycles through models
  const brands = [
    { id: 'OA', label: 'OpenAI',   models: ['GPT-4o', 'GPT-4.1', 'o4-mini'],         color: '#10a37f' },
    { id: 'AN', label: 'Anthropic', models: ['Claude 4.5', 'Opus 4.5', 'Sonnet 4'],  color: '#d97757' },
    { id: 'GG', label: 'Google',   models: ['Gemini 2.5', 'Gemini Flash', 'Gemma 3'], color: '#4285f4' },
    { id: 'DS', label: 'DeepSeek', models: ['DeepSeek R1', 'DeepSeek V3'],           color: '#4d6bfe' },
    { id: 'MT', label: 'Meta',     models: ['Llama 4', 'Llama 3.3'],                 color: '#0668e1' },
    { id: 'MS', label: 'Mistral',  models: ['Mistral Large', 'Mixtral', 'Codestral'], color: '#f90' },
    { id: 'XA', label: 'xAI',      models: ['Grok 3', 'Grok 2'],                     color: '#e5e5e5' },
    { id: 'CH', label: 'Cohere',   models: ['Command R+', 'Command R'],              color: '#39594d' },
    { id: 'KM', label: 'Kimi',     models: ['Kimi K2', 'Moonshot'],                  color: '#6c5ce7' },
    { id: 'MM', label: 'MiniMax',  models: ['MiniMax M1', 'abab 6.5s'],              color: '#ff6b6b' },
    { id: 'PP', label: 'Perplexity', models: ['Sonar Pro', 'Sonar'],                  color: '#1fb8cd' },
    { id: 'QW', label: 'Qwen',     models: ['Qwen 2.5', 'Qwen Coder'],               color: '#615ced' },
  ];

  const brandCards = brands.map((b, i) => {
    const delay = (i * 0.08).toFixed(2);
    return '<div class="bcard" style="animation-delay:' + delay + 's;border-color:' + b.color + '22">'
      + '<div class="bid" style="color:' + b.color + '">' + b.id + '</div>'
      + '<div class="bmodels">' + b.models.map((m, mi) =>
          '<span style="animation-delay:' + (delay + mi * 0.6).toFixed(2) + 's">' + m + '</span>'
        ).join('') + '</div>'
      + '</div>';
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
    // Brand grid
    + '.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;width:100%;flex:1;align-content:start}'
    // Brand card
    + '.bcard{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);'
    + 'border-radius:10px;padding:10px 8px;text-align:center;'
    + 'animation:card-in .5s ease-out both}'
    + '@keyframes card-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}'
    // Brand ID — two-letter abbreviation
    + '.bid{font-size:18px;font-weight:800;letter-spacing:.04em;margin-bottom:6px}'
    // Model names — cycle through
    + '.bmodels{display:flex;flex-direction:column;gap:3px;position:relative;height:36px;overflow:hidden}'
    + '.bmodels span{font-size:9px;font-weight:500;color:rgba(255,255,255,.5);'
    + 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;'
    + 'opacity:0;animation:model-cycle 6s ease-in-out infinite}'
    + '.bmodels span:nth-child(1){animation-delay:0s}'
    + '.bmodels span:nth-child(2){animation-delay:2s}'
    + '.bmodels span:nth-child(3){animation-delay:4s}'
    + '@keyframes model-cycle{0%,5%{opacity:0;transform:translateY(6px)}'
    + '10%,28%{opacity:1;transform:translateY(0)}'
    + '33%,100%{opacity:0;transform:translateY(-6px)}}'
    // Progress bar
    + '.bar{width:180px;height:2px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:16px}'
    + '.bar::after{content:"";display:block;width:35%;height:100%;border-radius:inherit;'
    + 'background:linear-gradient(90deg,rgba(99,102,241,.6),rgba(139,92,246,.6));'
    + 'animation:sweep 1.5s ease-in-out infinite}'
    + '@keyframes sweep{0%{transform:translateX(-100%)}55%{transform:translateX(150%)}100%{transform:translateX(300%)}}'
    + '@media(prefers-reduced-motion:reduce){.bcard,.bmodels span,.bar::after{animation:none}}'
    + '</style></head><body>'
    + '<div class="card">'
    + '<div class="header"><h1>Hydra</h1><div class="sub">local proxy &middot; starting</div></div>'
    + '<div class="grid">' + brandCards + '</div>'
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
