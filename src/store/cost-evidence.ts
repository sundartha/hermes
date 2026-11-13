import {
  REIFE,
  REIFE_FORTSCHRITT,
  REIFE_TERMINAL,
  REIFE_SUMMIERBAR,
  isProviderMicroCents,
} from "../begriffe/abrechnung.js";
import { KOSTENARTEN } from "../billing/kostenarten.js";

interface Wertfelder {
  betragMikroCents?: number | null;
  waehrung?: string | null;
  quelle?: string | null;
  belegRef?: string | null;
  versuche?: number | null;
  gemessenAt?: string | null;
  abstandZumGespraechsendeS?: number | null;
  detail?: unknown;
  nachreifbar?: boolean;
}

export interface CostEvidenceEingabe extends Wertfelder {
  traeger: string;
  reife: string;
}

export interface CostEvidenceZeile {
  id: string;
  tenantId: string;
  callId: string;
  traeger: string;
  reife: string;
  betragMikroCents: number | null;
  waehrung: string | null;
  quelle: string | null;
  belegRef: string | null;
  versuche: number | null;
  gemessenAt: string | null;
  abstandZumGespraechsendeS: number | null;
  detail: unknown;
  nachreifbar: boolean;
}

interface SummierbareZeile {
  reife?: string | undefined;
  betragMikroCents?: number | null | undefined;
}

type BelegDetail = Readonly<Record<string, number | string>>;

const BELEG_REF_MUSTER = /^[A-Za-z0-9_:=-]{1,128}$/;
const QUELLE_MUSTER = /^[a-z][a-z0-9_]{0,63}$/;

export function isBelegRef(wert: unknown): boolean {
  return typeof wert === "string" && BELEG_REF_MUSTER.test(wert);
}
const DETAIL_TEXT_MAX = 64;
const DETAIL_MAX_TIEFE = 6;

export function isKnownTraeger(traeger: string): boolean {
  return Object.hasOwn(KOSTENARTEN, traeger);
}

export function isKnownMaturity(reife: string): boolean {
  const alleReifen: readonly string[] = Object.values(REIFE);
  return alleReifen.includes(reife);
}

export function isTerminalMaturity(reife: string): boolean {
  const terminal: readonly string[] = REIFE_TERMINAL;
  return terminal.includes(reife);
}

export function canSetEvidenceMaturity(von: string, nach: string): boolean {
  if (von === nach) return true;
  if (isTerminalMaturity(von)) return false;
  if (isTerminalMaturity(nach)) return true;
  const fortschritt: readonly string[] = REIFE_FORTSCHRITT;
  const rangVon = fortschritt.indexOf(von);
  const rangNach = fortschritt.indexOf(nach);
  if (rangVon === -1 || rangNach === -1) return false;
  return rangNach >= rangVon;
}

export const BELEG_DETAIL_PFADE = Object.freeze([
  "llm_price",
  "platform_price",
  "analysis.price",
  "billed_sec",
  "call_duration_secs",
  "rate",
  "tier",
]);

const AUSGABESCHLUESSEL: ReadonlyMap<string | undefined, string> = new Map(
  BELEG_DETAIL_PFADE.map((pfad) => [pfad, pfad.replace(".", "_")]),
);

const VERSCHACHTELTE_PFAD_TIEFE = 2;

function trefferPfad(stapel: string[]): string | null | undefined {
  const letztes = stapel.at(-1);
  if (AUSGABESCHLUESSEL.has(letztes)) return letztes;
  const zweiteilig = `${String(stapel.at(-VERSCHACHTELTE_PFAD_TIEFE))}.${String(letztes)}`;
  return AUSGABESCHLUESSEL.has(zweiteilig) ? zweiteilig : null;
}

function erlaubterWert(wert: unknown): number | string | null {
  if (typeof wert === "number") return Number.isFinite(wert) ? wert : null;
  return typeof wert === "string" && wert.length > 0 && wert.length <= DETAIL_TEXT_MAX ? wert : null;
}

function treffer(wert: unknown, stapel: string[]): [string, number | string][] {
  if (stapel.length > DETAIL_MAX_TIEFE) return [];
  if (wert !== null && typeof wert === "object") {
    return Object.entries(wert).flatMap(([name, kind]) => treffer(kind, [...stapel, name]));
  }
  const pfad = stapel.length ? trefferPfad(stapel) : null;
  const schluessel = pfad && AUSGABESCHLUESSEL.get(pfad);
  const erlaubt = erlaubterWert(wert);
  return schluessel && erlaubt !== null ? [[schluessel, erlaubt]] : [];
}

export function belegDetailAusRohdaten(roh: unknown): BelegDetail | null {
  if (roh === null || typeof roh !== "object") return null;
  const ziel: Record<string, number | string> = {};
  for (const [schluessel, wert] of treffer(roh, [])) {
    if (!Object.hasOwn(ziel, schluessel)) ziel[schluessel] = wert;
  }
  return Object.keys(ziel).length ? Object.freeze(ziel) : null;
}

function pruefeTraegerUndReife(eingabe: CostEvidenceEingabe): void {
  if (!isKnownTraeger(eingabe.traeger))
    throw new Error(`cost-evidence: unbekannter Traeger '${eingabe.traeger}'`);
  if (!isKnownMaturity(eingabe.reife))
    throw new Error(`cost-evidence: unbekannte Reife '${eingabe.reife}'`);
}

function pruefeGeld(eingabe: CostEvidenceEingabe): void {
  const { reife, betragMikroCents, waehrung } = eingabe;
  if (reife === REIFE.ERWARTET) {
    if (betragMikroCents !== undefined && betragMikroCents !== null)
      throw new Error("cost-evidence: 'erwartet' darf keinen Betrag tragen");
    return;
  }
  if (betragMikroCents === undefined || betragMikroCents === null) return;
  if (!isProviderMicroCents(betragMikroCents))
    throw new Error(`cost-evidence: betragMikroCents '${String(betragMikroCents)}' ist kein gueltiger Betrag`);
  if (!waehrung)
    throw new Error("cost-evidence: ein Betrag ohne Waehrung ist nicht buchbar");
}

function pruefeEtiketten(eingabe: CostEvidenceEingabe): void {
  const { belegRef, quelle } = eingabe;
  if (belegRef !== undefined && belegRef !== null && !isBelegRef(belegRef))
    throw new Error(`cost-evidence: belegRef '${belegRef}' hat kein gueltiges Format`);
  if (quelle !== undefined && quelle !== null && !QUELLE_MUSTER.test(quelle))
    throw new Error(`cost-evidence: quelle '${quelle}' hat kein gueltiges Format`);
}

const ZAEHLERFELDER: readonly ("versuche" | "abstandZumGespraechsendeS")[] = [
  "versuche",
  "abstandZumGespraechsendeS",
];

function pruefeZaehler(eingabe: CostEvidenceEingabe): void {
  for (const feld of ZAEHLERFELDER) {
    const wert = eingabe[feld];
    if (wert === undefined || wert === null) continue;
    if (!Number.isSafeInteger(wert) || wert < 0)
      throw new Error(`cost-evidence: '${feld}' muss eine nicht-negative Ganzzahl sein`);
  }
}

function pruefeNachreifbar(eingabe: CostEvidenceEingabe): void {
  const { nachreifbar } = eingabe;
  if (nachreifbar === undefined || typeof nachreifbar === "boolean") return;
  throw new Error(`cost-evidence: 'nachreifbar' muss ein Boolean sein, nicht '${String(nachreifbar)}'`);
}

export function assertCostEvidenceInput(eingabe: CostEvidenceEingabe): void {
  pruefeTraegerUndReife(eingabe);
  pruefeGeld(eingabe);
  pruefeEtiketten(eingabe);
  pruefeZaehler(eingabe);
  pruefeNachreifbar(eingabe);
}

const COST_EVIDENCE_WERTFELDER: readonly (keyof Wertfelder)[] = Object.freeze([
  "betragMikroCents",
  "waehrung",
  "quelle",
  "belegRef",
  "versuche",
  "gemessenAt",
  "abstandZumGespraechsendeS",
  "detail",
  "nachreifbar",
]);

export function buildCostEvidenceRow({
  id,
  tenantId,
  callId,
  eingabe,
}: {
  id: string;
  tenantId: string;
  callId: string;
  eingabe: CostEvidenceEingabe;
}): CostEvidenceZeile {
  const basis = {
    id,
    tenantId,
    callId,
    traeger: eingabe.traeger,
    reife: eingabe.reife,
    betragMikroCents: null,
    waehrung: null,
    quelle: null,
    belegRef: null,
    versuche: 0,
    gemessenAt: null,
    abstandZumGespraechsendeS: null,
    detail: null,
    nachreifbar: true,
  };
  return { ...basis, ...costEvidenceValuePatch(eingabe) };
}

export function costEvidenceValuePatch(eingabe: Wertfelder): Wertfelder {
  const patch: Wertfelder = {};
  for (const feld of COST_EVIDENCE_WERTFELDER) {
    if (eingabe[feld] !== undefined) Object.assign(patch, { [feld]: eingabe[feld] });
  }
  if ("detail" in patch) patch.detail = belegDetailAusRohdaten(patch.detail);
  return patch;
}

export function costEvidenceFortschreibung(
  vorhanden: { nachreifbar?: boolean },
  eingabe: Wertfelder,
): Wertfelder {
  const patch = costEvidenceValuePatch(eingabe);
  if (vorhanden.nachreifbar === false) patch.nachreifbar = false;
  return patch;
}

const SUMMIERBARE_REIFEN: readonly (string | undefined)[] = REIFE_SUMMIERBAR;

export function summierbareBelegzeilen<T extends SummierbareZeile>(zeilen: T[]): T[] {
  return zeilen.filter(
    (zeile) => SUMMIERBARE_REIFEN.includes(zeile.reife) && isProviderMicroCents(zeile.betragMikroCents),
  );
}

export function costEvidenceSumMicroCents(zeilen: SummierbareZeile[]): number {
  return summierbareBelegzeilen(zeilen).reduce((summe, zeile) => summe + Number(zeile.betragMikroCents), 0);
}
