/**
 * Hydra Electron — Splash & Main Window Creation
 *
 * Splash: clean brand grid with model names, subtle animation.
 * Main window: navigation guards + security options.
 */
import { app, BrowserWindow, dialog, screen } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
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
      try { userGreetingName = execSync('id -F', { timeout: 200, encoding: 'utf-8' }).trim(); } catch { /* fall back */ }
    }
    if (!userGreetingName) {
      const u = os.userInfo();
      userGreetingName = (u && u.username) ? u.username.charAt(0).toUpperCase() + u.username.slice(1) : '';
    }
  } catch { /* greeting is best-effort */ }
  // Inject as JS literal — escape any chars that could break out of the
  // single-quoted string in the data URL (newlines, single quotes,
  // backslashes). Defensive even though `id -F` only returns one name.
  const greetingSafe = String(userGreetingName).replace(/[\\'"\n\r]/g, '').slice(0, 80);

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
    + '.outer{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);'
    + 'width:min(92vw,1280px);height:min(86vh,860px);border-radius:28px;'
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
    + '.vines{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;opacity:.9}'
    + '.vines .crawl{fill:none;stroke-linecap:round;stroke-linejoin:round;'
    + 'stroke-dasharray:1 860;stroke-dashoffset:0;animation:crawl 9.6s cubic-bezier(.16,1,.3,1) forwards}'
    + '.vines .hexcell{fill:none;stroke:rgba(168,85,247,.28);stroke-width:1;'
    + 'transform-origin:center;animation:hexPulse 5.4s ease-in-out infinite}'
    + '@keyframes crawl{0%{stroke-dasharray:1 860;opacity:.08}18%{opacity:.92}100%{stroke-dasharray:860 1;opacity:.78}}'
    + '@keyframes hexPulse{0%,100%{opacity:.34;transform:scale(.98)}50%{opacity:.72;transform:scale(1.02)}}'
    // Canvas is clipped by the outer stage, making that stage the physics world.
    + 'canvas#field{position:absolute;inset:0;width:100%;height:100%;'
    + 'pointer-events:none;z-index:2;display:block}'
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
    + '.hex{position:absolute;inset:0;pointer-events:none;opacity:.20;z-index:1;'
    + 'mask-image:radial-gradient(ellipse at center,transparent 0 30%,#000 42%,#000 88%,transparent 100%)}'
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
    + '@media(prefers-reduced-motion:reduce){canvas#field,.hex,.vines{display:none}.bar::after{animation:none;transform:scaleX(1)}}'
    + '</style></head><body>'
    + '<div class="outer">'
    + '<svg class="vines" viewBox="0 0 1280 860" preserveAspectRatio="none">'
    + '<defs><linearGradient id="vineA" x1="0" x2="1"><stop stop-color="#a855f7"/><stop offset=".52" stop-color="#ec4899"/><stop offset="1" stop-color="#60a5fa"/></linearGradient></defs>'
    + '<path class="crawl" d="M640 430 C560 390 472 326 382 250 S204 160 78 136" stroke="url(#vineA)" stroke-width="1.6"/>'
    + '<path class="crawl" d="M640 430 C724 366 812 292 920 246 S1116 214 1222 128" stroke="url(#vineA)" stroke-width="1.4" style="animation-delay:.18s"/>'
    + '<path class="crawl" d="M640 430 C538 474 456 552 358 642 S178 726 62 770" stroke="rgba(96,165,250,.82)" stroke-width="1.3" style="animation-delay:.34s"/>'
    + '<path class="crawl" d="M640 430 C746 494 824 574 930 640 S1100 716 1226 770" stroke="rgba(236,72,153,.82)" stroke-width="1.4" style="animation-delay:.44s"/>'
    + '<path class="crawl" d="M430 430 C322 396 248 368 166 314" stroke="rgba(168,85,247,.58)" stroke-width="1" style="animation-delay:.75s"/>'
    + '<path class="crawl" d="M850 430 C960 390 1036 354 1118 300" stroke="rgba(96,165,250,.58)" stroke-width="1" style="animation-delay:.9s"/>'
    + '<polygon class="hexcell" points="188,122 224,142 224,184 188,204 152,184 152,142"/>'
    + '<polygon class="hexcell" points="1088,154 1126,176 1126,220 1088,242 1050,220 1050,176" style="animation-delay:.4s"/>'
    + '<polygon class="hexcell" points="208,692 252,718 252,770 208,796 164,770 164,718" style="animation-delay:.8s"/>'
    + '<polygon class="hexcell" points="1044,672 1090,699 1090,752 1044,779 998,752 998,699" style="animation-delay:1.1s"/>'
    + '</svg>'
    + '<div class="hex"><svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">'
    + '<defs><pattern id="hexGrid" x="0" y="0" width="56" height="48.5" patternUnits="userSpaceOnUse">'
    + '<polygon points="28,1 55,14.4 55,34.6 28,48 1,34.6 1,14.4" fill="none" stroke="rgba(168,120,255,.45)" stroke-width=".6" />'
    + '</pattern></defs>'
    + '<rect width="100%" height="100%" fill="url(#hexGrid)"/>'
    + '</svg></div>'
    + '<canvas id="field"></canvas>'
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
    + '</div>'
    + '<div class="deco-bot">'
    +   '<div class="deco-bot__ticks">'
    +     '<span></span><span></span><span></span><span></span><span></span><span></span><span></span>'
    +   '</div>'
    + '</div>'
    + '</div>' // /.card
    + '</div>' // /.outer
    // ─── PHYSICS SIMULATION (Pica-style) ──────────────────────────────────
    // SpriteKit-equivalent in browser canvas: gravity → AABB floor +
    // walls → AABB inter-letter separation → angular damping. Each body
    // is a word (rectangle) rendered with its brand color + Intel One
    // Mono. ~18 bodies, n² collision = 324 ops/frame.
    + '<script>(function(){'
    + 'const phases=["Starting local server","Checking database","Loading dashboard","Preparing vault"];'
    + 'const phaseEl=document.getElementById("startup-phase");'
    + 'let phaseIndex=0;'
    + 'if(phaseEl){setInterval(()=>{phaseIndex=(phaseIndex+1)%phases.length;phaseEl.textContent=phases[phaseIndex];},2200);}'
    + 'const items=' + itemsJson + ';'
    + 'const cvs=document.getElementById("field");if(!cvs)return;'
    + 'const ctx=cvs.getContext("2d");'
    // Canvas now lives inside the outer-card, NOT at viewport. Read the
    // CSS-pixel content size from clientWidth/Height — that\'s the jar
    // the physics simulation operates inside. Resize observer keeps the
    // backing store crisp if the BrowserWindow is resized.
    + 'function size(){const dpr=Math.min(devicePixelRatio||1,2);'
    + 'const w=cvs.clientWidth||1,h=cvs.clientHeight||1;'
    + 'cvs.width=w*dpr;cvs.height=h*dpr;'
    + 'ctx.setTransform(dpr,0,0,dpr,0,0);}size();'
    + 'const ro=new ResizeObserver(size);ro.observe(cvs);'
    // Helpers so the physics loop never reaches outside the canvas
    + 'function W(){return cvs.clientWidth||1}function H(){return cvs.clientHeight||1}'
    // PICA-PURE PHYSICS — per-character bodies, organic pile angles.
    // Mirrors the SpriteKit setup from Pica\'s OnboardingScene
    // (~/Desktop/pica-teardown/05-falling-letters-animation.md):
    //   restitution 0.35   — one cushioned bounce
    //   friction 0.6       — surface drag
    //   angularDamping 0.4 — moderate rot decay (NOT a hard snap)
    //   linearDamping 0.1  — light air drag
    //   mass 0.3           — light bodies
    //
    // CSS-canvas equivalent below. Critical: NO floor-contact rot=0
    // snap → pile keeps organic angles like Pica\'s screenshots
    // (letters lean against each other instead of all flat).
    //   G 2200       — slow gravity, falls last long enough to read
    //   RES 0.32     — close to Pica\'s 0.35
    //   FRIC 0.7
    //   AIR_DAMP 0.992
    //   ANG_AIR 0.995  — rotation barely damps in air
    //   ANG_REST 0.92  — rotation slowly damps in pile (not zero)
    //   REST_THR 30
    + 'const G=2200,RES=0.32,FRIC=0.7,AIR_DAMP=0.992,ANG_AIR=0.995,ANG_REST=0.92,REST_THR=30,FLOOR_PAD=18,WALL_PAD=14;'
    // DENSITY: scale body count to viewport. ~1 body per 24,000 px²
    // works out to ~50–75 on common displays (1440×900 = 54, 1920×1200
    // = 96, capped at 100). Repeats are fine — Pica fills the frame
    // by reusing characters of the user\'s name; we mirror that by
    // duplicating the brand+model list as needed.
    // Density relative to OUTER-CARD area, not the screen. With
    // 78vw × 78vh on a 1440×900 monitor the jar is ~1123×702 ≈ 788k px²
    // → ~33 bodies; cap at 80. Slightly lower density per area than
    // before (was 24k px²/body) so big fonts have room to fall + stack.
    // WHOLE-WORD BODIES — back to one rigid body per brand/model name.
    // Per-character was the wrong call: it loses the word identity the
    // user wants to see. We rely on AABB padding + tight density to keep
    // edge-to-edge stacking clean.
    + 'function shuffle(a){return a.slice().sort(()=>Math.random()-0.5);}'
    + 'const TARGET=Math.min(180,Math.max(90,Math.floor(W()*H()/9000)));'
    + 'function repeatToFill(arr,n){const out=[];while(out.length<n)for(const it of shuffle(arr))out.push(it);return out.slice(0,n);}'
    + 'const queue=repeatToFill(items,TARGET);'
    // SINGLE TYPEFACE — Pica uses one display font (ABC Gravity Compressed)
    // for all letters. Single-typeface = visually cohesive, the brand the
    // app stands for. We don\'t ship ABC Gravity, so use Helvetica Neue
    // — the cleanest airy display sans available system-wide on macOS.
    // ALL falling words use this; brand identity is preserved by COLOR
    // (every word colored, no white) + WEIGHT variation (brands 700,
    // models 400) + occasional italic.
    + 'const SOLO_FONT="Helvetica Neue,Helvetica,Arial,sans-serif";'
    // COLOR PALETTE — every word gets a color, none stay white. Bonds
    // the falling-letters mood with the brand-blocks. Models without an
    // explicit color get one picked deterministically by their text hash
    // so the same word always lands the same color across launches.
    + 'const PALETTE=['
    +   '"#ec4899",'  // pink
    +   '"#22d3ee",'  // cyan
    +   '"#fbbf24",'  // yellow
    +   '"#a3e635",'  // lime
    +   '"#fb923c",'  // orange
    +   '"#d946ef",'  // magenta
    +   '"#38bdf8",'  // sky
    +   '"#f87171",'  // coral
    +   '"#a78bfa",'  // soft purple
    +   '"#34d399",'  // mint
    +   '"#fde047",'  // light yellow
    +   '"#fb7185",'  // rose
    +   '"#67e8f9",'  // light cyan
    +   '"#c084fc",'  // lavender
    +   '"#fdba74"'   // peach
    + '];'
    + 'function hashStr(s){let h=0;for(let i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h|=0;}return Math.abs(h);}'
    + 'function makeBody(it,i){'
    + 'const isB=it.tag==="brand";'
    // Varied font sizes — bigger BRAND words contrast with smaller
    // model words. User: "different sized fonts, like between words,
    // since we\'re gonna have so many, some big, some small."
    + 'const fontSize=isB?(28+Math.floor(Math.random()*22)):(18+Math.floor(Math.random()*14));'
    + 'const weight=isB?700:400;'
    // Single typeface (see SOLO_FONT). Italic chosen deterministically
    // by hash so the same word always lands the same italic state.
    + 'const wordHash=hashStr(it.text);'
    + 'const family=SOLO_FONT;'
    + 'const italic=(wordHash%10)<3?"italic ":"";'
    + 'ctx.font=italic+weight+" "+fontSize+"px "+family;'
    + 'const w=ctx.measureText(it.text).width+6,h=fontSize*1.05;'
    + 'const x=w/2+24+Math.random()*Math.max(40,W()-w-48);'
    + 'const spawnAt=Math.floor((i/TARGET)*4500+Math.random()*250);'
    // EVERY word gets a color — no more white text. Models without an
    // explicit color use a deterministic palette pick by text hash.
    + 'const color=it.color||PALETTE[hashStr(it.text)%PALETTE.length];'
    + 'return{text:it.text,color,'
    + 'weight,fontSize,w,h,x,family,italic,'
    // MASS = AABB area / 2200 + 0.4. Bigger words are HEAVIER → push
    // smaller ones around in collisions. Pica\'s SKPhysicsBody uses
    // body.mass = 0.3; we scale by glyph footprint so brand titles
    // feel weighty against shorter model names.
    + 'mass:Math.max(0.3,(w*h)/2200+0.4),'
    // moment-of-inertia approximation for a rectangle — used by the
    // angular-impulse solver below. Real formula is m*(w²+h²)/12.
    + 'I:(w*w+h*h)/12,'
    // Spawn ABOVE the outer-card top edge so words enter as if pouring
    // into a jar. Negative y = outside canvas top.
    + 'y:-h-Math.random()*H()*0.45,'
    + 'vx:(Math.random()-0.5)*140,vy:0,'
    // Bigger initial rotation + spin so tumbling is VISIBLE while
    // airborne. Floor-contact snaps rot=0 so the pile is still flat.
    // Was ±0.45 / ±2.2 → was barely perceptible against high gravity.
    + 'rot:(Math.random()-0.5)*1.4,vRot:(Math.random()-0.5)*4.5,'
    + 'spawnAt,alive:false,resting:false,onFloor:false};}'
    + 'const bodies=queue.map(makeBody);'
    + 'let last=performance.now();const t0=last;'
    + 'function frame(now){'
    + 'const dt=Math.min((now-last)/1000,1/30);last=now;'
    + 'const t=now-t0;'
    // ─── TWO GRAVITY REGIMES (Pica) ────────────────────────────────────
    // Pica\'s OnboardingScene defines `introGravity` and `exitGravity`.
    // First half: gravity DOWN — letters fall + pile. Last 2 s: gravity
    // FLIPS UPWARD with extra magnitude — letters whoosh out the top
    // edge as the splash dismisses.
    + 'const cw=W(),ch=H();ctx.clearRect(0,0,cw,ch);'
    // Activate bodies as their spawn time arrives
    + 'for(const b of bodies){if(!b.alive&&t>=b.spawnAt)b.alive=true;}'
    // Integrate against the OUTER-CARD bounds. Floor + walls are now the
    // glass jar\'s interior, not the screen. Words fall in from the top
    // (y < 0) and pile up against floor.
    + 'const floorY=ch-FLOOR_PAD;'
    + 'for(const b of bodies){if(!b.alive)continue;'
    + 'b.vy+=G*dt;'
    + 'b.vx*=AIR_DAMP;b.vy*=AIR_DAMP;'
    + 'b.x+=b.vx*dt;b.y+=b.vy*dt;'
    + 'b.rot+=b.vRot*dt;'
    + 'b.vRot*=(b.onFloor||b.resting?ANG_REST:ANG_AIR);'
    // Hard freeze: if a body has been resting for at least one frame
    // AND its translational speed is near zero, lock rotation entirely.
    // Without this, fresh collisions on the pile keep spinning settled
    // letters via the torque impulse. (User reported: "things rotating
    // after they\'ve already fallen.")
    + 'if(b.resting&&Math.abs(b.vx)<5&&Math.abs(b.vy)<5){b.vRot=0;}'
    + 'b.onFloor=false;'
    + 'if(b.y+b.h/2>=floorY){b.y=floorY-b.h/2;b.onFloor=true;'
    // NO rot=0 snap on floor contact. Per-character bodies are roughly
    // square, so their rotated AABB matches visual footprint closely
    // enough that the multi-pass solver resolves overlap without forced
    // alignment. Letting rotation persist gives the pile organic
    // leaning angles like Pica\'s onboarding scene.
    + 'if(b.vy>0){b.vy=-b.vy*RES;if(Math.abs(b.vy)<REST_THR){b.vy=0;b.resting=true;}}'
    + 'b.vx*=FRIC;'
    + 'if(Math.abs(b.vx)<REST_THR/4)b.vx=0;'
    + '}'
    // WALLS — restitution + small angular kick (top/bottom of wall hit imparts spin)
    + 'if(b.x-b.w/2<WALL_PAD){b.x=WALL_PAD+b.w/2;'
    +   'if(b.vx<0)b.vx=-b.vx*RES;b.vRot+=b.vy*0.001;}'
    + 'else if(b.x+b.w/2>cw-WALL_PAD){b.x=cw-WALL_PAD-b.w/2;'
    +   'if(b.vx>0)b.vx=-b.vx*RES;b.vRot-=b.vy*0.001;}'
    + '}'
    // ─── INTER-BODY COLLISION — multi-pass solver ─────────────────────────
    // 3 iterations per frame. Single-pass leaves residual overlaps when
    // bodies are wedged into a dense pile (the visible "glitching/
    // overlapping" the user reported). Each iteration resolves any
    // remaining penetration. Impulse-exchange (the "click") happens only
    // on iteration 0 — later passes are pure positional cleanup.
    //
    // After every separation we IMMEDIATELY re-clamp to floor so the
    // mass-proportional push can\'t shove a body below floorY for a
    // frame (was the source of the "cut off at the bottom" bug).
    // Pad collision AABB by 4 px so detection triggers BEFORE visual
    // letterforms touch — gives a thin "Tetris cell gap" between
    // adjacent words and prevents the deck-of-cards layered look.
    + 'const PAD=4;'
    + 'for(let pass=0;pass<3;pass++){'
    + 'for(let i=0;i<bodies.length;i++){const a=bodies[i];if(!a.alive)continue;'
    + 'for(let j=i+1;j<bodies.length;j++){const c=bodies[j];if(!c.alive)continue;'
    + 'const dx=c.x-a.x,dy=c.y-a.y;'
    + 'const halfW=(a.w+c.w)/2+PAD,halfH=(a.h+c.h)/2+PAD;'
    + 'if(Math.abs(dx)>=halfW||Math.abs(dy)>=halfH)continue;'
    + 'const ox=halfW-Math.abs(dx),oy=halfH-Math.abs(dy);'
    + 'let nx,ny,overlap;'
    + 'if(ox<oy){nx=dx<0?-1:1;ny=0;overlap=ox;}'
    + 'else{nx=0;ny=dy<0?-1:1;overlap=oy;}'
    + 'const mt=a.mass+c.mass,sa=c.mass/mt,sc=a.mass/mt;'
    + 'a.x-=nx*overlap*sa;a.y-=ny*overlap*sa;'
    + 'c.x+=nx*overlap*sc;c.y+=ny*overlap*sc;'
    // Re-clamp BOTH bodies to floor immediately
    + 'if(a.y+a.h/2>floorY){a.y=floorY-a.h/2;if(a.vy>0)a.vy=0;}'
    + 'if(c.y+c.h/2>floorY){c.y=floorY-c.h/2;if(c.vy>0)c.vy=0;}'
    // Re-clamp to walls too — same separation can push past a wall
    + 'if(a.x-a.w/2<WALL_PAD)a.x=WALL_PAD+a.w/2;'
    + 'else if(a.x+a.w/2>cw-WALL_PAD)a.x=cw-WALL_PAD-a.w/2;'
    + 'if(c.x-c.w/2<WALL_PAD)c.x=WALL_PAD+c.w/2;'
    + 'else if(c.x+c.w/2>cw-WALL_PAD)c.x=cw-WALL_PAD-c.w/2;'
    // Impulse exchange + torque only on pass 0
    + 'if(pass===0){'
    + 'const rvx=c.vx-a.vx,rvy=c.vy-a.vy,vn=rvx*nx+rvy*ny;'
    + 'if(vn<0){'
    + 'const J=-(1+RES)*vn/(1/a.mass+1/c.mass);'
    + 'const Jx=J*nx,Jy=J*ny;'
    + 'a.vx-=Jx/a.mass;a.vy-=Jy/a.mass;'
    + 'c.vx+=Jx/c.mass;c.vy+=Jy/c.mass;'
    // Off-center torque ONLY if neither body is already resting.
    // Otherwise a fresh letter dropping on a settled pile would spin
    // the settled letters back up — root cause of "rotating after
    // they\'ve already fallen."
    + 'if(!a.resting&&!c.resting){'
    +   'const tA=(nx===0?dx:dy)*0.0008;'
    +   'a.vRot-=tA*J/a.I;c.vRot+=tA*J/c.I;'
    + '}'
    // No rot snap on landing — per-character bodies are square enough
    // that the AABB-vs-visual mismatch is small. Pile keeps organic
    // angles (Pica-style).
    + 'if(ny>0){a.resting=true;a.onFloor=true;}'
    + 'if(ny<0){c.resting=true;c.onFloor=true;}'
    + '}}}}}'
    // Render
    + 'for(const b of bodies){if(!b.alive)continue;'
    + 'ctx.save();ctx.translate(b.x,b.y);ctx.rotate(b.rot);'
    + 'ctx.fillStyle=b.color;'
    + 'ctx.font=b.italic+b.weight+" "+b.fontSize+"px "+b.family;'
    + 'ctx.textAlign="center";ctx.textBaseline="middle";'
    + 'ctx.fillText(b.text,0,0);ctx.restore();}'
    + 'requestAnimationFrame(frame);}'
    + 'requestAnimationFrame(frame);'
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
