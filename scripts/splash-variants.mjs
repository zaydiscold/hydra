#!/usr/bin/env node
/**
 * splash-variants.mjs — generate 5 standalone splash previews for taste-testing.
 *
 * The five variants are now substantially different in BEHAVIOR (not just
 * tunables): different word-splitting strategies, different spawn cadences,
 * different physics regimes. Each one feels like a different splash.
 *
 *   1. letters    — one body PER CHARACTER (Pica-pure). Words land + scramble.
 *   2. split      — split words >5 chars into 2 chunks ("DeepSeek" → "Deep"+"Seek").
 *   3. words      — one body per whole word (current default in app).
 *   4. stream     — continuous stream of words, never stops, recycles.
 *   5. settle     — fast spawn-all + heavy damping → clean static pile by t=4s.
 *
 * Run:  node scripts/splash-variants.mjs
 * Output: splash-previews/{1..5}-<name>.html + index.html
 *
 * Open each in your browser to compare. No app rebuild required.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'splash-previews');
mkdirSync(OUT, { recursive: true });

// Word list mirrors electron/app/windows.js — see comment there for curation
// notes (frontier labs + frontier models + image/video/audio + bio).
const ITEMS = [
  { text: 'OpenAI', tag: 'brand', color: '#10a37f' },
  { text: 'Anthropic', tag: 'brand', color: '#d97757' },
  { text: 'Google', tag: 'brand', color: '#4285f4' },
  { text: 'DeepSeek', tag: 'brand', color: '#4d6bfe' },
  { text: 'Meta', tag: 'brand', color: '#0668e1' },
  { text: 'Mistral', tag: 'brand', color: '#f90' },
  { text: 'xAI', tag: 'brand', color: '#e5e5e5' },
  { text: 'Cohere', tag: 'brand', color: '#39594d' },
  { text: 'Kimi', tag: 'brand', color: '#6c5ce7' },
  { text: 'MiniMax', tag: 'brand', color: '#ff6b6b' },
  { text: 'Perplexity', tag: 'brand', color: '#1fb8cd' },
  { text: 'Qwen', tag: 'brand', color: '#615ced' },
  { text: 'HuggingFace', tag: 'brand', color: '#ffbd45' },
  { text: 'Together', tag: 'brand', color: '#6e56cf' },
  { text: 'Groq', tag: 'brand', color: '#f55036' },
  { text: 'Fireworks', tag: 'brand', color: '#fb923c' },
  { text: 'Nous Research', tag: 'brand', color: '#a78bfa' },
  { text: 'Black Forest', tag: 'brand', color: '#fb7185' },
  { text: 'Liquid AI', tag: 'brand', color: '#22d3ee' },
  { text: 'Sakana', tag: 'brand', color: '#fbbf24' },
  { text: 'Reka', tag: 'brand', color: '#a78bfa' },
  { text: 'Inflection', tag: 'brand', color: '#34d399' },
  { text: 'Allen AI', tag: 'brand', color: '#60a5fa' },
  { text: 'AI21', tag: 'brand', color: '#f472b6' },
  { text: 'Stability', tag: 'brand', color: '#c084fc' },
  { text: 'Modal', tag: 'brand', color: '#7dd3fc' },
  { text: 'Replicate', tag: 'brand', color: '#fdba74' },
  { text: 'Snowflake', tag: 'brand', color: '#38bdf8' },
  { text: 'GPT-5', tag: 'model' },
  { text: 'GPT-5 Pro', tag: 'model' },
  { text: 'GPT-4.1', tag: 'model' },
  { text: 'GPT-4o', tag: 'model' },
  { text: 'Opus 4.5', tag: 'model' },
  { text: 'Sonnet 4.5', tag: 'model' },
  { text: 'Haiku 4.5', tag: 'model' },
  { text: 'Claude 4.5', tag: 'model' },
  { text: 'Gemini 3 Pro', tag: 'model' },
  { text: 'Gemini 2.5', tag: 'model' },
  { text: 'Gemma 3', tag: 'model' },
  { text: 'Gemma 3n', tag: 'model' },
  { text: 'Llama 4', tag: 'model' },
  { text: 'Llama Maverick', tag: 'model' },
  { text: 'Llama Scout', tag: 'model' },
  { text: 'DeepSeek R1', tag: 'model' },
  { text: 'DeepSeek V3', tag: 'model' },
  { text: 'DeepSeek V3.1', tag: 'model' },
  { text: 'Qwen 3', tag: 'model' },
  { text: 'Qwen3-Max', tag: 'model' },
  { text: 'Qwen Coder', tag: 'model' },
  { text: 'Qwopus', tag: 'model' },
  { text: 'Mistral Large', tag: 'model' },
  { text: 'Mistral Medium', tag: 'model' },
  { text: 'Mixtral', tag: 'model' },
  { text: 'Pixtral', tag: 'model' },
  { text: 'Codestral', tag: 'model' },
  { text: 'Grok 4', tag: 'model' },
  { text: 'Grok 4.1', tag: 'model' },
  { text: 'Command A', tag: 'model' },
  { text: 'Command R+', tag: 'model' },
  { text: 'Kimi K2', tag: 'model' },
  { text: 'MiniMax M1', tag: 'model' },
  { text: 'Sonar Pro', tag: 'model' },
  { text: 'Sonar Reasoning', tag: 'model' },
  { text: 'Hermes 4', tag: 'model' },
  { text: 'DeepHermes', tag: 'model' },
  { text: 'Phi-4', tag: 'model' },
  { text: 'Yi-Lightning', tag: 'model' },
  { text: 'Carnice', tag: 'model' },
  { text: 'Reka Flash', tag: 'model' },
  { text: 'Flux', tag: 'model', color: '#fb7185' },
  { text: 'Flux Pro', tag: 'model', color: '#fb7185' },
  { text: 'Sora 2', tag: 'model' },
  { text: 'Veo 3', tag: 'model' },
  { text: 'Kling 2', tag: 'model' },
  { text: 'Runway', tag: 'model' },
  { text: 'AlphaFold 3', tag: 'model', color: '#34d399' },
  { text: 'ESM-2', tag: 'model', color: '#34d399' },
  { text: 'ESMFold', tag: 'model', color: '#34d399' },
  { text: 'RFDiffusion', tag: 'model', color: '#34d399' },
  { text: 'Boltz-1', tag: 'model', color: '#34d399' },
  { text: 'Chai-1', tag: 'model', color: '#34d399' },
  { text: 'Bonsai', tag: 'model', color: '#34d399' },
  { text: 'ProGen2', tag: 'model', color: '#34d399' },
  { text: 'Evo 2', tag: 'model', color: '#34d399' },
  { text: 'OpenFold', tag: 'model', color: '#34d399' },
];

/**
 * Each variant lists ONLY what differs from the base. Behaviors:
 *
 *   splitMode  — 'letters' | 'split' | 'words' | 'stream' | 'settle'
 *   density    — bodies per (jar area / 30000 px²)
 *   spawnMs    — total time for the spawn cadence (stream = repeat after this)
 *   fontMul    — multiplier on the base font size range
 *   restitution / airDamp / angDamp / restThr
 */
const VARIANTS = [
  {
    label: 'letters',
    blurb: 'PICA-PURE — one body per CHARACTER. Words spell out, then scramble into a tight letter pile. Most dynamic.',
    splitMode: 'letters',
    density: 1.5, spawnMs: 4000, fontMul: 1.0,
    G: 2400, RES: 0.32, FRIC: 0.72, AIR_DAMP: 0.992, ANG_AIR: 0.985, ANG_REST: 0.78, REST_THR: 26,
  },
  {
    label: 'split',
    blurb: 'CHUNKED — words >5 letters split in two ("DeepSeek" → "Deep" + "Seek"). Falls together, separates on impact.',
    splitMode: 'split',
    density: 1.0, spawnMs: 4500, fontMul: 1.0,
    G: 2600, RES: 0.28, FRIC: 0.78, AIR_DAMP: 0.992, ANG_AIR: 0.985, ANG_REST: 0.82, REST_THR: 30,
  },
  {
    label: 'words',
    blurb: 'WHOLE WORDS — one body per full brand/model name. Sparse, very readable, what shipped previously.',
    splitMode: 'words',
    density: 0.6, spawnMs: 4500, fontMul: 1.0,
    G: 2600, RES: 0.28, FRIC: 0.78, AIR_DAMP: 0.992, ANG_AIR: 0.985, ANG_REST: 0.82, REST_THR: 30,
  },
  {
    label: 'stream',
    blurb: 'STREAM — words pour in continuously and recycle. Never settles. "Endless data" feel.',
    splitMode: 'stream',
    density: 0.5, spawnMs: 9000, fontMul: 0.85,
    G: 2400, RES: 0.34, FRIC: 0.78, AIR_DAMP: 0.992, ANG_AIR: 0.985, ANG_REST: 0.85, REST_THR: 24,
  },
  {
    label: 'settle',
    blurb: 'SETTLE — fast spawn (all in 2s) + heavy damping. Clean static pile by t≈4s. Calm end-state.',
    splitMode: 'settle',
    density: 0.8, spawnMs: 2000, fontMul: 0.95,
    G: 3000, RES: 0.18, FRIC: 0.7, AIR_DAMP: 0.985, ANG_AIR: 0.97, ANG_REST: 0.65, REST_THR: 40,
  },
];

const ITEMS_JSON = JSON.stringify(ITEMS);

function pageHtml(variant) {
  const v = variant;
  const navItems = VARIANTS.map((x, i) => `
        <a href="${i+1}-${x.label}.html"${x.label===v.label?' class="active"':''}>${i+1} ${x.label}</a>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Hydra splash — variant: ${v.label}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{height:100%;background:#0a0a14;
    font-family:'Intel One Mono','JetBrains Mono','SF Mono','Menlo',ui-monospace,monospace;
    color:#fff;overflow:hidden;-webkit-font-smoothing:antialiased}
  body::before{content:"";position:fixed;inset:0;
    background:
      radial-gradient(circle at 20% 30%,rgba(120,80,255,.18) 0%,transparent 60%),
      radial-gradient(circle at 80% 70%,rgba(80,200,255,.14) 0%,transparent 60%),
      radial-gradient(circle at 60% 20%,rgba(255,90,200,.12) 0%,transparent 50%),
      linear-gradient(135deg,#0a0a14 0%,#1a1428 50%,#0a0a1a 100%);
    z-index:0}
  .label{position:fixed;top:16px;left:20px;z-index:50;
    font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.5)}
  .label strong{color:#fff;font-weight:700;letter-spacing:.18em}
  .blurb{position:fixed;top:36px;left:20px;z-index:50;font-size:12px;color:rgba(255,255,255,.55);max-width:640px}
  .nav{position:fixed;top:16px;right:20px;z-index:50;font-size:11px;display:flex;gap:8px;
    color:rgba(255,255,255,.6);letter-spacing:.12em}
  .nav a{color:rgba(255,255,255,.55);text-decoration:none;padding:4px 10px;border-radius:8px;
    background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.10);transition:all .15s}
  .nav a:hover{background:rgba(255,255,255,.12);color:#fff}
  .nav a.active{background:rgba(168,85,247,.35);color:#fff;border-color:rgba(168,85,247,.5)}

  .outer{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);
    width:min(78vw,1700px);height:min(78vh,1100px);border-radius:32px;
    background:rgba(255,255,255,.08);
    backdrop-filter:blur(60px) saturate(180%) brightness(1.04);
    -webkit-backdrop-filter:blur(60px) saturate(180%) brightness(1.04);
    box-shadow:
      0 70px 160px rgba(0,0,0,.55),
      0 30px 60px rgba(0,0,0,.30),
      0 0 0 .5px rgba(255,255,255,.05),
      inset 0 0 0 1px rgba(255,255,255,.06),
      inset 0 1.5px 0 rgba(255,255,255,.22),
      inset 0 14px 28px -12px rgba(255,255,255,.12),
      inset 0 -2px 0 rgba(0,0,0,.40),
      inset 0 -24px 50px -16px rgba(0,0,0,.32),
      inset 6px 0 22px -12px rgba(255,255,255,.08),
      inset -6px 0 22px -12px rgba(255,255,255,.08),
      inset 0 0 100px rgba(255,255,255,.025);
    overflow:hidden;z-index:3}
  .outer::before{content:"";position:absolute;inset:0;border-radius:inherit;
    background:radial-gradient(ellipse 130% 80% at 50% -10%,
      rgba(255,255,255,.18) 0%,rgba(255,255,255,.06) 30%,transparent 60%);
    pointer-events:none;z-index:1}
  .outer::after{content:"";position:absolute;inset:0;border-radius:inherit;
    background:radial-gradient(ellipse 120% 60% at 50% 110%,
      rgba(0,0,0,.20) 0%,rgba(0,0,0,.08) 35%,transparent 60%);
    pointer-events:none;z-index:1}

  canvas#field{position:absolute;inset:0;width:100%;height:100%;
    pointer-events:none;z-index:1;display:block}

  .card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.94);
    width:540px;height:400px;border-radius:16px;
    background:rgba(8,4,18,.85);
    backdrop-filter:blur(24px) saturate(150%);-webkit-backdrop-filter:blur(24px) saturate(150%);
    border:1px solid rgba(255,255,255,.12);
    box-shadow:0 30px 80px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.10);
    overflow:hidden;z-index:2;opacity:0;
    animation:cardIn 800ms 5500ms cubic-bezier(.22,.61,.36,1) forwards}
  @keyframes cardIn{
    0%{opacity:0;transform:translate(-50%,-50%) scale(.94)}
    60%{opacity:1;transform:translate(-50%,-50%) scale(1.01)}
    100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}
  .deco-top{position:absolute;left:0;right:0;top:0;height:25%;
    background:linear-gradient(180deg,rgba(8,4,18,.92) 0%,rgba(8,4,18,.86) 80%,rgba(8,4,18,.0) 100%),
      repeating-linear-gradient(-30deg,rgba(168,85,247,.08) 0,rgba(168,85,247,.08) 1px,transparent 1px,transparent 14px);
    border-bottom:1px solid rgba(168,85,247,.18);pointer-events:none;z-index:1}
  .deco-bot{position:absolute;left:0;right:0;bottom:0;height:25%;
    background:linear-gradient(0deg,rgba(8,4,18,.92) 0%,rgba(8,4,18,.86) 80%,rgba(8,4,18,.0) 100%),
      repeating-linear-gradient(30deg,rgba(120,200,255,.07) 0,rgba(120,200,255,.07) 1px,transparent 1px,transparent 14px);
    border-top:1px solid rgba(120,200,255,.16);pointer-events:none;z-index:1}
  .band{position:absolute;left:0;right:0;top:38%;height:24%;
    background:linear-gradient(90deg,rgba(18,6,38,.86),rgba(36,10,58,.94) 50%,rgba(18,6,38,.86));
    border-top:1px solid rgba(255,90,200,.22);border-bottom:1px solid rgba(120,200,255,.18);
    pointer-events:none;z-index:1}
  .hero{position:absolute;inset:0;display:flex;flex-direction:column;
    align-items:center;justify-content:center;padding:0 24px;z-index:2}
  h1{font-size:42px;font-weight:800;
    background:linear-gradient(180deg,#fff 0%,rgba(255,255,255,.78) 100%);
    -webkit-background-clip:text;background-clip:text;color:transparent;
    text-shadow:0 2px 30px rgba(120,80,255,.35);margin-bottom:6px}
  .sub{font-size:11px;font-weight:600;color:rgba(220,200,255,.55);
    letter-spacing:.18em;text-transform:uppercase}
  .bar{width:220px;height:3px;border-radius:999px;background:rgba(255,255,255,.08);
    overflow:hidden;margin-top:18px;position:relative}
  .bar::after{content:"";display:block;width:100%;height:100%;border-radius:inherit;
    background:linear-gradient(90deg,#a855f7,#ec4899,#60a5fa);
    box-shadow:0 0 14px rgba(168,85,247,.6);
    transform-origin:left center;transform:scaleX(0);
    animation:fillbar 10s cubic-bezier(.22,.61,.36,1) forwards}
  @keyframes fillbar{0%{transform:scaleX(0)}68%{transform:scaleX(.78)}100%{transform:scaleX(1)}}
</style>
</head>
<body>
  <div class="label">VARIANT <strong>${v.label}</strong></div>
  <div class="blurb">${v.blurb}</div>
  <nav class="nav">${navItems}
  </nav>

  <div class="outer">
    <canvas id="field"></canvas>
    <div class="card">
      <div class="deco-top"></div>
      <div class="band"></div>
      <div class="hero">
        <h1>Hydra</h1>
        <div class="sub">Initializing OpenRouter Manager</div>
        <div class="bar"></div>
      </div>
      <div class="deco-bot"></div>
    </div>
  </div>

<script>
${physicsScript(v)}
</script>
</body>
</html>
`;
}

/**
 * The physics + spawn script — varies by splitMode.
 *
 * Common improvements over previous versions (fixes the overlap/cutoff bugs
 * the user observed):
 *  - Multi-pass collision solver (3 iterations/frame) — resolves dense
 *    overlaps that single-pass leaves behind.
 *  - Locked rotation when resting (vRot=0 once b.resting) — pile stops
 *    visually jittering.
 *  - Floor clamp INSIDE the collision pass too — prevents words from being
 *    pushed below the floor by inter-body separation.
 *  - Density cap based on jar area / body area — never spawn more than the
 *    jar can physically hold.
 */
function physicsScript(v) {
  return `
(function(){
  const items = ${ITEMS_JSON};
  const SPLIT_MODE = ${JSON.stringify(v.splitMode)};
  const DENSITY = ${v.density};
  const SPAWN_MS = ${v.spawnMs};
  const FONT_MUL = ${v.fontMul};
  const G = ${v.G}, RES = ${v.RES}, FRIC = ${v.FRIC};
  const AIR_DAMP = ${v.AIR_DAMP}, ANG_AIR = ${v.ANG_AIR}, ANG_REST = ${v.ANG_REST};
  const REST_THR = ${v.REST_THR}, FLOOR_PAD = 18, WALL_PAD = 14;
  const SOLVER_ITERS = 3;  // multi-pass collision resolution

  const cvs = document.getElementById('field');
  const ctx = cvs.getContext('2d');
  function size() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = cvs.clientWidth || 1, h = cvs.clientHeight || 1;
    cvs.width = w * dpr; cvs.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  size();
  new ResizeObserver(size).observe(cvs);
  const W = () => cvs.clientWidth || 1, H = () => cvs.clientHeight || 1;

  // ─── Word splitting strategy ──────────────────────────────────────────
  // Returns array of {text, color, tag} pieces from one item.
  function splitItem(it) {
    const t = it.text;
    if (SPLIT_MODE === 'letters') {
      // One piece per char, but skip spaces (would render as gaps)
      return Array.from(t).filter(c => c !== ' ').map(c => ({text:c, color:it.color, tag:it.tag}));
    }
    if (SPLIT_MODE === 'split') {
      // Long words break in two; "DeepSeek" → "Deep"+"Seek"
      if (t.length <= 5) return [{...it}];
      if (t.includes(' ')) return t.split(' ').filter(Boolean).map(w => ({text:w, color:it.color, tag:it.tag}));
      const cm = t.match(/^([A-Z][a-z]+)([A-Z].+)$/);
      if (cm) return [{text:cm[1], color:it.color, tag:it.tag}, {text:cm[2], color:it.color, tag:it.tag}];
      const m = Math.floor(t.length / 2);
      return [{text:t.slice(0,m), color:it.color, tag:it.tag}, {text:t.slice(m), color:it.color, tag:it.tag}];
    }
    // 'words' / 'stream' / 'settle' all use whole words
    return [{...it}];
  }

  // ─── Body factory ─────────────────────────────────────────────────────
  function bodyFromPiece(p, i, total, spawnMsOverride) {
    const isB = p.tag === 'brand';
    const isLetter = SPLIT_MODE === 'letters';
    let baseSize;
    if (isLetter) {
      baseSize = 48 + Math.floor(Math.random() * 22);
    } else {
      // Smaller + airier (mirror of live splash). Brands 26–40, models 18–28.
      baseSize = isB ? (26 + Math.floor(Math.random() * 14)) : (18 + Math.floor(Math.random() * 10));
    }
    const fontSize = Math.round(baseSize * FONT_MUL);
    const weight = isB ? 600 : 400;
    ctx.font = weight + ' ' + fontSize + 'px "Intel One Mono",monospace';
    const w = ctx.measureText(p.text).width + 6, h = fontSize * 1.05;
    const x = w / 2 + 24 + Math.random() * Math.max(40, W() - w - 48);
    const spawnAt = Math.floor((i / total) * (spawnMsOverride || SPAWN_MS) + Math.random() * 200);
    return {
      text: p.text,
      color: p.color || (isB ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.65)'),
      weight, fontSize, w, h, x,
      mass: Math.max(0.3, (w * h) / 2200 + 0.4),
      I: (w * w + h * h) / 12,
      y: -h - Math.random() * H() * 0.4,
      vx: (Math.random() - 0.5) * 120, vy: 0,
      rot: (Math.random() - 0.5) * 0.4, vRot: (Math.random() - 0.5) * 1.8,
      spawnAt, alive: false, resting: false, onFloor: false,
      // Stream mode marks bodies for recycle when off-floor + below screen
      recycleAt: SPLIT_MODE === 'stream' ? null : null,
    };
  }

  // ─── Initial spawn — split every item, then cap to density ────────────
  const allPieces = [];
  for (const it of items) {
    for (const p of splitItem(it)) allPieces.push(p);
  }
  // Density cap: target ~(jar area / 30000 px²) bodies, scaled by DENSITY.
  // 'letters' mode allows 1.5× because each body is small.
  const TARGET = Math.max(20, Math.min(160, Math.floor(W() * H() / 30000 * DENSITY)));
  // Fill the pool by repeating-and-shuffling pieces until we hit target.
  function repeatToFill(arr, n) {
    const out = [];
    while (out.length < n) for (const p of arr.slice().sort(() => Math.random() - 0.5)) out.push(p);
    return out.slice(0, n);
  }
  const queue = repeatToFill(allPieces, TARGET);
  const bodies = queue.map((p, i) => bodyFromPiece(p, i, TARGET));

  // ─── Frame loop ───────────────────────────────────────────────────────
  let last = performance.now(); const t0 = last;

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    const t = now - t0;
    const cw = W(), ch = H(); ctx.clearRect(0, 0, cw, ch);

    // ─── Spawn / activate ──────────────────────────────────────────────
    for (const b of bodies) if (!b.alive && t >= b.spawnAt) b.alive = true;

    // ─── Stream recycling: any body that has gone way off-screen below
    //     the floor (should not happen, but guard) OR resting beyond
    //     refresh window gets re-spawned at the top.
    if (SPLIT_MODE === 'stream') {
      for (const b of bodies) {
        if (b.alive && b.resting && b.spawnAt + 9000 < t) {
          // Re-launch from top with new random
          b.x = b.w / 2 + 24 + Math.random() * Math.max(40, cw - b.w - 48);
          b.y = -b.h - Math.random() * ch * 0.4;
          b.vx = (Math.random() - 0.5) * 120; b.vy = 0;
          b.rot = (Math.random() - 0.5) * 0.4; b.vRot = (Math.random() - 0.5) * 1.8;
          b.resting = false; b.onFloor = false; b.spawnAt = t;
        }
      }
    }

    // ─── Integrate (gravity + air drag + walls + floor) ────────────────
    const floorY = ch - FLOOR_PAD;
    for (const b of bodies) {
      if (!b.alive) continue;
      b.vy += G * dt;
      b.vx *= AIR_DAMP; b.vy *= AIR_DAMP;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.rot += b.vRot * dt;
      b.vRot *= (b.onFloor || b.resting ? ANG_REST : ANG_AIR);
      b.onFloor = false;
      // Floor clamp
      if (b.y + b.h / 2 >= floorY) {
        b.y = floorY - b.h / 2; b.onFloor = true;
        if (b.vy > 0) {
          b.vy = -b.vy * RES;
          if (Math.abs(b.vy) < REST_THR) { b.vy = 0; b.resting = true; b.vRot = 0; }
        }
        b.vx *= FRIC;
        if (Math.abs(b.vx) < REST_THR / 4) b.vx = 0;
      }
      // Walls
      if (b.x - b.w / 2 < WALL_PAD) {
        b.x = WALL_PAD + b.w / 2;
        if (b.vx < 0) b.vx = -b.vx * RES;
      } else if (b.x + b.w / 2 > cw - WALL_PAD) {
        b.x = cw - WALL_PAD - b.w / 2;
        if (b.vx > 0) b.vx = -b.vx * RES;
      }
    }

    // ─── Inter-body collision — MULTI-PASS for clean stacks ────────────
    // Single-pass leaves residual overlap when many bodies are wedged
    // together. Three passes resolve the pile cleanly.
    for (let pass = 0; pass < SOLVER_ITERS; pass++) {
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i]; if (!a.alive) continue;
        for (let j = i + 1; j < bodies.length; j++) {
          const c = bodies[j]; if (!c.alive) continue;
          const dx = c.x - a.x, dy = c.y - a.y;
          const halfW = (a.w + c.w) / 2, halfH = (a.h + c.h) / 2;
          if (Math.abs(dx) >= halfW || Math.abs(dy) >= halfH) continue;
          const ox = halfW - Math.abs(dx), oy = halfH - Math.abs(dy);
          let nx, ny, overlap;
          if (ox < oy) { nx = dx < 0 ? -1 : 1; ny = 0; overlap = ox; }
          else { nx = 0; ny = dy < 0 ? -1 : 1; overlap = oy; }
          const mt = a.mass + c.mass, sa = c.mass / mt, sc = a.mass / mt;
          a.x -= nx * overlap * sa; a.y -= ny * overlap * sa;
          c.x += nx * overlap * sc; c.y += ny * overlap * sc;
          // Re-clamp to floor IMMEDIATELY after separation (prevents
          // bodies from being pushed through the floor during pile-up)
          if (a.y + a.h / 2 > floorY) { a.y = floorY - a.h / 2; if (a.vy > 0) a.vy = 0; }
          if (c.y + c.h / 2 > floorY) { c.y = floorY - c.h / 2; if (c.vy > 0) c.vy = 0; }
          // Impulse only on first pass (later passes are pure separation)
          if (pass === 0) {
            const rvx = c.vx - a.vx, rvy = c.vy - a.vy, vn = rvx * nx + rvy * ny;
            if (vn < 0) {
              const J = -(1 + RES) * vn / (1 / a.mass + 1 / c.mass);
              const Jx = J * nx, Jy = J * ny;
              a.vx -= Jx / a.mass; a.vy -= Jy / a.mass;
              c.vx += Jx / c.mass; c.vy += Jy / c.mass;
              const tA = (nx === 0 ? dx : dy) * 0.0008;
              a.vRot -= tA * J / a.I; c.vRot += tA * J / c.I;
              if (ny > 0) { a.resting = true; a.onFloor = true; }
              if (ny < 0) { c.resting = true; c.onFloor = true; }
            }
          }
        }
      }
    }

    // ─── Render ────────────────────────────────────────────────────────
    for (const b of bodies) {
      if (!b.alive) continue;
      ctx.save();
      ctx.translate(b.x, b.y); ctx.rotate(b.rot);
      ctx.fillStyle = b.color;
      ctx.font = b.weight + ' ' + b.fontSize + 'px "Intel One Mono",monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.text, 0, 0);
      ctx.restore();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();`;
}

function indexHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Hydra splash · all variants</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{height:100%;background:#000;font-family:'Intel One Mono',monospace;color:#fff}
  .grid{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:auto 1fr 1fr 1fr;height:100%;gap:2px;background:#222}
  .cell{position:relative;background:#0a0a14;overflow:hidden;cursor:pointer}
  .cell iframe{position:absolute;inset:0;width:117.6%;height:117.6%;border:0;transform:scale(.85);transform-origin:top left}
  .cell .tag{position:absolute;top:8px;left:12px;z-index:10;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#fff;text-shadow:0 2px 6px #000;background:rgba(0,0,0,.55);padding:4px 10px;border-radius:6px}
  .header{grid-column:1/-1;background:#0a0a14;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #222}
  .header h1{font-size:14px;letter-spacing:.3em;text-transform:uppercase}
  .header span{font-size:11px;color:#888;max-width:60ch;text-align:right}
</style>
</head><body>
<div class="grid">
  <div class="header"><h1>Hydra Splash · 5 Behavioral Variants</h1><span>click any tile to open fullscreen · close tab to dismiss · variants differ in WORD-SPLITTING strategy + spawn cadence + physics</span></div>
  ${VARIANTS.map((v, i) => `
  <div class="cell" onclick="window.open('${i+1}-${v.label}.html','_blank')">
    <span class="tag">${i+1} · ${v.label} — ${v.splitMode}</span>
    <iframe src="${i+1}-${v.label}.html" loading="lazy"></iframe>
  </div>`).join('')}
</div>
</body></html>`;
}

VARIANTS.forEach((v, i) => {
  const file = resolve(OUT, `${i + 1}-${v.label}.html`);
  writeFileSync(file, pageHtml(v));
  console.log(`wrote ${file}`);
});
writeFileSync(resolve(OUT, 'index.html'), indexHtml());
console.log(`wrote ${resolve(OUT, 'index.html')}`);
console.log('');
console.log('Open the side-by-side index:');
console.log(`  open ${resolve(OUT, 'index.html')}`);
