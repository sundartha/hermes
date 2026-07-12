// Szenario-Registry (Spec §1): id -> Modul. EIN Ort, an dem die CLI/Runner alle
// verfuegbaren Szenarien nachschlagen (G23 - kein verstreutes switch/if).
import friseurVoll from "./friseur-voll.mjs";
import terminDuenn from "./termin-duenn.mjs";
import partnerKnapp from "./partner-knapp.mjs";
import sttNoise from "./stt-noise.mjs";
import inboundNachricht from "./inbound-nachricht.mjs";
import kauderwelschErstantwort from "./kauderwelsch-erstantwort.mjs";

export const SCENARIOS = Object.freeze({
  [friseurVoll.id]: friseurVoll,
  [terminDuenn.id]: terminDuenn,
  [partnerKnapp.id]: partnerKnapp,
  [sttNoise.id]: sttNoise,
  [inboundNachricht.id]: inboundNachricht,
  [kauderwelschErstantwort.id]: kauderwelschErstantwort,
});

export const SCENARIO_IDS = Object.freeze(Object.keys(SCENARIOS));
