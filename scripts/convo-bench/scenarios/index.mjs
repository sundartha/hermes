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
import d3ConsultVerlangt from "./d3-consult-verlangt.mjs";
import d3ConsultImplizit from "./d3-consult-implizit.mjs";
import d3NachschlagAuftrag from "./d3-nachschlag-auftrag.mjs";
import d3FremdeRecherche from "./d3-fremde-recherche.mjs";

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
  [d3ConsultVerlangt.id]: d3ConsultVerlangt,
  [d3ConsultImplizit.id]: d3ConsultImplizit,
  [d3NachschlagAuftrag.id]: d3NachschlagAuftrag,
  [d3FremdeRecherche.id]: d3FremdeRecherche,
});

export const SCENARIO_IDS = Object.freeze(Object.keys(SCENARIOS));
