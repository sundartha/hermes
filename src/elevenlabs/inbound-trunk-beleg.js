import { isDeepStrictEqual } from "node:util";
import { NUMBER_STATUS } from "../store/defaults.js";
import {
  e164Endung,
  inboundElAccessDefects,
  istNichtLeererString,
  zugangsFingerabdruck,
} from "./inbound-path-decision.js";

export const SWEEP_PARALLEL = 4;
export const SONDE_MAX_ENDUNGEN = 10;
const HTTP_NOT_FOUND = 404;
const LOG_PRAEFIX = "[el-trunk]";

export const TRUNK_BELEG = Object.freeze({ BELEGT: "belegt", ABWEICHUNG: "abweichung", UNBEKANNT: "unbekannt" });
export const SWEEP_ERGEBNIS = Object.freeze({ ...TRUNK_BELEG, OHNE_REGISTRIERUNG: "ohne_registrierung" });
const SWEEP_REPARIERT = "repariert";
const ERGEBNISZEILE_SCHLUESSEL = Object.freeze([
  SWEEP_ERGEBNIS.BELEGT,
  SWEEP_REPARIERT,
  SWEEP_ERGEBNIS.ABWEICHUNG,
  SWEEP_ERGEBNIS.UNBEKANNT,
  SWEEP_ERGEBNIS.OHNE_REGISTRIERUNG,
]);
export const SWEEP_HINDERNIS = Object.freeze({
  SCHALTER_AUS: "schalter_aus",
  ZUGANG_UNVOLLSTAENDIG: "zugang_unvollstaendig",
  EL_KONTO_UNVOLLSTAENDIG: "el_konto_unvollstaendig",
});
export const REPARATUR_HINDERNIS = Object.freeze({
  UNBEKANNT: "unbekannt",
  NICHT_GEFUNDEN: "nicht_gefunden",
  FREMDE_REGISTRIERUNG: "fremde_registrierung",
  OHNE_OUTBOUND_TRUNK: "ohne_outbound_trunk",
});

function gleichUndGesetzt(wert, soll) {
  return istNichtLeererString(soll) && wert === soll;
}

function trunkTraegtZugang(trunk, sipUser) {
  return trunk?.has_auth_credentials === true && gleichUndGesetzt(trunk?.username, sipUser);
}

function trunkErlaubtNurDid(trunk, e164) {
  return istNichtLeererString(e164) && isDeepStrictEqual(trunk?.allowed_numbers, [e164]);
}

function registrierungGehoertAgentUndDid(registrierung, { agentId, e164 }) {
  const agentPasst = gleichUndGesetzt(registrierung?.assigned_agent?.agent_id, agentId);
  return agentPasst && gleichUndGesetzt(registrierung?.phone_number, e164);
}

export function belegeInboundTrunk({ number, registrierung, sipUser, agentId }) {
  const trunk = registrierung?.inbound_trunk;
  const e164 = number.e164;
  const belegt =
    trunkTraegtZugang(trunk, sipUser) &&
    trunkErlaubtNurDid(trunk, e164) &&
    registrierungGehoertAgentUndDid(registrierung, { agentId, e164 });
  return belegt ? TRUNK_BELEG.BELEGT : TRUNK_BELEG.ABWEICHUNG;
}

export function belegAusAbruffehler(fehler) {
  return fehler?.providerStatus === HTTP_NOT_FOUND ? TRUNK_BELEG.ABWEICHUNG : TRUNK_BELEG.UNBEKANNT;
}

export async function leseTrunkBeleg({ lies, number, soll }) {
  let registrierung;
  try {
    registrierung = await lies(number.providerAgentPhoneNumberId);
  } catch (fehler) {
    return { beleg: belegAusAbruffehler(fehler), registrierung: null };
  }
  return { beleg: belegeInboundTrunk({ number, registrierung, ...soll }), registrierung };
}

export function reparaturHindernis({ abruf, number, agentId }) {
  if (abruf.beleg === TRUNK_BELEG.UNBEKANNT) return REPARATUR_HINDERNIS.UNBEKANNT;
  if (!abruf.registrierung) return REPARATUR_HINDERNIS.NICHT_GEFUNDEN;
  if (!registrierungGehoertAgentUndDid(abruf.registrierung, { agentId, e164: number.e164 }))
    return REPARATUR_HINDERNIS.FREMDE_REGISTRIERUNG;
  return abruf.registrierung.outbound_trunk ? null : REPARATUR_HINDERNIS.OHNE_OUTBOUND_TRUNK;
}

export function trunkSweepHindernis({ elevenLabsInbound, elevenLabsOutbound }) {
  if (elevenLabsInbound.enabled !== true) return SWEEP_HINDERNIS.SCHALTER_AUS;
  if (inboundElAccessDefects(elevenLabsInbound).length > 0) return SWEEP_HINDERNIS.ZUGANG_UNVOLLSTAENDIG;
  const kontoVollstaendig =
    istNichtLeererString(elevenLabsOutbound.apiKey) && istNichtLeererString(elevenLabsOutbound.agentId);
  return kontoVollstaendig ? null : SWEEP_HINDERNIS.EL_KONTO_UNVOLLSTAENDIG;
}

function zaehleSweepErgebnisse(ergebnisse) {
  const zaehler = Object.fromEntries(ERGEBNISZEILE_SCHLUESSEL.map((schluessel) => [schluessel, 0]));
  for (const { ergebnis, repariert } of ergebnisse) {
    zaehler[ergebnis] += 1;
    if (repariert) zaehler[SWEEP_REPARIERT] += 1;
  }
  const ohneBelegEndungen = ergebnisse
    .filter(({ ergebnis }) => ergebnis !== TRUNK_BELEG.BELEGT)
    .map(({ endung }) => endung);
  return { aktiv: ergebnisse.length, zaehler, ohneBelegEndungen };
}

function endungenTeil(endungen) {
  if (endungen.length === 0) return "";
  const sortiert = [...endungen].sort();
  const sichtbar = sortiert.slice(0, SONDE_MAX_ENDUNGEN);
  const rest = sortiert.length - sichtbar.length;
  const restTeil = rest > 0 ? `,+${rest}` : "";
  return ` ohne_beleg_endungen=${sichtbar.join(",")}${restTeil}`;
}

export function trunkSweepErgebnisZeile({ scope, ergebnisse }) {
  const { aktiv, zaehler, ohneBelegEndungen } = zaehleSweepErgebnisse(ergebnisse);
  const zaehlerTeil = ERGEBNISZEILE_SCHLUESSEL.map((schluessel) => `${schluessel}=${zaehler[schluessel]}`).join(" ");
  return `${LOG_PRAEFIX} sweep fertig scope=${scope} aktiv=${aktiv} ${zaehlerTeil}${endungenTeil(ohneBelegEndungen)}`;
}

function mitEndung(number, ergebnis) {
  return { endung: e164Endung(number.e164), ergebnis };
}

async function mitBegrenzterParallelitaet(eintraege, grenze, arbeit) {
  const ergebnisse = new Array(eintraege.length);
  let naechsterIndex = 0;
  async function bahn() {
    while (naechsterIndex < eintraege.length) {
      const index = naechsterIndex;
      naechsterIndex += 1;
      ergebnisse[index] = await arbeit(eintraege[index]);
    }
  }
  const bahnen = Array.from({ length: Math.min(grenze, eintraege.length) }, bahn);
  await Promise.all(bahnen);
  return ergebnisse;
}

export function makeTrunkSweep({ store, config, elRead, reparatur, logger = console, jetzt = () => new Date() }) {
  function sollZugang() {
    return { sipUser: config.voice.elevenLabsInbound.sipUser, agentId: config.voice.elevenLabsOutbound.agentId };
  }

  async function pruefeNummer(number, zugangFp) {
    if (!number.providerAgentPhoneNumberId) return mitEndung(number, SWEEP_ERGEBNIS.OHNE_REGISTRIERUNG);
    const lies = (phoneNumberId) => elRead.fetchPhoneNumber(phoneNumberId);
    const abruf = await leseTrunkBeleg({ lies, number, soll: sollZugang() });
    wendeBelegAn(number, { beleg: abruf.beleg, zugangFp });
    if (abruf.beleg === TRUNK_BELEG.BELEGT || !reparatur) return mitEndung(number, abruf.beleg);
    return repariereEinmal(number, { abruf, zugangFp });
  }

  async function repariereEinmal(number, { abruf, zugangFp }) {
    const hindernis = reparaturHindernis({ abruf, number, agentId: config.voice.elevenLabsOutbound.agentId });
    if (hindernis) {
      logger.log(`${LOG_PRAEFIX} nicht_repariert nummer_id=${number.id} grund=${hindernis}`);
      return mitEndung(number, abruf.beleg);
    }
    const beleg = await reparatur.ensureInboundTrunk(number);
    wendeBelegAn(number, { beleg, zugangFp });
    return { ...mitEndung(number, beleg), repariert: beleg === TRUNK_BELEG.BELEGT };
  }

  function wendeBelegAn(number, { beleg, zugangFp }) {
    if (beleg === TRUNK_BELEG.BELEGT)
      store.markNumberElInboundTrunkBelegt(number.id, { nowIso: jetzt().toISOString(), zugangFp });
    else if (beleg === TRUNK_BELEG.ABWEICHUNG) store.clearNumberElInboundTrunkBeleg(number.id);
  }

  async function laufe() {
    const hindernis = trunkSweepHindernis(config.voice);
    if (hindernis) {
      logger.log(`${LOG_PRAEFIX} sweep uebersprungen grund=${hindernis}`);
      return;
    }
    const zugangFp = zugangsFingerabdruck(config.voice.elevenLabsInbound.sipUser);
    const aktive = store.load().numbers.filter((nummer) => nummer.status === NUMBER_STATUS.ACTIVE);
    const ergebnisse = await mitBegrenzterParallelitaet(aktive, SWEEP_PARALLEL, (nummer) =>
      pruefeNummer(nummer, zugangFp),
    );
    logger.log(trunkSweepErgebnisZeile({ scope: config.voice.elevenLabsInbound.scope, ergebnisse }));
  }

  async function runBootSweep() {
    try {
      await laufe();
    } catch {
      logger.error(`${LOG_PRAEFIX} sweep fehler`);
    }
  }

  return { runBootSweep };
}
