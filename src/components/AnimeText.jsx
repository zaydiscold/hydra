import { useEffect, useRef } from 'react';
import { animate, createTimeline, splitText, stagger } from 'animejs';
import { trackRendererAnimation } from '../lib/runtimeDiagnostics.js';

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export default function AnimeText({
  as = 'span',
  children,
  className = '',
  mode = 'chars',
  variant = 'rise',
  delay = 18,
  duration = 520,
  ...props
}) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || prefersReducedMotion()) return undefined;

    const splitOptions = {};
    if (mode === 'lines') splitOptions.lines = { wrap: 'clip' };
    if (mode === 'words' || mode === 'both') splitOptions.words = { wrap: 'clip' };
    if (mode === 'chars' || mode === 'both') splitOptions.chars = { wrap: 'clip' };
    const splitter = splitText(node, splitOptions);
    const animationDisposers = [];
    const trackAnimation = (animation) => {
      animationDisposers.push(trackRendererAnimation(`AnimeText.${variant}`, animation));
      return animation;
    };

    splitter.addEffect(({ lines, words, chars }) => {
      const targets = mode === 'lines' ? lines : mode === 'words' ? words : chars;
      if (!targets?.length) return undefined;

      if (variant === 'signal') {
        return trackAnimation(createTimeline({
          defaults: { duration, ease: 'out(3)' },
        })
          .add(targets, {
            opacity: [0, 1],
            x: ['0.7em', '0em'],
            filter: ['blur(6px)', 'blur(0px)'],
          }, stagger(delay, { from: 'first' }))
          .add(targets, {
            color: ['var(--accent-secondary)', 'var(--text-primary)'],
            textShadow: ['0 0 22px var(--accent-secondary)', '0 0 0 rgba(0, 0, 0, 0)'],
            duration: Math.max(260, Math.floor(duration * 0.55)),
          }, stagger(Math.max(6, Math.floor(delay / 2)), { from: 'last' })));
      }

      if (variant === 'scanline') {
        return trackAnimation(createTimeline({
          defaults: { duration, ease: 'out(3)' },
        })
          .add(targets, {
            opacity: [0, 1],
            y: ['115%', '0%'],
            filter: ['blur(5px)', 'blur(0px)'],
          }, stagger(delay, { from: 'center' }))
          .add(targets, {
            textShadow: ['0 0 18px var(--accent-secondary)', '0 0 0 rgba(0, 0, 0, 0)'],
            duration: 260,
            ease: 'out(2)',
          }, stagger(Math.max(4, Math.floor(delay / 2)), { from: 'center' })));
      }

      return trackAnimation(animate(targets, {
        opacity: [0, 1],
        y: ['85%', '0%'],
        duration,
        ease: 'out(3)',
        delay: stagger(delay),
      }));
    });

    return () => {
      for (const dispose of animationDisposers.splice(0)) dispose();
      splitter.revert();
    };
  }, [children, delay, duration, mode, variant]);

  const nextClassName = `anime-text anime-text--${variant} ${className}`.trim();
  if (as === 'h1') return <h1 ref={ref} className={nextClassName} {...props}>{children}</h1>;
  if (as === 'h2') return <h2 ref={ref} className={nextClassName} {...props}>{children}</h2>;
  if (as === 'h3') return <h3 ref={ref} className={nextClassName} {...props}>{children}</h3>;
  return <span ref={ref} className={nextClassName} {...props}>{children}</span>;
}
