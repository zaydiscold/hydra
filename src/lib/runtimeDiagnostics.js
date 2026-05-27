const GLOBAL_STATE_KEY = '__HYDRA_RENDERER_DIAGNOSTICS_STATE__';
const GLOBAL_API_KEY = '__HYDRA_RENDERER_DIAGNOSTICS__';

function getState() {
  if (typeof globalThis === 'undefined') {
    return null;
  }

  if (!globalThis[GLOBAL_STATE_KEY]) {
    globalThis[GLOBAL_STATE_KEY] = {
      nextId: 1,
      timeouts: new Map(),
      intervals: new Map(),
      animationFrames: new Map(),
      animations: new Map(),
    };
  }

  return globalThis[GLOBAL_STATE_KEY];
}

function normalizeOwner(owner) {
  const value = String(owner || 'unknown').trim();
  return value || 'unknown';
}

function summarizeMap(map) {
  const byOwner = {};
  for (const meta of map.values()) {
    byOwner[meta.owner] = (byOwner[meta.owner] || 0) + 1;
  }
  return { active: map.size, byOwner };
}

export function getRendererDiagnostics() {
  const state = getState();
  if (!state) {
    return {
      timeouts: { active: 0, byOwner: {} },
      intervals: { active: 0, byOwner: {} },
      animationFrames: { active: 0, byOwner: {} },
      animations: { active: 0, byOwner: {} },
    };
  }

  const timeouts = summarizeMap(state.timeouts);
  const intervals = summarizeMap(state.intervals);
  const animationFrames = summarizeMap(state.animationFrames);
  const animations = summarizeMap(state.animations);
  return {
    generatedAt: Date.now(),
    timeouts,
    intervals,
    animationFrames,
    animations,
    activeTotal: timeouts.active + intervals.active + animationFrames.active + animations.active,
  };
}

export function installRendererDiagnostics() {
  if (typeof window === 'undefined') return;
  getState();
  window[GLOBAL_API_KEY] = getRendererDiagnostics;
}

export function setTrackedTimeout(owner, fn, ms) {
  const state = getState();
  let timer = null;
  timer = setTimeout(() => {
    state?.timeouts.delete(timer);
    fn();
  }, ms);
  state?.timeouts.set(timer, { owner: normalizeOwner(owner), ms, startedAt: Date.now() });
  return timer;
}

export function clearTrackedTimeout(timer) {
  if (!timer) return;
  clearTimeout(timer);
  getState()?.timeouts.delete(timer);
}

export function setTrackedInterval(owner, fn, ms) {
  const state = getState();
  const timer = setInterval(fn, ms);
  state?.intervals.set(timer, { owner: normalizeOwner(owner), ms, startedAt: Date.now() });
  return timer;
}

export function clearTrackedInterval(timer) {
  if (!timer) return;
  clearInterval(timer);
  getState()?.intervals.delete(timer);
}

export function requestTrackedAnimationFrame(owner, fn) {
  const state = getState();
  let frame = null;
  frame = requestAnimationFrame((timestamp) => {
    state?.animationFrames.delete(frame);
    fn(timestamp);
  });
  state?.animationFrames.set(frame, { owner: normalizeOwner(owner), startedAt: Date.now() });
  return frame;
}

export function cancelTrackedAnimationFrame(frame) {
  if (!frame) return;
  cancelAnimationFrame(frame);
  getState()?.animationFrames.delete(frame);
}

export function trackRendererAnimation(owner, animation) {
  if (!animation) return () => {};

  const state = getState();
  const id = state ? state.nextId++ : 0;
  let active = true;
  const cleanup = () => {
    if (!active) return;
    active = false;
    state?.animations.delete(id);
  };

  state?.animations.set(id, { owner: normalizeOwner(owner), startedAt: Date.now() });

  if (typeof animation.then === 'function') {
    animation.then(cleanup).catch(cleanup);
  }

  return () => {
    try {
      if (typeof animation.cancel === 'function') animation.cancel();
      else if (typeof animation.pause === 'function') animation.pause();
    } finally {
      cleanup();
    }
  };
}

installRendererDiagnostics();
