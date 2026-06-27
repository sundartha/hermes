import gsap from "gsap";
import type { HermesMotionState, PresetId } from "../types.js";

// Jede Factory liefert eine pausierte, endlos loopende Schlaggruppe (working).
// Sie tweent NUR die animierten Kanaele (flap/bend/compression/tipLag/rootRotation);
// intensity/speed bleiben in der Hand der Regler. tipLag laeuft als verzoegerter
// Echo-Kanal (eigene, leicht versetzte Tweens) -> elastisches Nachschwingen.

export type KeyPose = { label: string; time: number };

// Nur die ANIMIERTEN Kanaele. rootRotation ist ein statischer Authoring-Tilt
// (Regler) und wird bewusst NICHT pro Zyklus zurueckgesetzt.
const REST_CHANNELS = {
  flap: 0,
  bend: 0,
  compression: 0,
  tipLag: 0,
  lift: 0,
} as const;

/** Loopende Schlaggruppe + Pause dazwischen (working-Status, Preset-Galerie). */
export type PresetCycle = (
  state: HermesMotionState,
  groupPause: number,
) => gsap.core.Timeline;

// --- A · Hermes Classic -----------------------------------------------------
// Getragener Flug, nicht stop-and-go: kraeftiger Abschlag erzeugt Auftrieb
// (lift), der Fluegel schwebt oben aus und sinkt langsam zurueck. Asymmetrisches
// Timing (schneller Schlag, langsames buoyantes Ausschwingen) -> Hermes-Schweben.
const classic: PresetCycle = (state, groupPause) =>
  gsap
    .timeline({ paused: true, repeat: -1, repeatDelay: groupPause })
    .set(state, { ...REST_CHANNELS })
    // 1. Antizipation: Aufladen nach hinten + minimales Absinken (gather)
    .to(state, { flap: -0.34, bend: 0.12, lift: -0.08, duration: 0.12, ease: "power2.inOut" })
    // 2. schneller, kompakter Hauptschlag (Abtrieb der Federn)
    .to(state, { flap: 1, bend: 0.64, compression: 0.5, duration: 0.12, ease: "power3.out" })
    // 3. Auftrieb + Spitzen-Nachschwingen folgen verzoegert (Follow-Through)
    .to(state, { tipLag: 0.55, lift: 0.62, duration: 0.2, ease: "power2.out" }, "-=0.08")
    // 4. buoyantes Ausschweben oben: Fluegel oeffnet, bleibt getragen
    .to(state, { flap: -0.1, bend: 0.2, compression: 0.08, lift: 0.7, duration: 0.24, ease: "sine.out" })
    .to(state, { tipLag: -0.26, duration: 0.22, ease: "power2.out" }, "<")
    // 5. sanfter zweiter Schlag haelt den Schwebezustand (kein voller Stillstand)
    .to(state, { flap: 0.5, bend: 0.34, compression: 0.22, lift: 0.4, duration: 0.16, ease: "power2.inOut" })
    .to(state, { tipLag: 0.22, duration: 0.16, ease: "power2.out" }, "<")
    // 6. langsames, schweres Zurueckgleiten zur Ruhe (Gravitation)
    .to(state, { flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0, duration: 0.36, ease: "sine.inOut" });

// --- B · Rapid Messenger ----------------------------------------------------
// Schnelles Kolibri-Flattern, das den Fluegel sichtbar in der Schwebe haelt:
// jeder Beat gibt einen kleinen Auftriebs-Stoss, die Beats akkumulieren das
// Schweben statt es zwischendurch fallen zu lassen.
function rapidBeat(tl: gsap.core.Timeline, state: HermesMotionState, lift: number): void {
  tl.to(state, { flap: 0.62, bend: 0.42, compression: 0.3, lift, duration: 0.08, ease: "power3.out" })
    .to(state, { tipLag: 0.2, duration: 0.08, ease: "power2.out" }, "<")
    .to(state, { flap: 0.08, bend: 0.14, compression: 0.06, duration: 0.09, ease: "power2.inOut" })
    .to(state, { tipLag: 0, duration: 0.09, ease: "power2.in" }, "<");
}

const rapid: PresetCycle = (state, groupPause) => {
  const tl = gsap.timeline({ paused: true, repeat: -1, repeatDelay: groupPause });
  tl.set(state, { ...REST_CHANNELS });
  rapidBeat(tl, state, 0.32); // drei schnelle Schlaege, Auftrieb baut sich auf
  rapidBeat(tl, state, 0.5);
  rapidBeat(tl, state, 0.6);
  tl.to(state, { flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0, duration: 0.16, ease: "sine.inOut" });
  return tl;
};

// --- C · Premium UI ---------------------------------------------------------
// Langsam, weich, teuer: grosser eleganter Bogen mit sanftem Auftrieb, der den
// Fluegel lange in der Schwebe traegt und seidig zurueckgleitet. Alles sine-eased.
const premium: PresetCycle = (state, groupPause) =>
  gsap
    .timeline({ paused: true, repeat: -1, repeatDelay: groupPause })
    .set(state, { ...REST_CHANNELS })
    .to(state, { flap: -0.18, bend: 0.22, lift: -0.06, duration: 0.16, ease: "sine.inOut" })
    .to(state, { flap: 0.6, bend: 0.82, compression: 0.35, duration: 0.22, ease: "power2.out" })
    .to(state, { tipLag: 0.42, lift: 0.5, duration: 0.28, ease: "sine.out" }, "-=0.12")
    .to(state, { flap: 0.05, bend: 0.42, compression: 0.12, lift: 0.58, duration: 0.26, ease: "sine.inOut" })
    .to(state, { tipLag: -0.14, duration: 0.26, ease: "sine.inOut" }, "<")
    .to(state, { flap: 0.4, bend: 0.6, compression: 0.2, lift: 0.34, duration: 0.18, ease: "power2.inOut" })
    .to(state, { tipLag: 0.18, duration: 0.18, ease: "power2.out" }, "<")
    .to(state, { flap: 0, bend: 0, compression: 0, tipLag: 0, lift: 0, duration: 0.34, ease: "sine.inOut" });

export const PRESETS: Record<PresetId, PresetCycle> = { classic, rapid, premium };

/** Aktive Zyklusdauer (ohne Gruppen-Pause) in Sekunden — fuer das Keypose-Seeking. */
export const PRESET_CYCLE_DURATION: Record<PresetId, number> = {
  classic: 1.12,
  rapid: 0.67,
  premium: 1.32,
};

/** Keyposes je Preset (Zeit innerhalb eines Zyklus) fuer Review-Screenshots. */
export const PRESET_KEYPOSES: Record<PresetId, KeyPose[]> = {
  classic: [
    { label: "01-ruhe", time: 0.0 },
    { label: "02-antizipation", time: 0.12 },
    { label: "03-max-schlag", time: 0.26 },
    { label: "04-ausschweben", time: 0.5 },
    { label: "05-zweiter-schlag", time: 0.72 },
    { label: "06-endpose", time: 1.1 },
  ],
  rapid: [
    { label: "01-ruhe", time: 0.0 },
    { label: "02-schlag-1", time: 0.08 },
    { label: "03-schlag-2", time: 0.25 },
    { label: "04-schlag-3", time: 0.42 },
    { label: "05-uebergang", time: 0.55 },
    { label: "06-endpose", time: 0.66 },
  ],
  premium: [
    { label: "01-ruhe", time: 0.0 },
    { label: "02-antizipation", time: 0.16 },
    { label: "03-max-schlag", time: 0.4 },
    { label: "04-ausschweben", time: 0.66 },
    { label: "05-zweiter-schlag", time: 0.9 },
    { label: "06-endpose", time: 1.3 },
  ],
};
