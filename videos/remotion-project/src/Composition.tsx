import React from 'react';
import { AbsoluteFill, Series } from 'remotion';
import { CosmicBackground } from './components/CosmicBackground';
import { UIPan } from './components/UIPan';
import { Caption } from './components/Caption';
import { CLICard } from './components/CLICard';
import { TitleCard } from './components/TitleCard';

// Apple-style 7-frame showreel — 570 frames @ 30 fps = 19s.
//
// Trimmed from 27s per user feedback ("Vault / Command take too long").
// Shorter total = smaller GIF at higher fidelity per frame.
//
// Frame budget:
//   Intro title    60  (2.0s)
//   Vault          45  (1.5s)  ← lock screen flashes by
//   Command        60  (2.0s)  ← trimmed from 4s
//   One router    105  (3.5s)
//   Every request 105  (3.5s)
//   Terminal      135  (4.5s)  ← CLI deserves the breathing room
//   Outro title    60  (2.0s)
//
// HUD removed — cyberpunk magenta corner brackets clashed with the
// Apple-style typography of Caption / TitleCard. CosmicBackground stays.
export const MyComposition: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <CosmicBackground />

      <Series>
        <Series.Sequence durationInFrames={60}>
          <TitleCard
            word="Hydra."
            tagline="Your OpenRouter fleet. On your desk."
            duration={60}
          />
        </Series.Sequence>

        <Series.Sequence durationInFrames={45}>
          <UIPan image="vault.png" duration={45} />
          <Caption
            title="Vault."
            subtitle="Local-first encryption. Your keys never leave your machine."
            duration={45}
            position="bottom"
          />
        </Series.Sequence>

        <Series.Sequence durationInFrames={60}>
          <UIPan image="dashboard.png" duration={60} />
          <Caption
            title="Command."
            subtitle="Every account, every balance, every status. At a glance."
            duration={60}
            position="bottom"
          />
        </Series.Sequence>

        <Series.Sequence durationInFrames={105}>
          <UIPan image="pool.png" duration={105} />
          <Caption
            title="One router."
            subtitle="A local OpenAI-compatible endpoint. Every model. Every account."
            duration={105}
            position="bottom"
          />
        </Series.Sequence>

        <Series.Sequence durationInFrames={105}>
          <UIPan image="traffic.png" duration={105} />
          <Caption
            title="Every request."
            subtitle="Bounded logs. Built-in retention. Production-grade observability."
            duration={105}
            position="bottom"
          />
        </Series.Sequence>

        <Series.Sequence durationInFrames={135}>
          <CLICard duration={135} />
          <Caption
            title="Terminal-native."
            subtitle="The whole fleet, scriptable. JSON-first. Built for automation."
            duration={135}
            position="top"
          />
        </Series.Sequence>

        <Series.Sequence durationInFrames={60}>
          <TitleCard
            word="Hydra."
            tagline="Local. Open source. Yours."
            duration={60}
          />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
