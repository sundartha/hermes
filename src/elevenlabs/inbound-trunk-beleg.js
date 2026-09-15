// IEX-A8 (E8/E11): Registrierungs-Beleg des EL-Inbound-Trunks am Nummern-Datensatz.
//
// Zweck: beim Boot fuer JEDE aktive DID lesend beim Anbieter belegen, dass ihre
// EL-Nummernregistrierung einen Inbound-Trunk mit dem laufenden Digest-Zugang traegt, auf
// DIESE DID begrenzt ist und dem laufenden Agenten gehoert. Das Ergebnis steht als zwei
// Felder an der Nummer (elInboundTrunkBelegtAt + elInboundTrunkZugangFp, geschrieben nur
// ueber die Store-Operationen) und als EINE Ergebniszeile im Log, geschrieben NACH dem
// letzten GET. Diese Felder erscheinen in keiner API-, MCP- oder Export-Ausgabe.
//
// Aufbau: reiner Teil (Beleg-Urteil, Hindernis, Ergebniszeile; der Zugangs-Fingerabdruck lebt
// neben der Zugangs-Definition in inbound-path-decision.js) plus die Sweep-Fabrik makeTrunkSweep
// mit injiziertem IO (store, elRead, logger, jetzt).
//
// Grenzen, bewusst:
// - Kein Schreiben beim Anbieter. Eine Reparatur ist A10-Scope; die Naht dafuer ist
//   pruefeNummer in der Fabrik.
// - UNBEKANNT (401/403/429/5xx/Netz/Timeout) loescht NIE einen vorhandenen Beleg; nur eine
//   belegte ABWEICHUNG (inklusive 404) loescht.
// - Der Fingerabdruck deckt NUR sipUser ab: eine reine Passwort-Aenderung ist daran nicht
//   erkennbar. Eine Zugangs-Rotation laeuft deshalb ausschliesslich ueber
//   scripts/iel-geheimnisse.mjs setzen (Review-Concern E8/E9).
// - Das Log nennt nie eine volle Nummer, den SIP-Benutzer, den Fingerabdruck oder eine
//   Registrierungs-ID - nur Zaehler und DID-Endungen.

import { isDeepStrictEqual } from "node:util";
import { NUMBER_STATUS } from "../store/defaults.js";
import {
  e164Endung,
  inboundElAccessDefects,
  istNichtLeererString,
  zugangsFingerabdruck,
} from "./inbound-path-decision.js";

// Begrenzte Parallelitaet der Boot-GETs (E8): schont das Anbieter-Rate-Limit, kein Env-Knopf.
export const SWEEP_PARALLEL = 4;
// Hoechstzahl Endungen in der Ergebniszeile; der Rest erscheint als ",+<n>" (b2 braucht die Vollstaendigkeit).
export const SONDE_MAX_ENDUNGEN = 10;
const HTTP_NOT_FOUND = 404; // Repo-Konvention: modul-lokal (voice.js, outbound-config-probe.js)
const LOG_PRAEFIX = "[el-trunk]";

export const TRUNK_BELEG = Object.freeze({ BELEGT: "belegt", ABWEICHUNG: "abweichung", UNBEKANNT: "unbekannt" });
// Werte == Schluessel der Ergebniszeile, Reihenfolge == Zeilenreihenfolge (EINE Quelle, G5/G23)
export const SWEEP_ERGEBNIS = Object.freeze({ ...TRUNK_BELEG, OHNE_REGISTRIERUNG: "ohne_registrierung" });
export const SWEEP_HINDERNIS = Object.freeze({
  SCHALTER_AUS: "schalter_aus",
  ZUGANG_UNVOLLSTAENDIG: "zugang_unvollstaendig",
  EL_KONTO_UNVOLLSTAENDIG: "el_konto_unvollstaendig",
});

// G3: undefined === undefined darf nie als Uebereinstimmung gelten.
function gleichUndGesetzt(wert, soll) {
  return istNichtLeererString(soll) && wert === soll;
}

function trunkTraegtZugang(trunk, sipUser) {
  return trunk?.has_auth_credentials === true && gleichUndGesetzt(trunk?.username, sipUser);
}

function trunkErlaubtNurDid(trunk, e164) {
  return istNichtLeererString(e164) && isDeepStrictEqual(trunk?.allowed_numbers, [e164]);
}

// D1: der Agent steht im GET unter assigned_agent.agent_id. D2: das Dial-Ziel ist die DID
// selbst - eine Registrierung mit anderer phone_number waere ein Dial ins Leere.
function registrierungGehoertAgentUndDid(registrierung, { agentId, e164 }) {
  const agentPasst = gleichUndGesetzt(registrierung?.assigned_agent?.agent_id, agentId);
  return agentPasst && gleichUndGesetzt(registrierung?.phone_number, e164);
}

// Urteil ueber einen gelesenen Registrierungs-Body. Vergleicht nur im Speicher, gibt keinen
// Wert zurueck und wirft nie (auch nicht bei null oder fremdem Body).
export function belegeInboundTrunk({ number, registrierung, sipUser, agentId }) {
  const trunk = registrierung?.inbound_trunk;
  const e164 = number.e164;
  const belegt =
    trunkTraegtZugang(trunk, sipUser) &&
    trunkErlaubtNurDid(trunk, e164) &&
    registrierungGehoertAgentUndDid(registrierung, { agentId, e164 });
  return belegt ? TRUNK_BELEG.BELEGT : TRUNK_BELEG.ABWEICHUNG;
}

// Nur ein belegtes "gibt es nicht" (404) ist eine Abweichung; alles andere ist UNBEKANNT.
export function belegAusAbruffehler(fehler) {
  return fehler?.providerStatus === HTTP_NOT_FOUND ? TRUNK_BELEG.ABWEICHUNG : TRUNK_BELEG.UNBEKANNT;
}

// Aufruf mit config.voice. Sicherheitsrelevant: ein leerer agentId machte sonst jede
// Registrierung zur ABWEICHUNG und loeschte damit alle Belege.
export function trunkSweepHindernis({ elevenLabsInbound, elevenLabsOutbound }) {
  if (elevenLabsInbound.enabled !== true) return SWEEP_HINDERNIS.SCHALTER_AUS;
  if (inboundElAccessDefects(elevenLabsInbound).length > 0) return SWEEP_HINDERNIS.ZUGANG_UNVOLLSTAENDIG;
  const kontoVollstaendig =
    istNichtLeererString(elevenLabsOutbound.apiKey) && istNichtLeererString(elevenLabsOutbound.agentId);
  return kontoVollstaendig ? null : SWEEP_HINDERNIS.EL_KONTO_UNVOLLSTAENDIG;
}

function zaehleSweepErgebnisse(ergebnisse) {
  const zaehler = Object.fromEntries(Object.values(SWEEP_ERGEBNIS).map((schluessel) => [schluessel, 0]));
  for (const { ergebnis } of ergebnisse) zaehler[ergebnis] += 1;
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

// ergebnisse = [{ endung, ergebnis }] -> die EINE Ergebniszeile des Sweeps. scope ist ein vom Boot-Befund
// gepruefter Enum-Wert (E11: Runbook b4/b5 lesen Scope und Zaehler aus derselben Zeile).
export function trunkSweepErgebnisZeile({ scope, ergebnisse }) {
  const { aktiv, zaehler, ohneBelegEndungen } = zaehleSweepErgebnisse(ergebnisse);
  const zaehlerTeil = Object.values(SWEEP_ERGEBNIS)
    .map((schluessel) => `${schluessel}=${zaehler[schluessel]}`)
    .join(" ");
  return `${LOG_PRAEFIX} sweep fertig scope=${scope} aktiv=${aktiv} ${zaehlerTeil}${endungenTeil(ohneBelegEndungen)}`;
}

function mitEndung(number, ergebnis) {
  return { endung: e164Endung(number.e164), ergebnis };
}

// Hoechstens `grenze` Arbeiten gleichzeitig offen, Ergebnisreihenfolge == Eingabereihenfolge.
// Der Index-Zugriff zwischen den awaits ist atomar (ein Event-Loop, kein Thread-Zustand).
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

export function makeTrunkSweep({ store, config, elRead, logger = console, jetzt = () => new Date() }) {
  // Einzelpruefung als eigene Funktion = die Naht, an der A10 die Reparatur ergaenzt (D4).
  async function pruefeNummer(number, zugangFp) {
    if (!number.providerAgentPhoneNumberId) return mitEndung(number, SWEEP_ERGEBNIS.OHNE_REGISTRIERUNG);
    const beleg = await holeBeleg(number);
    wendeBelegAn(number, { beleg, zugangFp });
    return mitEndung(number, beleg);
  }

  async function holeBeleg(number) {
    let registrierung;
    try {
      registrierung = await elRead.fetchPhoneNumber(number.providerAgentPhoneNumberId);
    } catch (fehler) {
      return belegAusAbruffehler(fehler);
    }
    // ausserhalb des try: ein Defekt im Beleg ist ein Wurf (-> sweep fehler), nie still UNBEKANNT
    const { sipUser } = config.voice.elevenLabsInbound;
    return belegeInboundTrunk({ number, registrierung, sipUser, agentId: config.voice.elevenLabsOutbound.agentId });
  }

  function wendeBelegAn(number, { beleg, zugangFp }) {
    if (beleg === TRUNK_BELEG.BELEGT)
      store.markNumberElInboundTrunkBelegt(number.id, { nowIso: jetzt().toISOString(), zugangFp });
    else if (beleg === TRUNK_BELEG.ABWEICHUNG) store.clearNumberElInboundTrunkBeleg(number.id);
    // UNBEKANNT: Beleg bleibt unangetastet (E8)
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

  // fail-soft, rejectet nie; das Log nennt keinen Fehlertext (er koennte Werte tragen).
  async function runBootSweep() {
    try {
      await laufe();
    } catch {
      logger.error(`${LOG_PRAEFIX} sweep fehler`);
    }
  }

  return { runBootSweep };
}
