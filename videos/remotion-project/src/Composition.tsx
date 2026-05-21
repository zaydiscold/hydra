import React from 'react';
import { AbsoluteFill, Series } from 'remotion';
import { CosmicBackground } from './components/CosmicBackground';
import { UIPan } from './components/UIPan';
import { HUD } from './components/HUD';
import { Caption } from './components/Caption';
import { CLICard } from './components/CLICard';
import { TitleCard } from './components/TitleCard';

export const MyComposition: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <CosmicBackground />

      <Series>
        <Series.Sequence durationInFrames={90}>
          <TitleCard
            word="Hydra"
            tagline="Local OpenRouter fleet control."
            duration={90}
          />
        </Series.Sequence>

        <Series.Sequence durationInFrames={120}>
          <UIPan image="dashboard.png" duration={120} />
          <Caption
            title="Fleet Overview"
            subtitle="Balances, health, and status across every account."
            duration={120}
          />
        </Series.Sequence>

        <Series.Sequence durationInFrames={120}>
          <UIPan image="vault.png" duration={120} />
          <Caption
            title="Vault"
            subtitle="Encrypted account metadata with secrets kept out of capture."
            duration={120}
            position="top"
          />
        </Series.Sequence>

        <Series.Sequence durationInFrames={120}>
          <UIPan image="pool.png" duration={120} />
          <Caption
            title="Proxy Pool"
            subtitle="Per-account proxy rotation and pooled-key router health."
            duration={120}
          />
        </Series.Sequence>

        <Series.Sequence durationInFrames={120}>
          <UIPan image="traffic.png" duration={120} />
          <Caption
            title="Traffic"
            subtitle="Bounded request logs, status rows, and latency signals."
            duration={120}
            position="top"
          />
        </Series.Sequence>

        <Series.Sequence durationInFrames={150}>
          <CLICard duration={150} />
        </Series.Sequence>
      </Series>

      <HUD />
    </AbsoluteFill>
  );
};
