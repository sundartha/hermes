// Phase 3 — Render-Komposition (Remotion). Nimmt einen RenderPlan (das JSON aus
// dem Studio) und rendert das fertige Marken-Reel: Higgsfield-Clip + Fluegel-
// Overlay (Intro/Outro) + Untertitel + Sign-off, im 9:16-Markenlook.
//
// Benoetigt remotion + react (siehe remotion/README.md). Bewusst getrennt vom
// Vite-Studio, damit das Studio ohne den schweren Render-Stack laeuft.

import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// Form entspricht src/compose/renderPlan.ts (RenderPlan).
type CaptionBeat = { at: number; until: number; text: string };
export type ReelProps = {
  clipUrl: string | null;
  durationSec: number;
  brand: { gold: string; deepBlue: string; paper: string; font: string; signoff: string };
  captions: CaptionBeat[];
};

export const HermesReel: React.FC<ReelProps> = ({ clipUrl, brand, captions, durationSec }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  // Fluegel-Intro: schwebt herein (0-1.2s) und am Ende wieder als Outro-Akzent.
  const introY = interpolate(t, [0, 1.2], [-120, 0], { extrapolateRight: "clamp" });
  const wingOpacity = interpolate(
    t,
    [0, 0.6, durationSec - 1.5, durationSec],
    [0, 1, 1, 0.85],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: brand.deepBlue, fontFamily: brand.font }}>
      {clipUrl ? (
        <OffthreadVideo src={clipUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", color: brand.paper }}>
          <span style={{ opacity: 0.5 }}>Kein Clip — Higgsfield-Clip-URL im Plan setzen</span>
        </AbsoluteFill>
      )}

      {/* Hermes-Fluegel als Marken-Akzent oben */}
      <Img
        src={staticFile("hermes-wing.png")}
        style={{
          position: "absolute",
          top: 120 + introY,
          left: "50%",
          width: 360,
          transform: "translateX(-50%)",
          opacity: wingOpacity,
          filter: `drop-shadow(0 0 24px ${brand.gold})`,
        }}
      />

      {/* Untertitel */}
      {captions.map((c, i) => (
        <Sequence key={i} from={Math.round(c.at * fps)} durationInFrames={Math.round((c.until - c.at) * fps)}>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 240 }}>
            <span
              style={{
                color: brand.paper,
                background: "rgba(11,27,43,0.72)",
                padding: "16px 28px",
                borderRadius: 16,
                fontSize: 52,
                fontWeight: 800,
                maxWidth: "82%",
                textAlign: "center",
                borderBottom: `4px solid ${brand.gold}`,
              }}
            >
              {c.text}
            </span>
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
