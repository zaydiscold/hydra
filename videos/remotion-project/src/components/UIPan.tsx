import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig, staticFile, AbsoluteFill, spring } from 'remotion';

interface UIPanProps {
  image: string;
  duration: number;
}

export const UIPan: React.FC<UIPanProps> = ({ image, duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const relativeFrame = frame;

  if (relativeFrame < 0 || relativeFrame >= duration) {
    return null;
  }

  // Fade in and out
  const opacity = interpolate(
    relativeFrame,
    [0, 15, duration - 15, duration],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Smooth entrance scale
  const enterScale = spring({
    frame: relativeFrame,
    fps,
    config: { damping: 12 },
  });

  // Slow drift scale
  const driftScale = interpolate(
    relativeFrame,
    [0, duration],
    [1, 1.1]
  );

  const scale = relativeFrame < 30 ? enterScale * 0.9 + 0.1 : driftScale;

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity,
        transform: `scale(${scale})`,
        filter: 'drop-shadow(0 0 30px rgba(255, 0, 255, 0.3))',
      }}
    >
      <div style={{
        padding: '10px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        backgroundColor: '#0a0a0a',
        borderRadius: '8px',
        overflow: 'hidden',
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
      }}>
        <img
          src={staticFile(image)}
          style={{
            maxWidth: '1600px',
            height: 'auto',
            borderRadius: '4px',
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
