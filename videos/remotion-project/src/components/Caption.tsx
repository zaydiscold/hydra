import React from 'react';
import { interpolate, useCurrentFrame, AbsoluteFill, spring, useVideoConfig } from 'remotion';

interface CaptionProps {
  title: string;
  subtitle: string;
  duration: number;
  position?: 'top' | 'bottom';
}

/**
 * Apple-style frame caption: large display-weight title with a quiet
 * one-line subtitle. Slides up + fades in on entry, fades out before the
 * frame ends. Mirrors Apple keynote / product page typography — heavy
 * negative letter-spacing on the title, secondary-text grey for the
 * subtitle, SF Pro Display via the system stack.
 */
export const Caption: React.FC<CaptionProps> = ({
  title,
  subtitle,
  duration,
  position = 'bottom',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entry = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 110 },
    durationInFrames: 24,
  });
  const fadeOut = interpolate(
    frame,
    [duration - 20, duration],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const opacity = entry * fadeOut;
  const translateY = (1 - entry) * 24;

  const verticalAlign = position === 'top' ? 'flex-start' : 'flex-end';
  const verticalPadding = position === 'top' ? { paddingTop: 120 } : { paddingBottom: 110 };

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: verticalAlign,
        pointerEvents: 'none',
        ...verticalPadding,
      }}
    >
      <div
        style={{
          textAlign: 'center',
          opacity,
          transform: `translateY(${translateY}px)`,
          fontFamily:
            '-apple-system, "SF Pro Display", "Inter", "Helvetica Neue", system-ui, sans-serif',
          color: '#ffffff',
          textShadow: '0 2px 24px rgba(0, 0, 0, 0.55)',
        }}
      >
        <div
          style={{
            fontSize: 92,
            fontWeight: 700,
            letterSpacing: '-0.04em',
            lineHeight: 1,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 30,
            fontWeight: 400,
            color: '#c7c7cc',
            marginTop: 22,
            letterSpacing: '-0.01em',
            maxWidth: 1180,
            lineHeight: 1.32,
          }}
        >
          {subtitle}
        </div>
      </div>
    </AbsoluteFill>
  );
};
