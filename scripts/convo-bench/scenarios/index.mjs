// Szenario-Registry (Spec §1): id -> Modul. EIN Ort, an dem die CLI/Runner alle
// verfuegbaren Szenarien nachschlagen (G23 - kein verstreutes switch/if).
import friseurVoll from "./friseur-voll.mjs";
import terminDuenn from "./termin-duenn.mjs";
import partnerKnapp from "./partner-knapp.mjs";
import sttNoise from "./stt-noise.mjs";
import inboundNachricht from "./inbound-nachricht.mjs";
import kauderwelschErstantwort from "./kauderwelsch-erstantwort.mjs";
import holdWarteschleife from "./hold-warteschleife.mjs";
import personenwechsel from "./personenwechsel.mjs";
import spaeterNochmal from "./spaeter-nochmal.mjs";
import unerfuellbareRecherche from "./unerfuellbare-recherche.mjs";
import mandatInnerhalb from "./mandat-innerhalb.mjs";
import mandatAusserhalb from "./mandat-ausserhalb.mjs";
import zweiterAnrufGedaechtnis from "./zweiter-anruf-gedaechtnis.mjs";
import rueckfrageNotausgang from "./rueckfrage-notausgang.mjs";
import anrufbeantworter from "./anrufbeantworter.mjs";

export const SCENARIOS = Object.freeze({
  [friseurVoll.id]: friseurVoll,
  [terminDuenn.id]: terminDuenn,
  [partnerKnapp.id]: partnerKnapp,
  [sttNoise.id]: sttNoise,
  [inboundNachricht.id]: inboundNachricht,
  [kauderwelschErstantwort.id]: kauderwelschErstantwort,
  [holdWarteschleife.id]: holdWarteschleife,
  [personenwechsel.id]: personenwechsel,
  [spaeterNochmal.id]: spaeterNochmal,
  [unerfuellbareRecherche.id]: unerfuellbareRecherche,
  [mandatInnerhalb.id]: mandatInnerhalb,
  [mandatAusserhalb.id]: mandatAusserhalb,
  [zweiterAnrufGedaechtnis.id]: zweiterAnrufGedaechtnis,
  [rueckfrageNotausgang.id]: rueckfrageNotausgang,
  [anrufbeantworter.id]: anrufbeantworter,
});

export const SCENARIO_IDS = Object.freeze(Object.keys(SCENARIOS));
