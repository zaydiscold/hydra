import React from 'react';
import { AbsoluteFill, Series } from 'remotion';
import { CosmicBackground } from './components/CosmicBackground';
import { UIPan } from './components/UIPan';
import { HUD } from './components/HUD';

export const MyComposition: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <CosmicBackground />
      
      <Series>
        {/* Dashboard 5s */}
        <Series.Sequence durationInFrames={150}>
          <UIPan image="dashboard.png" duration={150} />
        </Series.Sequence>
        
        {/* Vault 5s */}
        <Series.Sequence durationInFrames={150}>
          <UIPan image="vault.png" duration={150} />
        </Series.Sequence>
        
        {/* Pool 5s */}
        <Series.Sequence durationInFrames={150}>
          <UIPan image="pool.png" duration={150} />
        </Series.Sequence>
        
        {/* Traffic 5s */}
        <Series.Sequence durationInFrames={150}>
          <UIPan image="traffic.png" duration={150} />
        </Series.Sequence>
      </Series>

      <HUD />
    </AbsoluteFill>
  );
};
