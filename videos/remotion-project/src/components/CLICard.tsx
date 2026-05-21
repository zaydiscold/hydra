import React from 'react';
import { interpolate, useCurrentFrame, AbsoluteFill, spring, useVideoConfig } from 'remotion';

interface CLICardProps {
  duration: number;
}

/**
 * CLI showcase frame. No screenshot needed — the terminal itself is the
 * visual. Mimics a macOS terminal window with the three traffic-light
 * buttons, then types out a few hydra commands with their representative
 * output. Apple-style framing: dark vibrant panel, soft drop shadow,
 * lots of negative space, monospace front-and-center.
 */
export const CLICard: React.FC<CLICardProps> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entry = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 110 },
    durationInFrames: 24,
  });
  const exit = interpolate(
    frame,
    [duration - 20, duration],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const opacity = entry * exit;
  const scale = 0.94 + entry * 0.06;

  const lines = [
    { text: '$ hydra status --json | jq .ready', appearAt: 6, color: '#67e8f9' },
    { text: 'true', appearAt: 26, color: '#a3e635' },
    { text: '$ hydra doctor --json', appearAt: 40, color: '#67e8f9' },
    { text: '{ "vault": "ok", "proxy": "ok", "fleet": 24 }', appearAt: 60, color: '#a3e635' },
    { text: '$ hydra proxy status', appearAt: 80, color: '#67e8f9' },
    { text: 'router=http://127.0.0.1:3001/v1  pooled=8  healthy=8', appearAt: 100, color: '#a3e635' },
    { text: '$ hydra ai chat "hello" --route proxy', appearAt: 122, color: '#67e8f9' },
    { text: 'hello — local routing through your fleet.', appearAt: 142, color: '#a3e635' },
  ];

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity,
      }}
    >
      <div
        style={{
          width: 1320,
          background: '#0a0a14',
          borderRadius: 16,
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 30px 120px rgba(168, 85, 247, 0.32), 0 8px 32px rgba(0, 0, 0, 0.6)',
          overflow: 'hidden',
          transform: `scale(${scale})`,
          fontFamily:
            '"SF Mono", "JetBrains Mono", "Menlo", ui-monospace, monospace',
        }}
      >
        {/* Traffic-light bar — macOS chrome */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '14px 18px',
            background: '#13131c',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          <span style={{ width: 12, height: 12, borderRadius: 6, background: '#ff5f57' }} />
          <span style={{ width: 12, height: 12, borderRadius: 6, background: '#febc2e' }} />
          <span style={{ width: 12, height: 12, borderRadius: 6, background: '#28c840' }} />
          <span
            style={{
              marginLeft: 16,
              color: '#8e8e93',
              fontSize: 14,
              letterSpacing: 0.5,
            }}
          >
            zayd@local — hydra
          </span>
        </div>

        {/* Terminal body */}
        <div style={{ padding: '36px 42px 44px', minHeight: 420 }}>
          {lines.map((line, i) => {
            const lineOpacity = interpolate(
              frame,
              [line.appearAt, line.appearAt + 6],
              [0, 1],
              { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
            );
            return (
              <div
                key={i}
                style={{
                  color: line.color,
                  fontSize: 22,
                  lineHeight: 1.78,
                  letterSpacing: 0.2,
                  opacity: lineOpacity,
                }}
              >
                {line.text}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
