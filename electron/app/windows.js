/**
 * Hydra Electron — Splash & Main Window Creation
 *
 * Splash: clean brand grid with model names, subtle animation.
 * Main window: navigation guards + security options.
 */
import { app, BrowserWindow, dialog, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDev, ICON_PATH, isAllowedLocalUiUrl } from './env.js';
import {
  getMainWindow, getWindowURL, getForceQuit, getShuttingDown, getClosePromptPending,
  setSplashWindow, setMainWindow, setForceQuit, setClosePromptPending,
} from './state.js';
import { openExternalUrl } from './windowActions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Splash Window — Pica-style fullscreen sprawl + small centered card ─────
export function createSplashWindow() {
  // Pica-style architecture: BrowserWindow stretches across the WHOLE primary
  // display with a fully transparent background. The hex pattern + falling
  // letters cover the entire viewport (sprawl outside any opaque region). A
  // small centered card is the ONLY opaque region — translucent, frosted glass.
  // Result: the user sees hex + letters across their whole screen, with a
  // small island of card in the middle holding the hero text.
  const display = screen.getPrimaryDisplay();
  const { width: dispW, height: dispH } = display.workAreaSize;

  const win = new BrowserWindow({
    width: dispW,
    height: dispH,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,  // can't steal focus from the user's other apps during splash
    icon: ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: true,
    },
  });
  // Make the window transparent to mouse clicks — the user can interact with
  // whatever's behind the splash. The splash purely visual, not interactive.
  win.setIgnoreMouseEvents(true);

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
  // Reduced from 24 → 8 falling letters to lighten the GPU/CPU load.
  // Each animated <span> costs a compositor layer; on stressed systems the
  // splash was saturating a CPU core during boot. 8 keeps motion visible
  // without making every token its own expensive layer.
  const shuffled = items.slice().sort(() => Math.random() - 0.5);
  const drops = shuffled.slice(0, 8).map((item, i) => {
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
    + 'font-family:\'Intel One Mono\',\'JetBrains Mono\',\'SF Mono\',\'Menlo\',ui-monospace,monospace;'
    + 'color:#fff;overflow:hidden;-webkit-font-smoothing:antialiased}'
    // ─── PICA-STYLE FULLSCREEN SPRAWL ARCHITECTURE ───────────────────────
    //
    // Body fills the whole display, fully transparent. Hex layers + falling
    // letters are positioned `fixed` to cover the viewport (sprawl across
    // the user's entire screen). The card is a SMALL CENTERED ISLAND of
    // translucent glass — the only opaque region of the splash.
    //
    // Light-touch performance: ONE hex layer instead of three; static (no
    // stroke-dashoffset animation) — saves ~60% of compositor work; no
    // pulsing nodes (most expensive layer); shorter falling-letter loop.
    //
    // The card sits ~540×400 in the visual center via translate(-50%,-50%).
    + '.card{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);'
    + 'width:540px;height:400px;border-radius:16px;'
    + 'background:rgba(8,4,18,.62);'
    + 'backdrop-filter:blur(20px) saturate(140%);-webkit-backdrop-filter:blur(20px) saturate(140%);'
    + 'border:1px solid rgba(255,255,255,.10);'
    + 'box-shadow:0 30px 80px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.08);'
    + 'overflow:hidden;z-index:5}'
    // Hex grid sprawls ACROSS THE WHOLE VIEWPORT — outside the card too.
    // Static (no draw-in animation) so it doesn't fight for compositor
    // cycles every frame. Single layer instead of three.
    + '.hex{position:fixed;inset:0;pointer-events:none;opacity:.22;z-index:1}'
    + '.hex svg{width:100%;height:100%;display:block}'
    // Solid accent band — only inside the card, holds the hero text.
    + '.band{position:absolute;left:0;right:0;top:38%;height:24%;'
    + 'background:linear-gradient(90deg,rgba(18,6,38,.86),rgba(36,10,58,.94) 50%,rgba(18,6,38,.86));'
    + 'border-top:1px solid rgba(255,90,200,.22);border-bottom:1px solid rgba(120,200,255,.18);'
    + 'box-shadow:0 0 36px rgba(168,85,247,.20) inset,0 0 0 .5px rgba(255,255,255,.04) inset;'
    + 'pointer-events:none;z-index:1}'
    // Corner brackets — drawn as a single SVG inside the card so it's ONE
    // compositor layer instead of four separately-positioned divs. Was the
    // biggest contributor to the audit's "~18 compositor layers" count.
    + '.corners{position:absolute;inset:0;pointer-events:none;color:rgba(255,90,200,.55)}'
    + '.corners svg{position:absolute;inset:0;width:100%;height:100%;display:block}'
    // Subtle radial highlights for depth, on the card
    + '.card:before{content:"";position:absolute;inset:0;pointer-events:none;'
    + 'background:radial-gradient(circle at 22% 18%,rgba(120,200,255,.10),transparent 38%),'
    + 'radial-gradient(circle at 80% 22%,rgba(255,90,200,.10),transparent 40%)}'
    // Falling letters field fills the WHOLE viewport (fixed, full-screen)
    // so words rain across the entire screen, not just inside the card.
    + '.field{position:fixed;inset:-100px 0 0 0;pointer-events:none;'
    + 'mask-image:linear-gradient(180deg,transparent 0%,#000 8%,#000 86%,transparent 100%);'
    + 'overflow:hidden;z-index:2}'
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
    + '.bar{width:220px;height:3px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:18px;position:relative}'
    + '.bar::after{content:"";display:block;width:100%;height:100%;border-radius:inherit;'
    + 'background:linear-gradient(90deg,#a855f7,#ec4899,#60a5fa);'
    + 'box-shadow:0 0 14px rgba(168,85,247,.6);'
    + 'transform-origin:left center;transform:scaleX(0);'
    + 'animation:fillbar 6.5s cubic-bezier(.22,.61,.36,1) forwards}'
    + '@keyframes fillbar{0%{transform:scaleX(0)}68%{transform:scaleX(.78)}100%{transform:scaleX(1)}}'
    + '@media(prefers-reduced-motion:reduce){.d,.hex{animation:none;opacity:.18}.bar::after{animation:none;transform:scaleX(1)}}'
    + '</style></head><body>'
    // ─── FULLSCREEN SPRAWL LAYERS (outside card) ────────────────────────
    // Single hex pattern, fixed across the entire transparent viewport.
    // No animation (was 3 layers + stroke-dashoffset draw-in — removed
    // because the user wants performance fixes prioritized over visual flex).
    + '<div class="hex"><svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">'
    + '<defs><pattern id="hexGrid" x="0" y="0" width="56" height="48.5" patternUnits="userSpaceOnUse">'
    + '<polygon points="28,1 55,14.4 55,34.6 28,48 1,34.6 1,14.4" fill="none" stroke="rgba(168,120,255,.45)" stroke-width=".6" />'
    + '</pattern></defs>'
    + '<rect width="100%" height="100%" fill="url(#hexGrid)"/>'
    + '</svg></div>'
    // Falling letters fill the whole viewport so words rain past the card.
    + '<div class="field">' + drops + '</div>'
    // ─── CENTERED CARD (the only opaque region) ─────────────────────────
    + '<div class="card">'
    // Corner brackets — single SVG, ONE compositor layer. The four pairs
    // of L-shaped strokes draw the cyberpunk terminal accent at each corner.
    // 14px from each edge × 18px arm length matches the prior 4-div version.
    + '<div class="corners"><svg viewBox="0 0 540 400" preserveAspectRatio="none">'
    +   '<g fill="none" stroke="currentColor" stroke-width="1">'
    +     '<path d="M14,32 L14,14 L32,14"/>'             // top-left
    +     '<path d="M508,14 L526,14 L526,32"/>'           // top-right
    +     '<path d="M14,368 L14,386 L32,386"/>'           // bottom-left
    +     '<path d="M508,386 L526,386 L526,368"/>'        // bottom-right
    +   '</g>'
    + '</svg></div>'
    + '<div class="band"></div>'
    + '<div class="hero">'
    + '<h1>Hydra</h1>'
    + '<div class="sub">Initializing OpenRouter Manager</div>'
    + '<div class="bar"></div>'
    + '</div>'
    + '</div></body></html>';

  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHTML));
  win.once('closed', () => { setSplashWindow(null); });
  setSplashWindow(win);
  // Return the window so callers can reference it without re-reading state.
  // CRITICAL: without this return, callers writing `const sp = createSplashWindow()`
  // get `undefined` and any subsequent `setSplashWindow(sp)` clobbers the state
  // we just set above — breaking later destroy() calls because getSplashWindow()
  // returns undefined.
  return win;
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
    const appUrl = getWindowURL();
    const appPort = appUrl ? new URL(appUrl).port : null;
    return isAllowedLocalUiUrl(url, appPort);
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
