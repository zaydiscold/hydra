import React from 'react';
import { interpolate, random, useCurrentFrame, AbsoluteFill } from 'remotion';

export const HUD: React.FC = () => {
  const frame = useCurrentFrame();
  const flicker = random(`hud-flicker-${Math.floor(frame / 3)}`) > 0.95 ? 0.2 : 1;

  const opacity = interpolate(
    frame,
    [0, 30],
    [0, 1],
    { extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ opacity, pointerEvents: 'none', fontFamily: 'monospace' }}>
      {/* Corner Brackets */}
      <div style={{
        position: 'absolute',
        top: 40,
        left: 40,
        width: 100,
        height: 100,
        borderLeft: '4px solid #ff00ff',
        borderTop: '4px solid #ff00ff',
      }} />
      <div style={{
        position: 'absolute',
        top: 40,
        right: 40,
        width: 100,
        height: 100,
        borderRight: '4px solid #ff00ff',
        borderTop: '4px solid #ff00ff',
      }} />
      <div style={{
        position: 'absolute',
        bottom: 40,
        left: 40,
        width: 100,
        height: 100,
        borderLeft: '4px solid #ff00ff',
        borderBottom: '4px solid #ff00ff',
      }} />
      <div style={{
        position: 'absolute',
        bottom: 40,
        right: 40,
        width: 100,
        height: 100,
        borderRight: '4px solid #ff00ff',
        borderBottom: '4px solid #ff00ff',
      }} />

      {/* Center Reticle */}
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: 200,
        height: 200,
        transform: 'translate(-50%, -50%)',
        border: '1px solid rgba(255, 0, 255, 0.2)',
        borderRadius: '50%',
      }} />

      {/* Status Bar */}
      <div style={{
        position: 'absolute',
        top: 60,
        width: '100%',
        textAlign: 'center',
        color: '#ff00ff',
        fontSize: 24,
        letterSpacing: 8,
        textShadow: '0 0 10px #ff00ff',
        opacity: flicker,
      }}>
        HYDRA // FLEET_COMMAND_ESTABLISHED
      </div>

      {/* Bottom Data Streams */}
      <div style={{
        position: 'absolute',
        bottom: 60,
        left: 60,
        color: '#ffb3ff',
        fontSize: 14,
        opacity: 0.6,
      }}>
        <div>LAT: 37.7749</div>
        <div>LNG: -122.4194</div>
        <div>SYS: STABLE</div>
        <div>KEYS: 348_SYNCED</div>
      </div>

      <div style={{
        position: 'absolute',
        bottom: 60,
        right: 60,
        color: '#ffb3ff',
        fontSize: 14,
        textAlign: 'right',
        opacity: 0.6,
      }}>
        <div>SIGNAL: ENCRYPTED</div>
        <div>AUTH: BYPASS_ACTIVE</div>
        <div>NODE: LOCAL_SECURE</div>
      </div>
    </AbsoluteFill>
  );
};
