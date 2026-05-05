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

// ─── Splash Window — paints in <100 ms ───────────────────────────────────────
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

  const splashLetters = 'HYDRAPROXY01011'.split('');
  const glyphs = Array.from({ length: 34 }, (_, i) => {
    const x = 3 + ((i * 17) % 94);
    const duration = 5.2 + ((i % 7) * 0.42);
    const delay = -((i * 0.37) % 5.4);
    const opacity = 0.18 + ((i % 5) * 0.035);
    const size = 18 + ((i % 6) * 6);
    const spin = (i % 2 === 0 ? -1 : 1) * (8 + ((i % 7) * 4));
    const text = splashLetters[i % splashLetters.length];
    return '<span style="--x:' + x + ';--t:' + duration + 's;--d:' + delay + 's;--o:' + opacity + ';--s:' + size + 'px;--r:' + spin + 'deg">' + text + '</span>';
  }).join('');

  const splashHTML = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\' \'unsafe-inline\'"><style>'
    + 'html,body{margin:0;height:100%;background:transparent;font-family:-apple-system,BlinkMacSystemFont,\'SF Pro Display\',\'Inter\',sans-serif;color:#f8fbff;overflow:hidden}'
    + '.frame{position:absolute;inset:10px;border-radius:22px;background:linear-gradient(145deg,rgba(8,11,20,.96),rgba(16,4,28,.98) 50%,rgba(4,21,29,.96));border:1px solid rgba(255,255,255,.12);box-shadow:0 28px 90px rgba(0,0,0,.72),inset 0 1px 0 rgba(255,255,255,.12);overflow:hidden}'
    + '.frame:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 24% 20%,rgba(88,166,255,.22),transparent 28%),radial-gradient(circle at 78% 18%,rgba(255,77,109,.18),transparent 30%),linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px);background-size:auto,auto,100% 7px;pointer-events:none}'
    + '.rain{position:absolute;inset:-140px 0 0;mask-image:linear-gradient(transparent,#000 16%,#000 76%,transparent)}'
    + '.rain span{position:absolute;left:calc(var(--x) * 1%);top:-90px;color:rgba(130,226,255,var(--o));font:950 var(--s)/1 -apple-system,BlinkMacSystemFont,\'SF Pro Display\',sans-serif;text-shadow:0 0 18px rgba(77,208,255,.72);transform:rotate(var(--r));animation:fall var(--t) cubic-bezier(.25,.72,.22,1) infinite;animation-delay:var(--d)}'
    + '.content{position:absolute;inset:0;display:grid;place-items:center;text-align:center}'
    + '.mark{position:relative;width:116px;height:116px;margin:0 auto 20px;border-radius:30px;background:linear-gradient(135deg,rgba(255,77,109,.92),rgba(121,92,255,.86) 48%,rgba(48,213,200,.88));box-shadow:0 20px 56px rgba(83,77,255,.28),0 0 0 1px rgba(255,255,255,.22) inset;display:grid;place-items:center}'
    + '.mark:before{content:"";position:absolute;inset:10px;border-radius:24px;background:rgba(4,7,13,.72);box-shadow:inset 0 1px 0 rgba(255,255,255,.16)}'
    + '.mark:after{content:"H";position:relative;font-size:60px;font-weight:900;color:#fff;text-shadow:0 0 26px rgba(255,255,255,.62)}'
    + 'h1{font-size:42px;font-weight:850;letter-spacing:0;margin:0 0 7px;background:linear-gradient(90deg,#fff,#9de9ff 46%,#ff8fa3);-webkit-background-clip:text;background-clip:text;color:transparent}'
    + '.sub{font-size:13px;font-weight:600;color:rgba(232,242,255,.68);margin-bottom:22px}'
    + '.bar{width:154px;height:5px;border-radius:999px;background:rgba(255,255,255,.12);overflow:hidden;margin:0 auto}'
    + '.bar i{display:block;width:48%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#4dd0ff,#ff4d6d);box-shadow:0 0 18px rgba(77,208,255,.8);animation:sweep 1.35s ease-in-out infinite}'
    + '@keyframes fall{0%{transform:translateY(-80px) rotate(var(--r));opacity:0}10%{opacity:1}74%{opacity:.8}100%{transform:translateY(560px) rotate(calc(var(--r) * -1));opacity:0}}'
    + '@keyframes sweep{0%{transform:translateX(-110%)}55%{transform:translateX(105%)}100%{transform:translateX(230%)}}'
    + '</style></head><body><div class="frame"><div class="rain">' + glyphs + '</div><div class="content"><div><div class="mark"></div><h1>HYDRA</h1><div class="sub">Starting local proxy</div><div class="bar"><i></i></div></div></div></div></body></html>';

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
    if (response === 0) {
      win.hide();
      return;
    }
    if (response === 1) {
      setForceQuit(true);
      const { app } = await import('electron');
      app.quit();
    }
  });

  win.on('closed', () => {
    if (getMainWindow() === win) setMainWindow(null);
  });

  const isAllowedLocalUrl = (rawUrl) => {
    try {
      const parsed = new URL(rawUrl);
      const expected = getWindowURL() ? new URL(getWindowURL()) : null;
      return parsed.protocol === 'http:' &&
        LOCAL_UI_HOSTS.has(parsed.hostname) &&
        expected &&
        parsed.origin === expected.origin;
    } catch {
      return false;
    }
  };

  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (isAllowedLocalUrl(targetUrl)) return;
    event.preventDefault();
    console.warn(`[electron] blocked navigation outside Hydra UI: ${targetUrl}`);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedLocalUrl(url)) return { action: 'allow' };
    void openExternalUrl(url);
    return { action: 'deny' };
  });

  setMainWindow(win);
  return win;
}
