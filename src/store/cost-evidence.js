import {
  REIFE,
  REIFE_FORTSCHRITT,
  REIFE_TERMINAL,
  REIFE_SUMMIERBAR,
  isProviderMicroCents,
} from "./defaults.js";
import { KOSTENARTEN } from "../billing/kostenarten.js";

const BELEG_REF_MUSTER = /^[A-Za-z0-9_:=-]{1,128}$/;
const QUELLE_MUSTER = /^[a-z][a-z0-9_]{0,63}$/;

export function isBelegRef(wert) {
  return typeof wert === "string" && BELEG_REF_MUSTER.test(wert);
}
const DETAIL_TEXT_MAX = 64;
const DETAIL_MAX_TIEFE = 6;

export function isKnownTraeger(traeger) {
  return Object.hasOwn(KOSTENARTEN, traeger);
}

export function isKnownMaturity(reife) {
  return Object.values(REIFE).includes(reife);
}

export function isTerminalMaturity(reife) {
  return REIFE_TERMINAL.includes(reife);
}

export function canSetEvidenceMaturity(von, nach) {
  if (von === nach) return true;
  if (isTerminalMaturity(von)) return false;
  if (isTerminalMaturity(nach)) return true;
  const rangVon = REIFE_FORTSCHRITT.indexOf(von);
  const rangNach = REIFE_FORTSCHRITT.indexOf(nach);
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

const AUSGABESCHLUESSEL = new Map(BELEG_DETAIL_PFADE.map((pfad) => [pfad, pfad.replace(".", "_")]));

const VERSCHACHTELTE_PFAD_TIEFE = 2;

function trefferPfad(stapel) {
  const letztes = stapel.at(-1);
  if (AUSGABESCHLUESSEL.has(letztes)) return letztes;
  const zweiteilig = `${stapel.at(-VERSCHACHTELTE_PFAD_TIEFE)}.${letztes}`;
  return AUSGABESCHLUESSEL.has(zweiteilig) ? zweiteilig : null;
}

function istErlaubterWert(wert) {
  if (typeof wert === "number") return Number.isFinite(wert);
  return typeof wert === "string" && wert.length > 0 && wert.length <= DETAIL_TEXT_MAX;
}

function treffer(wert, stapel) {
  if (stapel.length > DETAIL_MAX_TIEFE) return [];
  if (wert !== null && typeof wert === "object") {
    return Object.entries(wert).flatMap(([name, kind]) => treffer(kind, [...stapel, name]));
  }
  const pfad = stapel.length ? trefferPfad(stapel) : null;
  const schluessel = pfad && AUSGABESCHLUESSEL.get(pfad);
  return schluessel && istErlaubterWert(wert) ? [[schluessel, wert]] : [];
}

export function belegDetailAusRohdaten(roh) {
  if (roh === null || typeof roh !== "object") return null;
  const ziel = {};
  for (const [schluessel, wert] of treffer(roh, [])) {
    if (!Object.hasOwn(ziel, schluessel)) ziel[schluessel] = wert;
  }
  return Object.keys(ziel).length ? Object.freeze(ziel) : null;
}

function pruefeTraegerUndReife(eingabe) {
  if (!isKnownTraeger(eingabe.traeger))
    throw new Error(`cost-evidence: unbekannter Traeger '${eingabe.traeger}'`);
  if (!isKnownMaturity(eingabe.reife))
    throw new Error(`cost-evidence: unbekannte Reife '${eingabe.reife}'`);
}

function pruefeGeld(eingabe) {
  const { reife, betragMikroCents, waehrung } = eingabe;
  if (reife === REIFE.ERWARTET) {
    if (betragMikroCents !== undefined && betragMikroCents !== null)
      throw new Error("cost-evidence: 'erwartet' darf keinen Betrag tragen");
    return;
  }
  if (betragMikroCents === undefined || betragMikroCents === null) return;
  if (!isProviderMicroCents(betragMikroCents))
    throw new Error(`cost-evidence: betragMikroCents '${betragMikroCents}' ist kein gueltiger Betrag`);
  if (!waehrung)
    throw new Error("cost-evidence: ein Betrag ohne Waehrung ist nicht buchbar");
}

function pruefeEtiketten(eingabe) {
  const { belegRef, quelle } = eingabe;
  if (belegRef !== undefined && belegRef !== null && !isBelegRef(belegRef))
    throw new Error(`cost-evidence: belegRef '${belegRef}' hat kein gueltiges Format`);
  if (quelle !== undefined && quelle !== null && !QUELLE_MUSTER.test(quelle))
    throw new Error(`cost-evidence: quelle '${quelle}' hat kein gueltiges Format`);
}

function pruefeZaehler(eingabe) {
  for (const feld of ["versuche", "abstandZumGespraechsendeS"]) {
    const wert = eingabe[feld];
    if (wert === undefined || wert === null) continue;
    if (!Number.isSafeInteger(wert) || wert < 0)
      throw new Error(`cost-evidence: '${feld}' muss eine nicht-negative Ganzzahl sein`);
  }
}

function pruefeNachreifbar(eingabe) {
  const { nachreifbar } = eingabe;
  if (nachreifbar === undefined || typeof nachreifbar === "boolean") return;
  throw new Error(`cost-evidence: 'nachreifbar' muss ein Boolean sein, nicht '${nachreifbar}'`);
}

export function assertCostEvidenceInput(eingabe) {
  pruefeTraegerUndReife(eingabe);
  pruefeGeld(eingabe);
  pruefeEtiketten(eingabe);
  pruefeZaehler(eingabe);
  pruefeNachreifbar(eingabe);
}

const COST_EVIDENCE_WERTFELDER = Object.freeze([
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

export function buildCostEvidenceRow({ id, tenantId, callId, eingabe }) {
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

export function costEvidenceValuePatch(eingabe) {
  const patch = {};
  for (const feld of COST_EVIDENCE_WERTFELDER) {
    if (eingabe[feld] !== undefined) patch[feld] = eingabe[feld];
  }
  if ("detail" in patch) patch.detail = belegDetailAusRohdaten(patch.detail);
  return patch;
}

export function costEvidenceFortschreibung(vorhanden, eingabe) {
  const patch = costEvidenceValuePatch(eingabe);
  if (vorhanden.nachreifbar === false) patch.nachreifbar = false;
  return patch;
}

export function summierbareBelegzeilen(zeilen) {
  return zeilen.filter(
    (zeile) => REIFE_SUMMIERBAR.includes(zeile.reife) && isProviderMicroCents(zeile.betragMikroCents),
  );
}

export function costEvidenceSumMicroCents(zeilen) {
  return summierbareBelegzeilen(zeilen).reduce((summe, zeile) => summe + zeile.betragMikroCents, 0);
}
