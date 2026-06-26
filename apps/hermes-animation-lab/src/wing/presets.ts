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
} as const;

/** Loopende Schlaggruppe + Pause dazwischen (working-Status, Preset-Galerie). */
export type PresetCycle = (
  state: HermesMotionState,
  groupPause: number,
) => gsap.core.Timeline;

// --- A · Hermes Classic -----------------------------------------------------
const classic: PresetCycle = (state, groupPause) =>
  gsap
    .timeline({ paused: true, repeat: -1, repeatDelay: groupPause })
    .set(state, { ...REST_CHANNELS })
    // 1. kurze Antizipation (leichtes Aufladen nach hinten)
    .to(state, { flap: -0.28, bend: 0.1, duration: 0.09, ease: "power2.in" })
    // 2. schneller kompakter Hauptschlag
    .to(state, { flap: 1, bend: 0.6, compression: 0.45, duration: 0.13, ease: "power3.out" })
    .to(state, { tipLag: 0.5, duration: 0.16, ease: "power2.out" }, "-=0.07")
    // 3. elastischer Rueckstoss
    .to(state, { flap: -0.12, bend: 0.16, compression: 0.1, duration: 0.15, ease: "elastic.out(1,0.55)" })
    .to(state, { tipLag: -0.22, duration: 0.15, ease: "power2.out" }, "<")
    // 4. kleiner zweiter Schlag
    .to(state, { flap: 0.55, bend: 0.34, compression: 0.24, duration: 0.11, ease: "power2.out" })
    .to(state, { tipLag: 0.24, duration: 0.11, ease: "power2.out" }, "<")
    // 5. kontrolliertes Einpendeln
    .to(state, { flap: 0, bend: 0, compression: 0, tipLag: 0, duration: 0.2, ease: "power2.out" });

// --- B · Rapid Messenger ----------------------------------------------------
function rapidBeat(tl: gsap.core.Timeline, state: HermesMotionState): void {
  tl.to(state, { flap: 0.62, bend: 0.42, compression: 0.3, duration: 0.08, ease: "power3.out" })
    .to(state, { tipLag: 0.2, duration: 0.08, ease: "power2.out" }, "<")
    .to(state, { flap: 0, bend: 0.12, compression: 0.06, duration: 0.09, ease: "power2.in" })
    .to(state, { tipLag: 0, duration: 0.09, ease: "power2.in" }, "<");
}

const rapid: PresetCycle = (state, groupPause) => {
  const tl = gsap.timeline({ paused: true, repeat: -1, repeatDelay: groupPause });
  tl.set(state, { ...REST_CHANNELS });
  rapidBeat(tl, state); // drei sehr schnelle kleine Schlaege im engen Bogen
  rapidBeat(tl, state);
  rapidBeat(tl, state);
  tl.to(state, { flap: 0, bend: 0, compression: 0, tipLag: 0, duration: 0.1, ease: "power2.out" });
  return tl;
};

// --- C · Premium UI ---------------------------------------------------------
const premium: PresetCycle = (state, groupPause) =>
  gsap
    .timeline({ paused: true, repeat: -1, repeatDelay: groupPause })
    .set(state, { ...REST_CHANNELS })
    .to(state, { flap: -0.18, bend: 0.22, duration: 0.14, ease: "power1.inOut" })
    .to(state, { flap: 0.6, bend: 0.8, compression: 0.35, duration: 0.2, ease: "power2.out" })
    .to(state, { tipLag: 0.4, duration: 0.24, ease: "power2.out" }, "-=0.1")
    .to(state, { flap: 0.05, bend: 0.42, compression: 0.12, duration: 0.22, ease: "power2.inOut" })
    .to(state, { tipLag: -0.14, duration: 0.22, ease: "power2.inOut" }, "<")
    .to(state, { flap: 0.4, bend: 0.6, compression: 0.2, duration: 0.16, ease: "power2.out" })
    .to(state, { tipLag: 0.18, duration: 0.16, ease: "power2.out" }, "<")
    .to(state, { flap: 0, bend: 0, compression: 0, tipLag: 0, duration: 0.2, ease: "power2.out" });

export const PRESETS: Record<PresetId, PresetCycle> = { classic, rapid, premium };

/** Aktive Zyklusdauer (ohne Gruppen-Pause) in Sekunden — fuer das Keypose-Seeking. */
export const PRESET_CYCLE_DURATION: Record<PresetId, number> = {
  classic: 0.68,
  rapid: 0.61,
  premium: 0.92,
};

/** Keyposes je Preset (Zeit innerhalb eines Zyklus) fuer Review-Screenshots. */
export const PRESET_KEYPOSES: Record<PresetId, KeyPose[]> = {
  classic: [
    { label: "01-ruhe", time: 0.0 },
    { label: "02-antizipation", time: 0.09 },
    { label: "03-max-schlag", time: 0.22 },
    { label: "04-rueckstoss", time: 0.37 },
    { label: "05-zweiter-schlag", time: 0.48 },
    { label: "06-endpose", time: 0.67 },
  ],
  rapid: [
    { label: "01-ruhe", time: 0.0 },
    { label: "02-schlag-1", time: 0.08 },
    { label: "03-schlag-2", time: 0.25 },
    { label: "04-schlag-3", time: 0.42 },
    { label: "05-uebergang", time: 0.5 },
    { label: "06-endpose", time: 0.6 },
  ],
  premium: [
    { label: "01-ruhe", time: 0.0 },
    { label: "02-antizipation", time: 0.14 },
    { label: "03-max-schlag", time: 0.34 },
    { label: "04-rueckstoss", time: 0.56 },
    { label: "05-zweiter-schlag", time: 0.72 },
    { label: "06-endpose", time: 0.91 },
  ],
};
