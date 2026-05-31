import { useCallback, useEffect, useRef } from 'react';
import {
  cancelTrackedAnimationFrame,
  requestTrackedAnimationFrame,
} from '../lib/runtimeDiagnostics.js';

const TARGET_SELECTOR = '[data-proximity-target]';

function resetTarget(target) {
  target.style.removeProperty('--proximity-strength');
  target.style.removeProperty('--proximity-scale');
  target.style.removeProperty('--proximity-lift');
  target.style.removeProperty('--proximity-shift-x');
  target.style.removeProperty('--proximity-attract-x');
  target.style.removeProperty('--proximity-attract-y');
  target.style.removeProperty('--proximity-brightness');
}

export function useProximityField({
  owner = 'ProximityField',
  radius = 220,
  maxScale = 0.035,
  maxLift = 4,
  maxShiftX = 0,
  maxAttractX = 0,
  maxAttractY = 0,
  brightnessDelta = 0.08,
} = {}) {
  const fieldRef = useRef(null);
  const pointerRef = useRef(null);
  const frameRef = useRef(null);

  const reset = useCallback(() => {
    if (frameRef.current) {
      cancelTrackedAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    pointerRef.current = null;
    fieldRef.current?.querySelectorAll(TARGET_SELECTOR).forEach(resetTarget);
  }, []);

  const paint = useCallback(() => {
    frameRef.current = null;
    const field = fieldRef.current;
    const pointer = pointerRef.current;
    if (!field || !pointer) return;

    field.querySelectorAll(TARGET_SELECTOR).forEach((target) => {
      const bounds = target.getBoundingClientRect();
      const dx = pointer.x - (bounds.left + bounds.width / 2);
      const dy = pointer.y - (bounds.top + bounds.height / 2);
      const strength = Math.max(0, 1 - Math.hypot(dx, dy) / radius);
      target.style.setProperty('--proximity-strength', strength.toFixed(3));
      target.style.setProperty('--proximity-scale', (1 + strength * maxScale).toFixed(4));
      target.style.setProperty('--proximity-lift', `${(strength * maxLift).toFixed(2)}px`);
      target.style.setProperty('--proximity-shift-x', `${(strength * maxShiftX).toFixed(2)}px`);
      target.style.setProperty('--proximity-attract-x', `${Math.max(-maxAttractX, Math.min(maxAttractX, dx * strength * 0.12)).toFixed(2)}px`);
      target.style.setProperty('--proximity-attract-y', `${Math.max(-maxAttractY, Math.min(maxAttractY, dy * strength * 0.1)).toFixed(2)}px`);
      target.style.setProperty('--proximity-brightness', (1 + strength * brightnessDelta).toFixed(3));
    });
  }, [brightnessDelta, maxAttractX, maxAttractY, maxLift, maxScale, maxShiftX, radius]);

  const onPointerMove = useCallback((event) => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      reset();
      return;
    }
    pointerRef.current = { x: event.clientX, y: event.clientY };
    if (!frameRef.current) {
      frameRef.current = requestTrackedAnimationFrame(owner, paint);
    }
  }, [owner, paint, reset]);

  useEffect(() => reset, [reset]);

  return {
    ref: fieldRef,
    onPointerMove,
    onPointerLeave: reset,
  };
}
