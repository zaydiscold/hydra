import React from 'react';
import { interpolate, useCurrentFrame, AbsoluteFill, spring, useVideoConfig } from 'remotion';

interface TitleCardProps {
  word: string;
  tagline: string;
  duration: number;
}

/**
 * Intro / outro title card. Single oversized word (Apple "Pro Display XDR."
 * vibe) sliding up with a smaller tagline below. No screenshot behind —
 * lets the cosmic background do the work.
 */
export const TitleCard: React.FC<TitleCardProps> = ({ word, tagline, duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entry = spring({
    frame,
    fps,
    config: { damping: 22, stiffness: 100 },
    durationInFrames: 30,
  });
  const exit = interpolate(
    frame,
    [duration - 24, duration],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const opacity = entry * exit;
  const translateY = (1 - entry) * 32;

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
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
        }}
      >
        <div
          style={{
            fontSize: 220,
            fontWeight: 700,
            letterSpacing: '-0.05em',
            lineHeight: 0.95,
            background:
              'linear-gradient(180deg, #ffffff 0%, #c4c4d6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            textShadow: '0 8px 60px rgba(168, 85, 247, 0.45)',
          }}
        >
          {word}
        </div>
        <div
          style={{
            fontSize: 38,
            fontWeight: 400,
            color: '#c7c7cc',
            marginTop: 28,
            letterSpacing: '-0.01em',
          }}
        >
          {tagline}
        </div>
      </div>
    </AbsoluteFill>
  );
};
