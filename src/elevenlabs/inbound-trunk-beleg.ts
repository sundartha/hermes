import { HTTP_NOT_FOUND } from "../utils/http.ts";
import { isDeepStrictEqual } from "node:util";
import { NUMBER_STATUS } from "../begriffe/nummern.js";
import { START_ROUTINE } from "../begriffe/speicher.js";
import {
  e164Endung,
  inboundElAccessDefects,
  istNichtLeererString,
  zugangsFingerabdruck,
} from "./inbound-path-decision.ts";

interface Trunk {
  has_auth_credentials?: unknown;
  username?: unknown;
  allowed_numbers?: unknown;
}

interface Registrierung {
  inbound_trunk?: Trunk | null;
  outbound_trunk?: unknown;
  assigned_agent?: { agent_id?: unknown } | null;
  phone_number?: unknown;
}

interface Nummer {
  id: string;
  e164: string;
  providerAgentPhoneNumberId?: string | null;
}

interface Soll {
  sipUser: unknown;
  agentId: unknown;
}

interface Abruf {
  beleg: string;
  registrierung: Registrierung | null;
}

interface SweepErgebnis {
  endung: string;
  ergebnis: string;
  repariert?: boolean;
}

interface Logger {
  log: (zeile: string) => void;
  error: (zeile: string) => void;
}

interface Reparatur {
  ensureInboundTrunk: (number: Nummer) => Promise<string>;
}

interface Store {
  load: () => { numbers: (Nummer & { status?: string })[] };
  markNumberElInboundTrunkBelegt: (
    id: string,
    daten: { nowIso: string; zugangFp: string | null },
  ) => unknown;
  clearNumberElInboundTrunkBeleg: (id: string) => unknown;
}

interface SweepConfig {
  voice: {
    elevenLabsInbound: {
      sipUser: string | undefined;
      sipPassword: string | undefined;
      initWebhookToken: string | undefined;
      enabled?: boolean;
      scope: string;
    };
    elevenLabsOutbound: { apiKey?: unknown; agentId?: unknown };
  };
}

type StartSperre = (
  routine: number,
  arbeit: () => Promise<unknown>,
) => Promise<{ uebersprungen: boolean }>;

export const SWEEP_PARALLEL = 4;
export const SONDE_MAX_ENDUNGEN = 10;
const LOG_PRAEFIX = "[el-trunk]";
const SWEEP_UEBERSPRUNGEN_ANDERE_INSTANZ = "andere_instanz";

export const TRUNK_BELEG = Object.freeze({
  BELEGT: "belegt",
  ABWEICHUNG: "abweichung",
  UNBEKANNT: "unbekannt",
});
export const SWEEP_ERGEBNIS = Object.freeze({
  ...TRUNK_BELEG,
  OHNE_REGISTRIERUNG: "ohne_registrierung",
});
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

function gleichUndGesetzt(wert: unknown, soll: unknown) {
  return istNichtLeererString(soll) && wert === soll;
}

function trunkTraegtZugang(trunk: Trunk | null | undefined, sipUser: unknown) {
  return trunk?.has_auth_credentials === true && gleichUndGesetzt(trunk.username, sipUser);
}

function trunkErlaubtNurDid(trunk: Trunk | null | undefined, e164: unknown) {
  return istNichtLeererString(e164) && isDeepStrictEqual(trunk?.allowed_numbers, [e164]);
}

function registrierungGehoertAgentUndDid(
  registrierung: Registrierung | null | undefined,
  { agentId, e164 }: { agentId: unknown; e164: unknown },
) {
  const agentPasst = gleichUndGesetzt(registrierung?.assigned_agent?.agent_id, agentId);
  return agentPasst && gleichUndGesetzt(registrierung?.phone_number, e164);
}

export function belegeInboundTrunk({
  number,
  registrierung,
  sipUser,
  agentId,
}: { number: Nummer; registrierung: Registrierung | null | undefined } & Soll): string {
  const trunk = registrierung?.inbound_trunk;
  const e164 = number.e164;
  const belegt =
    trunkTraegtZugang(trunk, sipUser) &&
    trunkErlaubtNurDid(trunk, e164) &&
    registrierungGehoertAgentUndDid(registrierung, { agentId, e164 });
  return belegt ? TRUNK_BELEG.BELEGT : TRUNK_BELEG.ABWEICHUNG;
}

export function belegAusAbruffehler(fehler: unknown): string {
  return Reflect.get(Object(fehler), "providerStatus") === HTTP_NOT_FOUND
    ? TRUNK_BELEG.ABWEICHUNG
    : TRUNK_BELEG.UNBEKANNT;
}

export async function leseTrunkBeleg({
  lies,
  number,
  soll,
}: {
  lies: (phoneNumberId: string | null | undefined) => Promise<Registrierung>;
  number: Nummer;
  soll: Soll;
}): Promise<Abruf> {
  let registrierung: Registrierung;
  try {
    registrierung = await lies(number.providerAgentPhoneNumberId);
  } catch (fehler) {
    return { beleg: belegAusAbruffehler(fehler), registrierung: null };
  }
  return { beleg: belegeInboundTrunk({ number, registrierung, ...soll }), registrierung };
}

export function reparaturHindernis({
  abruf,
  number,
  agentId,
}: {
  abruf: Abruf;
  number: Nummer;
  agentId: unknown;
}): string | null {
  if (abruf.beleg === TRUNK_BELEG.UNBEKANNT) return REPARATUR_HINDERNIS.UNBEKANNT;
  if (!abruf.registrierung) return REPARATUR_HINDERNIS.NICHT_GEFUNDEN;
  if (!registrierungGehoertAgentUndDid(abruf.registrierung, { agentId, e164: number.e164 }))
    return REPARATUR_HINDERNIS.FREMDE_REGISTRIERUNG;
  return abruf.registrierung.outbound_trunk ? null : REPARATUR_HINDERNIS.OHNE_OUTBOUND_TRUNK;
}

export function trunkSweepHindernis({
  elevenLabsInbound,
  elevenLabsOutbound,
}: SweepConfig["voice"]): string | null {
  if (elevenLabsInbound.enabled !== true) return SWEEP_HINDERNIS.SCHALTER_AUS;
  if (inboundElAccessDefects(elevenLabsInbound).length > 0)
    return SWEEP_HINDERNIS.ZUGANG_UNVOLLSTAENDIG;
  const kontoVollstaendig =
    istNichtLeererString(elevenLabsOutbound.apiKey) &&
    istNichtLeererString(elevenLabsOutbound.agentId);
  return kontoVollstaendig ? null : SWEEP_HINDERNIS.EL_KONTO_UNVOLLSTAENDIG;
}

function anzahlJeSchluessel(ergebnisse: SweepErgebnis[], schluessel: string) {
  const trifft = ({ ergebnis, repariert }: SweepErgebnis) =>
    schluessel === SWEEP_REPARIERT ? repariert : ergebnis === schluessel;
  return ergebnisse.filter(trifft).length;
}

function zaehlerTeil(ergebnisse: SweepErgebnis[]) {
  return ERGEBNISZEILE_SCHLUESSEL.map(
    (schluessel) => `${schluessel}=${String(anzahlJeSchluessel(ergebnisse, schluessel))}`,
  ).join(" ");
}

function endungenTeil(endungen: string[]) {
  if (endungen.length === 0) return "";
  const sortiert = [...endungen].sort();
  const sichtbar = sortiert.slice(0, SONDE_MAX_ENDUNGEN);
  const rest = sortiert.length - sichtbar.length;
  const restTeil = rest > 0 ? `,+${String(rest)}` : "";
  return ` ohne_beleg_endungen=${sichtbar.join(",")}${restTeil}`;
}

export function trunkSweepErgebnisZeile({
  scope,
  ergebnisse,
}: {
  scope: string;
  ergebnisse: SweepErgebnis[];
}): string {
  const ohneBelegEndungen = ergebnisse
    .filter(({ ergebnis }) => ergebnis !== TRUNK_BELEG.BELEGT)
    .map(({ endung }) => endung);
  const aktiv = String(ergebnisse.length);
  return `${LOG_PRAEFIX} sweep fertig scope=${scope} aktiv=${aktiv} ${zaehlerTeil(ergebnisse)}${endungenTeil(ohneBelegEndungen)}`;
}

function mitEndung(number: Nummer, ergebnis: string): SweepErgebnis {
  return { endung: e164Endung(number.e164), ergebnis };
}

async function mitBegrenzterParallelitaet<E, R>(
  eintraege: E[],
  grenze: number,
  arbeit: (eintrag: E) => Promise<R>,
): Promise<R[]> {
  const ergebnisse = new Array<R>(eintraege.length);
  const iterator = eintraege.entries();
  async function bahn() {
    for (const [index, eintrag] of iterator) {
      ergebnisse[index] = await arbeit(eintrag);
    }
  }
  const bahnen = Array.from({ length: Math.min(grenze, eintraege.length) }, bahn);
  await Promise.all(bahnen);
  return ergebnisse;
}

const ohneStartSperre: StartSperre = async (_routine, arbeit) => ({
  uebersprungen: false,
  ergebnis: await arbeit(),
});

export function makeTrunkSweep({
  store,
  config,
  elRead,
  reparatur,
  mitStartSperre = ohneStartSperre,
  logger = console,
  jetzt = () => new Date(),
}: {
  store: Store;
  config: SweepConfig;
  elRead: {
    fetchPhoneNumber: (phoneNumberId: string | null | undefined) => Promise<Registrierung>;
  };
  reparatur?: Reparatur | null | undefined;
  mitStartSperre?: StartSperre;
  logger?: Logger;
  jetzt?: () => Date;
}): { runBootSweep: () => Promise<void> } {
  function sollZugang() {
    return {
      sipUser: config.voice.elevenLabsInbound.sipUser,
      agentId: config.voice.elevenLabsOutbound.agentId,
    };
  }

  async function pruefeNummer(number: Nummer, zugangFp: string | null): Promise<SweepErgebnis> {
    if (!number.providerAgentPhoneNumberId)
      return mitEndung(number, SWEEP_ERGEBNIS.OHNE_REGISTRIERUNG);
    const lies = (phoneNumberId: string | null | undefined) =>
      elRead.fetchPhoneNumber(phoneNumberId);
    const abruf = await leseTrunkBeleg({ lies, number, soll: sollZugang() });
    wendeBelegAn(number, { beleg: abruf.beleg, zugangFp });
    if (abruf.beleg === TRUNK_BELEG.BELEGT || !reparatur) return mitEndung(number, abruf.beleg);
    return repariereEinmal(number, { abruf, zugangFp, reparatur });
  }

  async function repariereEinmal(
    number: Nummer,
    { abruf, zugangFp, reparatur }: { abruf: Abruf; zugangFp: string | null; reparatur: Reparatur },
  ): Promise<SweepErgebnis> {
    const hindernis = reparaturHindernis({
      abruf,
      number,
      agentId: config.voice.elevenLabsOutbound.agentId,
    });
    if (hindernis) {
      logger.log(`${LOG_PRAEFIX} nicht_repariert nummer_id=${number.id} grund=${hindernis}`);
      return mitEndung(number, abruf.beleg);
    }
    const beleg = await reparatur.ensureInboundTrunk(number);
    wendeBelegAn(number, { beleg, zugangFp });
    return { ...mitEndung(number, beleg), repariert: beleg === TRUNK_BELEG.BELEGT };
  }

  function wendeBelegAn(
    number: Nummer,
    { beleg, zugangFp }: { beleg: string; zugangFp: string | null },
  ) {
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
    const lauf = await mitStartSperre(START_ROUTINE.TRUNK_SWEEP, sweepeAktive);
    if (lauf.uebersprungen)
      logger.log(`${LOG_PRAEFIX} sweep uebersprungen grund=${SWEEP_UEBERSPRUNGEN_ANDERE_INSTANZ}`);
  }

  async function sweepeAktive() {
    const zugangFp = zugangsFingerabdruck(config.voice.elevenLabsInbound.sipUser);
    const aktive = store.load().numbers.filter((nummer) => nummer.status === NUMBER_STATUS.ACTIVE);
    const ergebnisse = await mitBegrenzterParallelitaet(aktive, SWEEP_PARALLEL, (nummer) =>
      pruefeNummer(nummer, zugangFp),
    );
    logger.log(
      trunkSweepErgebnisZeile({ scope: config.voice.elevenLabsInbound.scope, ergebnisse }),
    );
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
