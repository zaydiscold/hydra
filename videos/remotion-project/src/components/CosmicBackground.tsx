import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig, staticFile, AbsoluteFill } from 'remotion';

export const CosmicBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();

  // Slow zoom in effect (Ken Burns)
  const scale = interpolate(
    frame,
    [0, durationInFrames],
    [1, 1.2],
    { extrapolateRight: 'clamp' }
  );

  // Subtle rotation
  const rotation = interpolate(
    frame,
    [0, durationInFrames],
    [0, 5],
    { extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#000', overflow: 'hidden' }}>
      <img
        src={staticFile('background.png')}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale}) rotate(${rotation}deg)`,
          opacity: 0.8,
        }}
      />
      {/* Add a scanline overlay for that brutalist/tech feel */}
      <AbsoluteFill
        style={{
          background: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06))',
          backgroundSize: '100% 2px, 3px 100%',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
