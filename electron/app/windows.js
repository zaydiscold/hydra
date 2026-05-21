/**
 * Hydra Electron — Splash & Main Window Creation
 *
 * Splash: clean brand grid with model names, subtle animation.
 * Main window: navigation guards + security options.
 */
import { app, BrowserWindow, dialog, screen } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDev, ICON_PATH, isAllowedLocalUiUrl } from './env.js';
import {
  getMainWindow, getWindowURL, getForceQuit, getShuttingDown, getClosePromptPending,
  setSplashWindow, setMainWindow, setForceQuit, setClosePromptPending,
} from './state.js';
import { openExternalUrl } from './windowActions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPLASH_PRELOAD_PATH = path.join(__dirname, '..', 'splashPreload.js');

// ─── Vendored matter-js (~83 KB minified) ─────────────────────────────────
// Loaded once at module init so every splash invocation reuses the same
// string. Inlined into the splash data: URL so the splash window stays
// fully self-contained (no file:// fetches once the BrowserWindow opens).
// `</script>` substrings (if any) are escaped so they cannot prematurely
// close the inline <script> tag in the HTML parser.
const MATTER_JS_SRC = fs
  .readFileSync(path.join(__dirname, '..', 'vendor', 'matter.min.js'), 'utf8')
  .replace(/<\/(script)/gi, '<\\/$1');

// ─── Splash Window — Pica-style fullscreen sprawl + small centered card ─────
export function createSplashWindow() {
  // Pica-style architecture: BrowserWindow stretches across the whole primary
  // display with a fully transparent background. Falling letters cover the
  // viewport, while the hex pattern stays as a smaller centered accent around
  // the card instead of taking over the whole transparent splash layer.
  const display = screen.getPrimaryDisplay();
  const { width: dispW, height: dispH } = display.workAreaSize;

  const win = new BrowserWindow({
    width: dispW,
    height: dispH,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,  // can't steal focus from the user's other apps during splash
    icon: ICON_PATH,
    webPreferences: {
      preload: SPLASH_PRELOAD_PATH,
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

  // SPLASH WORD LIST — labs / models / HuggingFace standouts / bio research.
  // Curated 2026-05 to reflect current frontier (Opus 4.5, Llama 4, Grok 4,
  // Gemini 3, Sora 2, Veo 3) plus emerging labs (Black Forest, Liquid AI,
  // Sakana, Reka, Inflection 3) plus bio/protein models (AlphaFold 3,
  // ESM-2, RFDiffusion, Boltz-1, Chai-1) plus HuggingFace community
  // favorites (Qwopus, Carnice, DeepHermes, Phi-4).
  // Tag = brand → larger + bold + colored. Tag = model → smaller + lighter.
  const items = [
    // ── Frontier labs (16) ──────────────────────────────────────────────
    { text: 'OpenAI',         tag: 'brand', color: '#10a37f' },
    { text: 'Anthropic',      tag: 'brand', color: '#d97757' },
    { text: 'Google',         tag: 'brand', color: '#4285f4' },
    { text: 'DeepSeek',       tag: 'brand', color: '#4d6bfe' },
    { text: 'Meta',           tag: 'brand', color: '#0668e1' },
    { text: 'Mistral',        tag: 'brand', color: '#f90' },
    { text: 'xAI',            tag: 'brand', color: '#e5e5e5' },
    { text: 'Cohere',         tag: 'brand', color: '#39594d' },
    { text: 'Kimi',           tag: 'brand', color: '#6c5ce7' },
    { text: 'MiniMax',        tag: 'brand', color: '#ff6b6b' },
    { text: 'Perplexity',     tag: 'brand', color: '#1fb8cd' },
    { text: 'Qwen',           tag: 'brand', color: '#615ced' },
    { text: 'HuggingFace',    tag: 'brand', color: '#ffbd45' },
    { text: 'Together',       tag: 'brand', color: '#6e56cf' },
    { text: 'Groq',           tag: 'brand', color: '#f55036' },
    { text: 'Fireworks',      tag: 'brand', color: '#fb923c' },
    // ── Newer labs / orgs (12) ──────────────────────────────────────────
    { text: 'Nous Research',  tag: 'brand', color: '#a78bfa' },
    { text: 'Black Forest',   tag: 'brand', color: '#fb7185' },
    { text: 'Liquid AI',      tag: 'brand', color: '#22d3ee' },
    { text: 'Sakana',         tag: 'brand', color: '#fbbf24' },
    { text: 'Reka',           tag: 'brand', color: '#a78bfa' },
    { text: 'Inflection',     tag: 'brand', color: '#34d399' },
    { text: 'Allen AI',       tag: 'brand', color: '#60a5fa' },
    { text: 'AI21',           tag: 'brand', color: '#f472b6' },
    { text: 'Stability',      tag: 'brand', color: '#c084fc' },
    { text: 'Modal',          tag: 'brand', color: '#7dd3fc' },
    { text: 'Replicate',      tag: 'brand', color: '#fdba74' },
    { text: 'Snowflake',      tag: 'brand', color: '#38bdf8' },
    // ── Frontier models — text/multimodal (28) ──────────────────────────
    { text: 'GPT-5',          tag: 'model' },
    { text: 'GPT-5 Pro',      tag: 'model' },
    { text: 'GPT-4.1',        tag: 'model' },
    { text: 'GPT-4o',         tag: 'model' },
    { text: 'Opus 4.5',       tag: 'model' },
    { text: 'Sonnet 4.5',     tag: 'model' },
    { text: 'Haiku 4.5',      tag: 'model' },
    { text: 'Claude 4.5',     tag: 'model' },
    { text: 'Gemini 3 Pro',   tag: 'model' },
    { text: 'Gemini 2.5',     tag: 'model' },
    { text: 'Gemma 3',        tag: 'model' },
    { text: 'Gemma 3n',       tag: 'model' },
    { text: 'Llama 4',        tag: 'model' },
    { text: 'Llama Maverick', tag: 'model' },
    { text: 'Llama Scout',    tag: 'model' },
    { text: 'DeepSeek R1',    tag: 'model' },
    { text: 'DeepSeek V3',    tag: 'model' },
    { text: 'DeepSeek V3.1',  tag: 'model' },
    { text: 'Qwen 3',         tag: 'model' },
    { text: 'Qwen3-Max',      tag: 'model' },
    { text: 'Qwen Coder',     tag: 'model' },
    { text: 'Qwopus',         tag: 'model' },
    { text: 'Mistral Large',  tag: 'model' },
    { text: 'Mistral Medium', tag: 'model' },
    { text: 'Mixtral',        tag: 'model' },
    { text: 'Pixtral',        tag: 'model' },
    { text: 'Codestral',      tag: 'model' },
    { text: 'Grok 4',         tag: 'model' },
    { text: 'Grok 4.1',       tag: 'model' },
    { text: 'Command A',      tag: 'model' },
    { text: 'Command R+',     tag: 'model' },
    { text: 'Kimi K2',        tag: 'model' },
    { text: 'MiniMax M1',     tag: 'model' },
    { text: 'Sonar Pro',      tag: 'model' },
    { text: 'Sonar Reasoning',tag: 'model' },
    { text: 'Hermes 4',       tag: 'model' },
    { text: 'DeepHermes',     tag: 'model' },
    { text: 'Phi-4',          tag: 'model' },
    { text: 'Yi-Lightning',   tag: 'model' },
    { text: 'Carnice',        tag: 'model' },
    { text: 'Reka Flash',     tag: 'model' },
    // ── Image / video / audio (6) ───────────────────────────────────────
    { text: 'Flux',           tag: 'model', color: '#fb7185' },
    { text: 'Flux Pro',       tag: 'model', color: '#fb7185' },
    { text: 'Sora 2',         tag: 'model' },
    { text: 'Veo 3',          tag: 'model' },
    { text: 'Kling 2',        tag: 'model' },
    { text: 'Runway',         tag: 'model' },
    // ── Bio / protein / scientific (10) ─────────────────────────────────
    { text: 'AlphaFold 3',    tag: 'model', color: '#34d399' },
    { text: 'ESM-2',          tag: 'model', color: '#34d399' },
    { text: 'ESMFold',        tag: 'model', color: '#34d399' },
    { text: 'RFDiffusion',    tag: 'model', color: '#34d399' },
    { text: 'Boltz-1',        tag: 'model', color: '#34d399' },
    { text: 'Chai-1',         tag: 'model', color: '#34d399' },
    { text: 'Bonsai',         tag: 'model', color: '#34d399' },
    { text: 'ProGen2',        tag: 'model', color: '#34d399' },
    { text: 'Evo 2',          tag: 'model', color: '#34d399' },
    { text: 'OpenFold',       tag: 'model', color: '#34d399' },
  ];

  // ─── User greeting (NSFullUserName equivalent) ────────────────────────
  // Pica calls Cocoa\'s NSFullUserName() to greet the user by name on
  // first launch ("Hello, Zayd"). On macOS we get the same via
  // `id -F` (GECOS full name) or fall back to `os.userInfo().username`.
  // On Windows / Linux we fall back to the short username only.
  // Reference: ~/Desktop/pica-teardown/04-personalization-and-name-detection.md
  let userGreetingName = '';
  try {
    if (process.platform === 'darwin') {
      try {
        userGreetingName = execSync('id -F', { timeout: 200, encoding: 'utf-8' }).trim();
      } catch (err) {
        console.warn(`[electron] full-name greeting lookup failed, using username fallback: ${err.message}`);
      }
    }
    if (!userGreetingName) {
      const u = os.userInfo();
      userGreetingName = (u && u.username) ? u.username.charAt(0).toUpperCase() + u.username.slice(1) : '';
    }
  } catch (err) {
    console.warn(`[electron] greeting name fallback failed: ${err.message}`);
  }
  // Inject as JS literal — escape any chars that could break out of the
  // single-quoted string in the data URL (newlines, single quotes,
  // backslashes). Defensive even though `id -F` only returns one name.
  const greetingSafe = String(userGreetingName).replace(/[\\'"\n\r]/g, '').slice(0, 80);
  const versionSafe = String(app.getVersion() || 'dev').replace(/[^0-9A-Za-z._+-]/g, '').slice(0, 32) || 'dev';

  // PICA-STYLE PHYSICS SPLASH (canvas + real gravity / collision / piling).
  //
  // Background: Pica's onboarding scene is SpriteKit — `SKLabelNode`s wrapped in
  // `SKPhysicsBody` falling under `physicsWorld.gravity` and stacking against
  // an `edgeLoopFrom: frame` floor. CSS keyframes can't replicate that —
  // letters can't COLLIDE in CSS. We use a `<canvas>` + a tiny custom physics
  // loop (~120 lines): gravity + AABB-vs-floor + AABB-vs-AABB inter-letter
  // separation. Random initial position / rotation / angular impulse means
  // the pile is different every launch.
  //
  // Reference: ~/Desktop/pica-teardown/05-falling-letters-animation.md
  //
  // Performance: density-scaled count (36–100 bodies, see TARGET below).
  // O(n²) pair check at the cap is 10,000 ops/frame — at 60 fps that's
  // 600,000 ops/sec, still trivial on any GPU-compositing-disabled CPU
  // path. Canvas paint is one compositor layer total. The list is
  // intentionally repeated (with reshuffles) to fill the screen — same
  // density trick Pica uses by reusing characters from a name.
  const itemsJson = JSON.stringify(items);

  const splashHTML = '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' \'unsafe-inline\'">'
    + '<style>'
    + '*{margin:0;padding:0;box-sizing:border-box}'
    + 'html,body{height:100%;background:transparent;'
    + 'font-family:\'Intel One Mono\',\'JetBrains Mono\',\'SF Mono\',\'Menlo\',ui-monospace,monospace;'
    + 'color:#fff;overflow:hidden;-webkit-font-smoothing:antialiased}'
    // ─── OUTER CONTAINER — Liquid-Glass-style edge ──────────────────────
    //
    // What makes Apple\'s iOS 26 / macOS Tahoe "Liquid Glass" READ as
    // glass and not as "a div with a 1 px white border":
    //
    //   1. SOFT, LAYERED EDGE — never a single hard 1 px line. Apple
    //      stacks multiple inset shadows of different blur radii and
    //      colors (white at top + sides, near-black at bottom) to build
    //      a 3-D bevel that catches light. The eye reads "this is
    //      curved, raised glass" instinctively.
    //   2. SPECULAR HIGHLIGHT — a brighter gradient along the top edge
    //      that wraps slightly into the upper corners, like light
    //      hitting the top of a dome.
    //   3. SUBTLE INTERIOR TINT — even "transparent" iOS glass has
    //      ~3-6% white surface luminance so the panel reads as a
    //      surface even when the desktop behind is busy. Without this,
    //      the box "disappears" against complex backgrounds (which is
    //      what we just hit).
    //   4. BACKDROP BLUR + SATURATE — the desktop behind is blurred
    //      AND its colors are pushed; this is what makes glass feel
    //      like a real material vs. a flat-tinted div.
    //   5. SOFT DROP SHADOW — anchors the panel above the desktop.
    //
    // We keep the user\'s "mostly transparent" requirement: 5% white
    // tint on the body is barely visible against a uniform background
    // but ESSENTIAL for readability against busy ones (verified by
    // taking a screenshot mid-splash on a desktop covered in icons).
    //
    // Reference: Apple HIG "Liquid Glass" + WWDC25 session 219
    // ("Designing with Liquid Glass") + the glass implementation in
    // iOS 26 Lock Screen widgets.
    // FULL-WINDOW JAR (Pica-style: physics fills the splash window, walls
    // sit at the actual viewport edges — letters cannot escape because
    // there is no clipping mismatch between visual container and physics
    // walls. The decorative glass treatment (gradients, shadows, vines)
    // simply stretches to cover the whole splash.)
    + '.outer{position:fixed;left:0;top:0;transform:none;'
    + 'width:100vw;height:100vh;border-radius:0;'
    // 4% white surface luminance — barely there but ESSENTIAL for the
    // glass to read against busy desktops (verified by screenshotting
    // mid-splash on a wallpaper covered in Finder icons; without this
    // the box vanishes).
    // iOS 26 LIQUID GLASS with purple brand tinge. Apple\'s Liquid Glass
    // is intentionally see-through — heavy frosting reads as 2010-era
    // glassmorphism. Tuned to match the iOS 26 lock-screen widget feel
    // PLUS a subtle purple tint to bond with Hydra\'s brand palette
    // (the inner card uses #a855f7/#ec4899 gradients).
    //
    //   blur 16 px        — content behind is recognizable, not erased
    //   saturate 200%     — colors behind become slightly more vivid (lensing)
    //   brightness 1.04   — gentle lift
    //   surface rgba(168,85,247,.05) — purple at 5%, brand-coherent
    + 'background:linear-gradient(180deg,rgba(12,7,24,.18),rgba(6,3,14,.10));'
    + 'backdrop-filter:blur(9px) saturate(135%);'
    + '-webkit-backdrop-filter:blur(9px) saturate(135%);'
    // NO hard 1px border. The user reported it as "harsh white opaque"
    // — and they were right. iOS 26 Liquid Glass NEVER uses a flat 1px
    // line; the edge is built entirely from stacked SOFT shadows that
    // create a curved-bevel illusion. Read top → bottom:
    //   1. outer drop  → anchors the panel above the desktop
    //   2. tiny outer hairline (translucent, 0.5px) → smoothed perimeter
    //   3. inset top 0 → +2 white  → light catches the top bevel
    //   4. inset top 8 → wide soft white glow on upper interior
    //   5. inset bot 0 → −2 black  → shaded underside of the bevel
    //   6. inset bot 14 → wide soft dark glow on lower interior
    //   7. inset all 0 → 60 rgba(255,255,255,0.03) → surface luminance
    //
    // No CSS `border` property. This is the key change.
    //
    // The shadow stack defines the bevel TOP, BOTTOM, and continuous
    // PERIMETER. Without the perimeter ring (#3) the side edges fade
    // into the desktop on busy wallpapers — verified by screenshot
    // comparison. Apple Liquid Glass always has a continuous edge.
    // iOS 26 Liquid Glass shadow stack — toned WAY down from previous
    // pass. The user kept reporting "harsh white frosted" because the
    // top specular and side highlights were too bright. Apple\'s actual
    // Liquid Glass uses very subtle inner shadows (.10 alpha max) plus
    // a strong outer drop. The "edge" reads via the OUTER shadow, not
    // bright inner highlights.
    + 'box-shadow:'
    +   '0 70px 170px rgba(0,0,0,.38),'
    +   '0 0 0 1px rgba(168,85,247,.18),'
    +   'inset 0 0 0 1px rgba(255,255,255,.035),'
    +   'inset 0 1px 0 rgba(255,255,255,.08),'
    +   'inset 0 -34px 70px -44px rgba(0,0,0,.48);'
    + 'overflow:hidden;z-index:3}'
    // SPECULAR TOP HIGHLIGHT — the brightest part of the glass, where
    // a virtual light source would catch the upper bevel. A radial
    // gradient centered above the top edge fades down into the body.
    // This is the single most "iOS-glass-looking" element of the rig:
    // without it, the box reads as a tinted rectangle. With it, the
    // eye reads "raised glass under top lighting".
    + '.outer::before{content:"";position:absolute;inset:0;border-radius:inherit;'
    + 'background:radial-gradient(ellipse 110% 58% at 50% -12%,'
    +   'rgba(168,85,247,.16) 0%,'
    +   'rgba(96,165,250,.06) 34%,'
    +   'transparent 60%);'
    + 'pointer-events:none;z-index:3}'
    // BOTTOM SOFT SHADE — opposite of the top highlight, gives the
    // panel weight. Without this the panel feels weightlessly floaty.
    + '.outer::after{content:"";position:absolute;inset:0;border-radius:inherit;'
    + 'background:radial-gradient(ellipse 120% 60% at 50% 110%,'
    +   'rgba(0,0,0,.26) 0%,'
    +   'rgba(0,0,0,.10) 35%,'
    +   'transparent 60%);'
    + 'pointer-events:none;z-index:3}'
    + '.vines{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;opacity:.95}'
    + '.vines .stem,.vines .twig{fill:none;stroke-linecap:round;stroke-linejoin:round;'
    + 'stroke-dasharray:0 1400;stroke-dashoffset:0;animation:grow 10s cubic-bezier(.18,.86,.2,1) forwards}'
    + '.vines .stem{filter:drop-shadow(0 0 7px rgba(168,85,247,.28))}'
    + '.vines .twig{stroke-dasharray:0 360;opacity:.72;animation-name:growTwig}'
    + '.vines .bud{fill:rgba(190,242,255,.70);opacity:0;transform-box:fill-box;transform-origin:center;'
    + 'animation:bud 10s cubic-bezier(.16,1,.3,1) forwards;filter:drop-shadow(0 0 5px rgba(96,165,250,.35))}'
    + '@keyframes grow{0%{stroke-dasharray:0 1400;opacity:.02}12%{opacity:.55}100%{stroke-dasharray:1400 0;opacity:.86}}'
    + '@keyframes growTwig{0%,18%{stroke-dasharray:0 360;opacity:0}100%{stroke-dasharray:360 0;opacity:.68}}'
    + '@keyframes bud{0%,42%{opacity:0;transform:scale(.25)}70%{opacity:.75;transform:scale(1.08)}100%{opacity:.58;transform:scale(1)}}'
    // Canvas pinned to the viewport, NOT to .outer. matter.js owns the
    // physics world; its walls are placed at viewport edges to match
    // exactly what the user sees. z-index sits above background chrome
    // (.outer, vines, hex, decos) and below the brand card (z-index:4),
    // so the brand reveal materializes on top of the falling letters.
    + 'canvas#field{position:fixed;inset:0;width:100vw;height:100vh;'
    + 'pointer-events:none;z-index:3;display:block}'
    // Inner card stays the same size, centered inside the outer-card.
    // (Was position:fixed against viewport — now position:absolute against
    // .outer so they always stay co-centered if the user resizes.)
    // Inner card is HIDDEN for the first ~5.5 s of the splash. The
    // falling-letters animation owns the screen alone during that
    // window — building visual presence before the brand panel
    // materializes on top. cardIn fades + scales the card in over
    // 800 ms so it doesn\'t pop. Translucency ~85% (was 62%) per the
    // user\'s "less translucent but still translucent" request.
    + '.card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.94);'
    + 'width:540px;height:400px;border-radius:16px;'
    + 'background:rgba(8,4,18,.85);'
    + 'backdrop-filter:blur(24px) saturate(150%);-webkit-backdrop-filter:blur(24px) saturate(150%);'
    + 'border:1px solid rgba(255,255,255,.12);'
    + 'box-shadow:0 30px 80px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.10);'
    + 'overflow:hidden;z-index:4;opacity:0;'
    + 'animation:cardIn 800ms 5500ms cubic-bezier(.22,.61,.36,1) forwards}'
    + '@keyframes cardIn{'
    +   '0%{opacity:0;transform:translate(-50%,-50%) scale(.94)}'
    +   '60%{opacity:1;transform:translate(-50%,-50%) scale(1.01)}'
    +   '100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}'
    // ── Geometric solid decoration — TOP QUARTER (0–25 %) ───────────────
    // Solid dark block with diagonal accent stripes + horizontal line.
    // Frames the "Hydra" title from above, reads as a fixed UI chrome
    // rather than a pure transparent layer.
    + '.deco-top{position:absolute;left:0;right:0;top:0;height:25%;'
    + 'background:linear-gradient(180deg,rgba(8,4,18,.92) 0%,rgba(8,4,18,.86) 80%,rgba(8,4,18,.0) 100%),'
    +   'repeating-linear-gradient(-30deg,rgba(168,85,247,.08) 0,rgba(168,85,247,.08) 1px,transparent 1px,transparent 14px);'
    + 'border-bottom:1px solid rgba(168,85,247,.18);'
    + 'pointer-events:none;z-index:1}'
    + '.deco-top::after{content:"";position:absolute;left:14px;right:14px;bottom:8px;height:1px;'
    + 'background:linear-gradient(90deg,transparent 0%,rgba(168,85,247,.5) 50%,transparent 100%)}'
    // ── Geometric solid decoration — BOTTOM QUARTER (75–100 %) ──────────
    // Mirror of the top: solid block + diagonal stripes pointing the
    // opposite way + a row of small "data" rectangles along the inside.
    + '.deco-bot{position:absolute;left:0;right:0;bottom:0;height:25%;'
    + 'background:linear-gradient(0deg,rgba(8,4,18,.92) 0%,rgba(8,4,18,.86) 80%,rgba(8,4,18,.0) 100%),'
    +   'repeating-linear-gradient(30deg,rgba(120,200,255,.07) 0,rgba(120,200,255,.07) 1px,transparent 1px,transparent 14px);'
    + 'border-top:1px solid rgba(120,200,255,.16);'
    + 'pointer-events:none;z-index:1}'
    + '.deco-bot::after{content:"";position:absolute;left:14px;right:14px;top:8px;height:1px;'
    + 'background:linear-gradient(90deg,transparent 0%,rgba(120,200,255,.45) 50%,transparent 100%)}'
    // Small "data ticks" running along the bottom band, suggesting a
    // status / readout strip without committing to specific text.
    + '.deco-bot__ticks{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);'
    + 'display:flex;gap:6px;align-items:center;height:6px}'
    + '.deco-bot__ticks span{display:block;width:14px;height:2px;background:rgba(255,255,255,.18);border-radius:1px}'
    + '.deco-bot__ticks span:nth-child(3){width:24px;background:rgba(168,85,247,.6)}'
    + '.deco-bot__ticks span:nth-child(5){width:8px;background:rgba(120,200,255,.5)}'
    + '.hex{position:absolute;inset:0;pointer-events:none;opacity:.045;z-index:1;'
    + 'mask-image:radial-gradient(ellipse at center,transparent 0 40%,#000 58%,transparent 100%)}'
    + '.hex svg{width:100%;height:100%;display:block}'
    + '.band{position:absolute;left:0;right:0;top:38%;height:24%;'
    + 'background:linear-gradient(90deg,rgba(18,6,38,.86),rgba(36,10,58,.94) 50%,rgba(18,6,38,.86));'
    + 'border-top:1px solid rgba(255,90,200,.22);border-bottom:1px solid rgba(120,200,255,.18);'
    + 'box-shadow:0 0 36px rgba(168,85,247,.20) inset,0 0 0 .5px rgba(255,255,255,.04) inset;'
    + 'pointer-events:none;z-index:1}'
    + '.corners{position:absolute;inset:0;pointer-events:none;color:rgba(255,90,200,.55)}'
    + '.corners svg{position:absolute;inset:0;width:100%;height:100%;display:block}'
    + '.card:before{content:"";position:absolute;inset:0;pointer-events:none;'
    + 'background:radial-gradient(circle at 22% 18%,rgba(120,200,255,.10),transparent 38%),'
    + 'radial-gradient(circle at 80% 22%,rgba(255,90,200,.10),transparent 40%)}'
    + '.hero{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 24px;z-index:2}'
    + 'h1{font-family:inherit;font-size:42px;font-weight:800;letter-spacing:0;'
    + 'background:linear-gradient(180deg,#fff 0%,rgba(255,255,255,.78) 100%);'
    + '-webkit-background-clip:text;background-clip:text;color:transparent;'
    + 'text-shadow:0 2px 30px rgba(120,80,255,.35);margin-bottom:6px}'
    + '.sub{font-family:inherit;font-size:11px;font-weight:600;color:rgba(220,200,255,.55);letter-spacing:.18em;text-transform:uppercase}'
    // Personalized greeting above the wordmark. Small, tight, warm tone.
    + '.greet{font-family:inherit;font-size:13px;font-weight:500;color:rgba(220,200,255,.8);letter-spacing:.04em;margin-bottom:8px}'
    + '.bar{width:220px;height:3px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:18px;position:relative}'
    + '.bar::after{content:"";display:block;width:100%;height:100%;border-radius:inherit;'
    + 'background:linear-gradient(90deg,#a855f7,#ec4899,#60a5fa);'
    + 'box-shadow:0 0 14px rgba(168,85,247,.6);'
    + 'transform-origin:left center;transform:scaleX(0);'
    // 10s — must match SPLASH_MIN_VISIBLE_MS in main.js. Bar fills from 0
    // to 1 over the full visible duration so it reaches 100% as the splash
    // dismisses. Pure CSS, runs even if JS physics fails to start.
    + 'animation:fillbar 10s cubic-bezier(.22,.61,.36,1) forwards}'
    + '@keyframes fillbar{0%{transform:scaleX(0)}68%{transform:scaleX(.78)}100%{transform:scaleX(1)}}'
    + '.update-strip{width:220px;height:2px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:9px;opacity:0;transform:translateY(-2px);transition:opacity 180ms ease,transform 180ms ease}'
    + '.update-strip.is-active{opacity:1;transform:translateY(0)}'
    + '.update-strip__fill{display:block;width:100%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#67e8f9,#a855f7,#ec4899);box-shadow:0 0 12px rgba(103,232,249,.55);transform-origin:left center;transform:scaleX(0);transition:transform 180ms ease}'
    + '.splash-version{position:absolute;right:18px;bottom:14px;z-index:5;font-size:10px;font-weight:700;letter-spacing:.08em;color:rgba(235,225,255,.46);text-transform:uppercase;text-shadow:0 1px 12px rgba(0,0,0,.55);pointer-events:none;user-select:none}'
    + '@media(prefers-reduced-motion:reduce){canvas#field,.hex,.vines{display:none}.bar::after{animation:none;transform:scaleX(1)}.update-strip,.update-strip__fill{transition:none}}'
    + '</style></head><body>'
    + '<div class="outer">'
    // VINES — runtime fractal generator (user feedback: 'tendrils that grow
    // and spread, more elegant, more natural, more fractal-like, like ivy
    // sprawling out rather than a couple of wires'). The previous 4-stem +
    // 10-twig static SVG read as 'a couple of wires'. Now we generate ~70
    // recursively-branched paths at script init: 6 primary stems from a
    // center point, each with 2-3 child branches per node, 2-3 levels deep.
    // Stroke width tapers per depth (1.8 → 0.5), animation delay scales
    // with depth so the ivy crawls outward in waves. Random angles + lengths
    // make it look different every launch. See the buildIvy() function below.
    + '<svg class="vines" viewBox="0 0 1280 860" preserveAspectRatio="none">'
    + '<defs><linearGradient id="vineA" x1="0" x2="1"><stop stop-color="#a855f7"/><stop offset=".48" stop-color="#ec4899"/><stop offset="1" stop-color="#67e8f9"/></linearGradient>'
    + '<linearGradient id="vineB" x1="1" x2="0"><stop stop-color="#60a5fa"/><stop offset=".55" stop-color="#a855f7"/><stop offset="1" stop-color="#34d399"/></linearGradient></defs>'
    + '</svg>'
    + '<div class="hex"><svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">'
    + '<defs><pattern id="hexGrid" x="0" y="0" width="56" height="48.5" patternUnits="userSpaceOnUse">'
    + '<polygon points="28,1 55,14.4 55,34.6 28,48 1,34.6 1,14.4" fill="none" stroke="rgba(168,120,255,.45)" stroke-width=".6" />'
    + '</pattern></defs>'
    + '<rect width="100%" height="100%" fill="url(#hexGrid)"/>'
    + '</svg></div>'
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
    + '<div class="deco-top"></div>'
    + '<div class="band"></div>'
    + '<div class="hero">'
    // Personalized greeting (Pica\'s NSFullUserName trick). Falls back
    // to plain "Hydra" if the OS query came up empty (rare).
    + (greetingSafe
        ? '<div class="greet">Hello, ' + greetingSafe + '</div><h1>Hydra</h1>'
        : '<h1>Hydra</h1>')
    + '<div class="sub" id="startup-phase">Starting local server</div>'
    + '<div class="bar"></div>'
    + '<div class="update-strip" id="update-strip"><span class="update-strip__fill" id="update-strip-fill"></span></div>'
    + '</div>'
    + '<div class="splash-version">v' + versionSafe + '</div>'
    + '<div class="deco-bot">'
    +   '<div class="deco-bot__ticks">'
    +     '<span></span><span></span><span></span><span></span><span></span><span></span><span></span>'
    +   '</div>'
    + '</div>'
    + '</div>' // /.card
    + '</div>' // /.outer
    // Canvas is a SIBLING of .outer — pinned to the viewport, stacking above
    // .outer (z-index:3) but below the brand .card (z-index:4 inside .outer
    // stacking context). Letters fall in front of background atmosphere
    // and behind the brand reveal that materializes at t≈5.5 s.
    + '<canvas id="field"></canvas>'
    // ─── PHYSICS SIMULATION — matter-js (Pica-equivalent) ────────────────
    // Vendored matter-js drives the world. Words enter as compound bodies
    // at the top edge, shatter into per-letter bodies on first contact
    // with anything (walls, floor, or another body), then keep colliding
    // like SpaghettiOs until gravity flips upward at t=8s and the pile
    // whooshes out the top. Hard static walls extend 400 px outside the
    // viewport so even fast-moving bodies cannot tunnel through.
    //
    // Reference: ~/Desktop/pica-teardown/05-falling-letters-animation.md
    + '<script>' + MATTER_JS_SRC + '</script>'
    + '<script>(function(){'
    // ─── Fractal ivy generator ──────────────────────────────────────────
    // Recursive branching from a center point. Each stem grows along a
    // Bezier path; at depth N we spawn 1-3 child branches that fork off the
    // parent at random parametric positions (t = 0.4..0.85 along the
    // parent's length). Stroke width tapers with depth so the trunk reads
    // thicker than the leaves. Animation-delay scales with depth so the
    // animation feels like ivy unfurling outward, not all paths drawing
    // simultaneously. NS namespace required for SVG createElement.
    + 'const NS="http://www.w3.org/2000/svg";'
    + 'function buildIvy(){'
    +   'const svg=document.querySelector(".vines");'
    +   'if(!svg)return;'
    // Center point in the SVG viewBox coords (1280×860).
    +   'const cx=640,cy=430;'
    // 6 primary stems radiating outward at randomized angles. Slight angle
    // jitter from a regular hexagon so the result feels organic, not
    // mechanically symmetric.
    +   'const stems=6;'
    +   'for(let i=0;i<stems;i++){'
    +     'const baseAngle=(i/stems)*Math.PI*2+Math.PI*0.5;'
    +     'const angle=baseAngle+(Math.random()-0.5)*0.45;'
    +     'const length=320+Math.random()*220;'
    +     'const grad=i%2===0?"url(#vineA)":"url(#vineB)";'
    +     'growBranch(svg,cx,cy,angle,length,0,3,grad,i*0.08);'
    +   '}'
    + '}'
    + 'function growBranch(svg,x,y,angle,length,depth,maxDepth,stroke,baseDelay){'
    +   'if(depth>maxDepth)return;'
    // Endpoint
    +   'const ex=x+Math.cos(angle)*length;'
    +   'const ey=y+Math.sin(angle)*length;'
    // Curl: control points offset perpendicular to growth direction so the
    // path curves like a real plant tendril, not a straight line.
    +   'const perpX=-Math.sin(angle),perpY=Math.cos(angle);'
    +   'const curl=(Math.random()-0.5)*length*0.4;'
    +   'const cx1=x+Math.cos(angle)*length*0.35+perpX*curl;'
    +   'const cy1=y+Math.sin(angle)*length*0.35+perpY*curl;'
    +   'const cx2=x+Math.cos(angle)*length*0.7+perpX*curl*0.6;'
    +   'const cy2=y+Math.sin(angle)*length*0.7+perpY*curl*0.6;'
    // Stroke width tapers per depth — trunk thick, leaf branches hairline.
    +   'const sw=Math.max(0.5,1.8-depth*0.55);'
    // Stroke: primary stems use the vineA/vineB gradients; deeper twigs
    // fade into a paler bud-colored stroke so the eye reads the hierarchy
    // (trunk → twig → leaf).
    +   'const useStroke=depth===0?stroke:"rgba(190,242,255,"+Math.max(0.32,0.62-depth*0.12)+")";'
    +   'const path=document.createElementNS(NS,"path");'
    +   'path.setAttribute("d","M"+x.toFixed(1)+" "+y.toFixed(1)+" C"+cx1.toFixed(1)+" "+cy1.toFixed(1)+" "+cx2.toFixed(1)+" "+cy2.toFixed(1)+" "+ex.toFixed(1)+" "+ey.toFixed(1));'
    +   'path.setAttribute("stroke",useStroke);'
    +   'path.setAttribute("stroke-width",sw.toFixed(2));'
    +   'path.setAttribute("class",depth===0?"stem":"twig");'
    +   'path.style.animationDelay=(baseDelay+depth*0.45).toFixed(2)+"s";'
    +   'svg.appendChild(path);'
    // Children: 1-3 child branches per node, at random positions along
    // the parent. More children at shallow depths, taper down.
    +   'if(depth<maxDepth){'
    +     'const numChildren=Math.max(1,Math.floor(2.5-depth*0.5+Math.random()*1.2));'
    +     'for(let j=0;j<numChildren;j++){'
    +       'const t=0.45+Math.random()*0.42;'
    +       'const childX=x+(ex-x)*t+perpX*curl*t*0.8;'
    +       'const childY=y+(ey-y)*t+perpY*curl*t*0.8;'
    // Children fork at ±25-60° from the parent direction, alternating
    // sides so the ivy doesn't all bend the same way.
    +       'const sign=j%2===0?1:-1;'
    +       'const fork=(0.45+Math.random()*0.6)*sign;'
    +       'const childLength=length*(0.42+Math.random()*0.28);'
    +       'growBranch(svg,childX,childY,angle+fork,childLength,depth+1,maxDepth,stroke,baseDelay+0.35);'
    +     '}'
    +   '}'
    // Bud at every terminal leaf — small circle that fades in after the
    // branch finishes drawing. Adds the 'unfurled tip' impression Pica's
    // OnboardingScene gives without us having to model leaves.
    +   'if(depth===maxDepth){'
    +     'const bud=document.createElementNS(NS,"circle");'
    +     'bud.setAttribute("cx",ex.toFixed(1));'
    +     'bud.setAttribute("cy",ey.toFixed(1));'
    +     'bud.setAttribute("r",(2.0+Math.random()*1.0).toFixed(2));'
    +     'bud.setAttribute("class","bud");'
    +     'bud.style.animationDelay=(baseDelay+depth*0.45+1.2).toFixed(2)+"s";'
    +     'svg.appendChild(bud);'
    +   '}'
    + '}'
    + 'buildIvy();'
    + 'const phases=["Starting local server","Checking database","Loading dashboard","Preparing vault"];'
    + 'const phaseEl=document.getElementById("startup-phase");'
    + 'const updateStrip=document.getElementById("update-strip");'
    + 'const updateFill=document.getElementById("update-strip-fill");'
    + 'let phaseIndex=0,updateActive=false;'
    + 'if(phaseEl){setInterval(()=>{if(updateActive)return;phaseIndex=(phaseIndex+1)%phases.length;phaseEl.textContent=phases[phaseIndex];},2200);}'
    + 'function updateSplashProgress(payload){'
    + 'payload=payload||{};const pct=Math.max(0,Math.min(100,Number(payload.percent)||0));'
    + 'if(payload.state==="downloading"||payload.state==="available"||payload.state==="downloaded"){'
    + 'updateActive=true;if(updateStrip)updateStrip.classList.add("is-active");if(updateFill)updateFill.style.transform="scaleX("+(pct/100)+")";'
    + 'if(phaseEl){const version=payload.version||"latest";phaseEl.textContent=payload.state==="downloaded"?"Installing v"+version:"Updating to v"+version;}'
    + '}else if(payload.state==="error"){'
    + 'updateActive=false;if(updateStrip)updateStrip.classList.remove("is-active");'
    + '}'
    + '}'
    + 'if(window.hydraSplash&&window.hydraSplash.onUpdateProgress){window.hydraSplash.onUpdateProgress(updateSplashProgress);}'
    + 'const items=' + itemsJson + ';'
    + 'const cvs=document.getElementById("field");if(!cvs)return;'
    + 'const ctx=cvs.getContext("2d");'
    // Canvas covers the full splash window (position:fixed/inset:0). Backing
    // store sized to devicePixelRatio so glyphs stay crisp on Retina.
    + 'function size(){const dpr=Math.min(devicePixelRatio||1,2);'
    +   'const w=window.innerWidth||1,h=window.innerHeight||1;'
    +   'cvs.style.width=w+"px";cvs.style.height=h+"px";'
    +   'cvs.width=Math.round(w*dpr);cvs.height=Math.round(h*dpr);'
    +   'ctx.setTransform(dpr,0,0,dpr,0,0);}'
    + 'size();window.addEventListener("resize",size);'
    + 'function W(){return window.innerWidth||1;}function H(){return window.innerHeight||1;}'
    // ─── matter.js handles + engine ──────────────────────────────────────
    + 'const M=Matter,Eng=M.Engine,Wld=M.World,Bod=M.Bodies,Body=M.Body,Comp=M.Composite,Evt=M.Events,Run=M.Runner;'
    + 'const engine=Eng.create({enableSleeping:true,positionIterations:8,velocityIterations:6});'
    // intro gravity. matter.js gravity is dimensionless × scale. scale=0.0012
    // gives ~1.0 g a fall feel comparable to Pica\'s introGravity.
    + 'engine.world.gravity.x=0;engine.world.gravity.y=1.0;engine.world.gravity.scale=0.0012;'
    // ─── HARD WALLS at the viewport edges ────────────────────────────────
    // Each wall is 400 px thick and extends 3× the viewport dimension along
    // its length, so even a body integrated past the visible edge during
    // one frame is still inside a wall and gets resolved correctly. This
    // is the root cure for the user-reported "letters escape the box" bug:
    // visual container and physics container are now the same surface.
    + 'const WT=400;'
    + 'function buildWalls(){const w=W(),h=H(),lx=Math.max(w,1200)*3,ly=Math.max(h,900)*3;return['
    +   'Bod.rectangle(w/2,h+WT/2,lx,WT,{isStatic:true,label:"hwall"}),'   // floor
    +   'Bod.rectangle(w/2,-WT/2,lx,WT,{isStatic:true,label:"hwall"}),'    // ceiling
    +   'Bod.rectangle(-WT/2,h/2,WT,ly,{isStatic:true,label:"hwall"}),'    // left
    +   'Bod.rectangle(w+WT/2,h/2,WT,ly,{isStatic:true,label:"hwall"})'   // right
    + '];}'
    + 'let walls=buildWalls();Wld.add(engine.world,walls);'
    + 'window.addEventListener("resize",function(){Wld.remove(engine.world,walls);walls=buildWalls();Wld.add(engine.world,walls);});'
    // ─── Color palette + helpers (single typeface, per-text deterministic color)
    + 'const PALETTE=["#ec4899","#22d3ee","#fbbf24","#a3e635","#fb923c","#d946ef","#38bdf8","#f87171","#a78bfa","#34d399","#fde047","#fb7185","#67e8f9","#c084fc","#fdba74"];'
    + 'function hashStr(s){let h=0;for(let i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h|=0;}return Math.abs(h);}'
    + 'const FAMILY="-apple-system,SF Pro Display,Inter,Helvetica Neue,Arial,sans-serif";'
    + 'function fontFor(size,weight){return weight+" "+size+"px "+FAMILY;}'
    // ─── spawnWord — a single rectangular body the size of the rendered word
    + 'function spawnWord(text,color,fontSize,weight){'
    +   'ctx.font=fontFor(fontSize,weight);'
    +   'const bw=ctx.measureText(text).width+8,bh=fontSize*1.18;'
    +   'const minX=bw/2+28,maxX=Math.max(minX+1,W()-bw/2-28);'
    +   'const x=minX+Math.random()*(maxX-minX);'
    +   'const body=Bod.rectangle(x,-bh*0.6,bw,bh,{'
    +     'restitution:0.16,friction:0.62,frictionAir:0.012,density:0.0014,chamfer:{radius:5},'
    +     'label:"hword",'
    +     'plugin:{hydra:{kind:"word",text:text,color:color,fontSize:fontSize,weight:weight}}'
    +   '});'
    +   'Body.setAngularVelocity(body,(Math.random()-0.5)*0.08);'
    +   'Body.setVelocity(body,{x:(Math.random()-0.5)*1.5,y:0});'
    +   'Wld.add(engine.world,body);'
    + '}'
    // ─── shatter — replace the word body with one rectangle body per glyph.
    // Each letter INHERITS the parent\'s linear and angular velocity AS-IS:
    // no upward kick, no random scatter. Letters continue from where the
    // word was, now as individuals colliding like SpaghettiOs.
    + 'function shatter(wb){'
    +   'const m=wb.plugin&&wb.plugin.hydra;'
    +   'if(!m||m.kind!=="word")return;'
    +   'const text=m.text,color=m.color,fontSize=m.fontSize,weight=m.weight;'
    +   'const pv=wb.velocity,pav=wb.angularVelocity,pa=wb.angle;'
    +   'const cos=Math.cos(pa),sin=Math.sin(pa);'
    +   'const px=wb.position.x,py=wb.position.y;'
    +   'Wld.remove(engine.world,wb);'
    +   'ctx.font=fontFor(fontSize,weight);'
    +   'const totalW=ctx.measureText(text).width;'
    +   'let cursor=-totalW/2;'
    +   'for(let i=0;i<text.length;i++){'
    +     'const ch=text[i];'
    +     'if(ch===" "){cursor+=fontSize*0.32;continue;}'
    +     'const cw=ctx.measureText(ch).width+2;'
    +     'const lxLocal=cursor+cw/2;'
    +     'cursor+=cw;'
    +     'const wx=px+lxLocal*cos;const wy=py+lxLocal*sin;'
    +     'const letter=Bod.rectangle(wx,wy,cw,fontSize*1.08,{'
    +       'restitution:0.18,friction:0.74,frictionAir:0.015,density:0.0011,chamfer:{radius:3},'
    +       'angle:pa,label:"hletter",'
    +       'plugin:{hydra:{kind:"letter",text:ch,color:color,fontSize:fontSize,weight:weight}}'
    +     '});'
    +     'Body.setVelocity(letter,{x:pv.x,y:pv.y});'
    +     'Body.setAngularVelocity(letter,pav+(Math.random()-0.5)*0.05);'
    +     'Wld.add(engine.world,letter);'
    +   '}'
    + '}'
    // ─── Shatter trigger: ANY collision involving a word body. Words burst
    // on first contact — wall, floor, ceiling, or another body — exactly
    // the "SpaghettiOs" behavior the user asked for.
    + 'Evt.on(engine,"collisionStart",function(evt){'
    +   'for(let i=0;i<evt.pairs.length;i++){'
    +     'const A=evt.pairs[i].bodyA,B=evt.pairs[i].bodyB;'
    +     'if(A.plugin&&A.plugin.hydra&&A.plugin.hydra.kind==="word")shatter(A);'
    +     'if(B.plugin&&B.plugin.hydra&&B.plugin.hydra.kind==="word")shatter(B);'
    +   '}'
    + '});'
    // ─── Spawn queue — shuffle items + repeat to fill the trickle window.
    + 'function shuffle(a){return a.slice().sort(function(){return Math.random()-0.5;});}'
    + 'function buildQueue(n){const out=[];while(out.length<n){const s=shuffle(items);for(let k=0;k<s.length&&out.length<n;k++)out.push(s[k]);}return out;}'
    // 80 words over ~8 s = 10/sec — Pica\'s languid trickle, not a burst.
    + 'const TARGET=80;'
    + 'const queue=buildQueue(TARGET);'
    + 'let spawnIdx=0;'
    + 'const spawnTimer=setInterval(function(){'
    +   'if(spawnIdx>=queue.length){clearInterval(spawnTimer);return;}'
    +   'const it=queue[spawnIdx++];'
    +   'const isBrand=it.tag==="brand";'
    +   'const fontSize=isBrand?(30+Math.floor(Math.random()*10)):(20+Math.floor(Math.random()*8));'
    +   'const weight=isBrand?"800":"600";'
    +   'const color=it.color||PALETTE[hashStr(it.text)%PALETTE.length];'
    +   'spawnWord(it.text,color,fontSize,weight);'
    + '},100);'
    // ─── Two gravity regimes — flip up at t=8s. Apply an upward velocity
    // impulse to every dynamic body so the settled pile launches together
    // rather than waiting for the new gravity field to accelerate them.
    + 'setTimeout(function(){'
    +   'engine.world.gravity.y=-1.45;'
    +   'const all=Comp.allBodies(engine.world);'
    +   'for(let i=0;i<all.length;i++){const b=all[i];'
    +     'if(b.isStatic)continue;'
    +     'Body.setVelocity(b,{x:b.velocity.x+(Math.random()-0.5)*2.5,y:-3.5-Math.random()*1.5});'
    +     'Body.setAngularVelocity(b,b.angularVelocity+(Math.random()-0.5)*0.08);'
    +   '}'
    + '},8000);'
    // Start the physics runner.
    + 'Run.run(Run.create(),engine);'
    // ─── Render — draw each body as a rotated glyph at its world transform.
    + 'function render(){'
    +   'ctx.clearRect(0,0,W(),H());'
    +   'const all=Comp.allBodies(engine.world);'
    +   'for(let i=0;i<all.length;i++){const b=all[i];'
    +     'if(b.isStatic||!b.plugin||!b.plugin.hydra)continue;'
    +     'const m=b.plugin.hydra;'
    +     'ctx.save();'
    +     'ctx.translate(b.position.x,b.position.y);'
    +     'ctx.rotate(b.angle);'
    +     'ctx.fillStyle=m.color;'
    +     'ctx.font=fontFor(m.fontSize,m.weight);'
    +     'ctx.textAlign="center";ctx.textBaseline="middle";'
    +     'ctx.fillText(m.text,0,0);'
    +     'ctx.restore();'
    +   '}'
    +   'requestAnimationFrame(render);'
    + '}'
    + 'requestAnimationFrame(render);'
    + '})();</script>'
    + '</body></html>';

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
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Hydra',
    // macOS: hide the grey OS title bar but keep traffic-light buttons,
    // inset so they sit inside our own renderer-drawn chrome strip. The
    // renderer's `.app-chrome--mac` reserves the left padding so the
    // lights don't overlap the brand mark. Without the renderer chrome
    // and the matching CSS class the window would have no visible drag
    // region — see src/App.jsx AppChrome.
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 12 } }
      : { frame: true }),
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
