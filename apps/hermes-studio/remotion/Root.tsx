// Remotion-Registrierung. Laedt einen RenderPlan (JSON aus dem Studio) als
// Default-Props. Beim Rendern uebergibst du deinen eigenen Plan via --props.

import { Composition } from "remotion";
import { HermesReel, type ReelProps } from "./HermesReel";

// 9:16 Markenformat (entspricht src/brand/bibel.ts FORMAT).
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const DEFAULT_DURATION_SEC = 15;

const defaultProps: ReelProps = {
  clipUrl: null,
  durationSec: DEFAULT_DURATION_SEC,
  brand: {
    gold: "#C9A227",
    deepBlue: "#0B1B2B",
    paper: "#FAF7EF",
    font: "Inter, system-ui, sans-serif",
    signoff: "Hermes — dein Agent ruft an.",
  },
  captions: [{ at: 0.4, until: 5, text: "Dein Agent ruft für dich an." }],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="HermesReel"
      component={HermesReel}
      durationInFrames={DEFAULT_DURATION_SEC * FPS}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={defaultProps}
      // Laenge kommt aus dem Render-Plan (Format: 15/18/20 s), nicht fix.
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.round((props.durationSec ?? DEFAULT_DURATION_SEC) * FPS),
      })}
    />
  );
};
