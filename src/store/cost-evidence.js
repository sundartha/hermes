// KV2-3 (tasks/kostenv2/spec-kv2-3.md): das REGELWERK des Kosten-Buchs
// call_cost_evidence - Wertebereiche, Waechter, die detail-Allowlist und die Summenregel.
// Zustandsberuehrend ist NICHTS hier: state-ops.js besitzt die zwei Operationen und ruft
// diese Bausteine. Muster src/billing/kostenarten.js (eingefrorene Tabellen, Pruefung an
// EINER Stelle), Import-frei von allem ausser store/defaults.js (kein Zyklus).

import {
  REIFE,
  REIFE_FORTSCHRITT,
  REIFE_TERMINAL,
  REIFE_SUMMIERBAR,
  isProviderMicroCents,
} from "./defaults.js";
import { KOSTENARTEN } from "../billing/kostenarten.js";

// ---- Benannte Konstanten (G25) ---------------------------------------------------------
const BELEG_REF_MUSTER = /^[A-Za-z0-9_-]{1,128}$/;
const QUELLE_MUSTER = /^[a-z][a-z0-9_]{0,63}$/;
// Maximale Textlaenge eines detail-Werts (G25). Zu lang -> kein Preis-/Mengenfeld mehr,
// sondern potenziell ein Freitext-Feld (Transkript, Beschreibung) - faellt raus.
const DETAIL_TEXT_MAX = 64;
// Rekursionstiefe der detail-Projektion (G25). Terminiert die Suche auch bei einem
// (theoretisch) zyklischen Anbieter-Objekt, ohne einen separaten Zyklus-Waechter zu bauen.
const DETAIL_MAX_TIEFE = 6;

// ---- Wertebereich / Uebergaenge ---------------------------------------------------------

// Ist traeger eine bekannte Kostenart (KV2-2)? Reines Praedikat.
export function isKnownTraeger(traeger) {
  return Object.hasOwn(KOSTENARTEN, traeger);
}

// Ist reife ein bekannter Reifegrad (defaults.REIFE)? Reines Praedikat.
export function isKnownMaturity(reife) {
  return Object.values(REIFE).includes(reife);
}

// Ist reife ein TERMINALER Zustand? Reines Praedikat.
export function isTerminalMaturity(reife) {
  return REIFE_TERMINAL.includes(reife);
}

// Darf eine Belegzeile von 'von' nach 'nach' uebergehen? Kriterium (b):
//   - Gleichstand ist immer erlaubt (Idempotenz, auch bei einem terminalen Zustand).
//   - HINEIN in einen terminalen Zustand ist aus JEDEM Vorzustand erlaubt (b)(i).
//   - HERAUS aus einem terminalen Zustand fuehrt NIE ein Uebergang (b)(ii).
//   - Sonst: der FORTSCHRITTS-Rang darf nicht sinken (b)(iv), Ueberspringen erlaubt.
// Reines Praedikat, kein Wurf - der Aufrufer (state-ops.js) entscheidet, was ein
// verbotener Uebergang bedeutet (dort: wirft).
export function canSetEvidenceMaturity(von, nach) {
  if (von === nach) return true;
  if (isTerminalMaturity(von)) return false;
  if (isTerminalMaturity(nach)) return true;
  const rangVon = REIFE_FORTSCHRITT.indexOf(von);
  const rangNach = REIFE_FORTSCHRITT.indexOf(nach);
  if (rangVon === -1 || rangNach === -1) return false;
  return rangNach >= rangVon;
}

// ---- detail-Allowlist --------------------------------------------------------------------

// SUFFIX-PFADE, nicht flache Schluessel: 'analysis.price' muss den Preis unter analysis
// treffen, ohne das ganze analysis-Objekt (mit transcript_summary!) durchzulassen.
export const BELEG_DETAIL_PFADE = Object.freeze([
  "llm_price",
  "platform_price",
  "analysis.price",
  "billed_sec",
  "call_duration_secs",
  "rate",
  "tier",
]);

// Pfad -> Ausgabeschluessel (Punkt wird zu Unterstrich: 'analysis.price' -> 'analysis_price').
const AUSGABESCHLUESSEL = new Map(BELEG_DETAIL_PFADE.map((pfad) => [pfad, pfad.replace(".", "_")]));

// Wie viele Pfad-Segmente ein VERSCHACHTELTER Allowlist-Eintrag (z.B. 'analysis.price')
// hoechstens braucht: das Elternsegment plus das Blattsegment selbst (G25: benannt statt
// einer nackten -2 in stapel.at()).
const VERSCHACHTELTE_PFAD_TIEFE = 2;

// Trifft der aktuelle Pfad-Stapel einen Allowlist-Eintrag? Prueft zuerst das letzte
// Segment allein (flache Pfade wie 'llm_price'), dann die letzten zwei Segmente
// zusammen (verschachtelte Pfade wie 'analysis.price' - das Elternsegment MUSS passen).
function trefferPfad(stapel) {
  const letztes = stapel.at(-1);
  if (AUSGABESCHLUESSEL.has(letztes)) return letztes;
  const zweiteilig = `${stapel.at(-VERSCHACHTELTE_PFAD_TIEFE)}.${letztes}`;
  return AUSGABESCHLUESSEL.has(zweiteilig) ? zweiteilig : null;
}

// Ist wert als detail-Wert zulaessig? Nur Skalare, Strings mit Laengendeckel (kein
// Transkript/Freitext), keine Objekte/Arrays (die wuerden ein ganzes Anbieter-Segment
// durchreichen statt eines Preis-/Mengenfelds).
function istErlaubterWert(wert) {
  if (typeof wert === "number") return Number.isFinite(wert);
  return typeof wert === "string" && wert.length > 0 && wert.length <= DETAIL_TEXT_MAX;
}

// Durchsucht wert rekursiv nach Allowlist-Treffern und liefert sie als [schluessel, wert]-
// Paare zurueck - REIN, keine Mutation eines mitgegebenen Sammelobjekts (P6/F2). stapel
// traegt die Pfad-Segmente bis hierher; DETAIL_MAX_TIEFE bricht die Rekursion ab (haelt die
// Funktion terminierend, auch bei kuenstlich tiefen/zyklischen Objekten).
function treffer(wert, stapel) {
  if (stapel.length > DETAIL_MAX_TIEFE) return [];
  if (wert !== null && typeof wert === "object") {
    return Object.entries(wert).flatMap(([name, kind]) => treffer(kind, [...stapel, name]));
  }
  const pfad = stapel.length ? trefferPfad(stapel) : null;
  const schluessel = pfad && AUSGABESCHLUESSEL.get(pfad);
  return schluessel && istErlaubterWert(wert) ? [[schluessel, wert]] : [];
}

// Projiziert einen beliebigen Anbieter-Rumpf auf die Allowlist. Unbekannter Schluessel,
// Objekt-/Array-Wert, zu langer String -> faellt raus (Muster sanitizeProfile, nur tief).
// Erster Treffer je Ausgabeschluessel gewinnt (deterministische Pre-Order via
// Object.entries). Kein Treffer -> null (die Spalte bleibt NULL statt ein leeres Objekt
// zu tragen).
export function belegDetailAusRohdaten(roh) {
  if (roh === null || typeof roh !== "object") return null;
  const ziel = {};
  for (const [schluessel, wert] of treffer(roh, [])) {
    if (!Object.hasOwn(ziel, schluessel)) ziel[schluessel] = wert;
  }
  return Object.keys(ziel).length ? Object.freeze(ziel) : null;
}

// ---- Eingabe-Waechter (werfen; je Waechter EINE Frage, G30) ------------------------------

function pruefeTraegerUndReife(eingabe) {
  if (!isKnownTraeger(eingabe.traeger))
    throw new Error(`cost-evidence: unbekannter Traeger '${eingabe.traeger}'`);
  if (!isKnownMaturity(eingabe.reife))
    throw new Error(`cost-evidence: unbekannte Reife '${eingabe.reife}'`);
}

// Geld-Regel: im Zustand 'erwartet' ist der Betrag IMMER NULL (nie 0 - eine 0 waere eine
// erfundene Messung), sonst muss er, wenn mitgeliefert, ein gueltiger Anbieter-Mikro-Cent-
// Betrag MIT Waehrung sein.
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

// Etiketten-Form: beleg_ref und quelle sind opake Kennungen, keine Freitextfelder (PII-Riegel).
function pruefeEtiketten(eingabe) {
  const { belegRef, quelle } = eingabe;
  if (belegRef !== undefined && belegRef !== null && !BELEG_REF_MUSTER.test(belegRef))
    throw new Error(`cost-evidence: belegRef '${belegRef}' hat kein gueltiges Format`);
  if (quelle !== undefined && quelle !== null && !QUELLE_MUSTER.test(quelle))
    throw new Error(`cost-evidence: quelle '${quelle}' hat kein gueltiges Format`);
}

// Zaehler: versuche/abstandZumGespraechsendeS muessen, wenn gesetzt, nicht-negative
// Ganzzahlen sein.
function pruefeZaehler(eingabe) {
  for (const feld of ["versuche", "abstandZumGespraechsendeS"]) {
    const wert = eingabe[feld];
    if (wert === undefined || wert === null) continue;
    if (!Number.isSafeInteger(wert) || wert < 0)
      throw new Error(`cost-evidence: '${feld}' muss eine nicht-negative Ganzzahl sein`);
  }
}

// Ruft die vier Einzelwaechter (G30: eine Aufgabe pro Funktion, hier die Buendelung).
export function assertCostEvidenceInput(eingabe) {
  pruefeTraegerUndReife(eingabe);
  pruefeGeld(eingabe);
  pruefeEtiketten(eingabe);
  pruefeZaehler(eingabe);
}

// ---- Zeilen-Bau / Fortschreibung ---------------------------------------------------------

// Die Wertfelder, die eine Reifung ueberschreiben darf - reife/traeger/id/callId/tenantId
// sind bewusst NICHT dabei (die haelt der Aufrufer separat, s. costEvidenceValuePatch).
const COST_EVIDENCE_WERTFELDER = Object.freeze([
  "betragMikroCents",
  "waehrung",
  "quelle",
  "belegRef",
  "versuche",
  "gemessenAt",
  "abstandZumGespraechsendeS",
  "detail",
]);

// Baut eine neue Belegzeile. tenantId kommt vom Aufrufer (aus dem Anruf abgeleitet,
// state-ops.js) - dieses Modul trifft keine Tenant-Entscheidung. REIN: liefert ein neues
// Objekt, mutiert nichts (P6/F2).
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
  };
  return { ...basis, ...costEvidenceValuePatch(eingabe) };
}

// Nur die mitgelieferten (!== undefined) Wertfelder als eigenstaendiges Patch-Objekt -
// "letzter Schreiber gewinnt" fuer das, was der Aufrufer tatsaechlich mitbringt. REIN
// (P6/F2): liefert ein neues Objekt statt eine bestehende Zeile zu mutieren; der Aufrufer
// (state-ops.js, Eigentuemer des Zustands) wendet das Patch per Object.assign an.
export function costEvidenceValuePatch(eingabe) {
  const patch = {};
  for (const feld of COST_EVIDENCE_WERTFELDER) {
    if (eingabe[feld] !== undefined) patch[feld] = eingabe[feld];
  }
  return patch;
}

// ---- Summenregel (Kriterium (e)) ---------------------------------------------------------

// Summe der Belegzeilen in Mikro-Cent. Zaehlt AUSSCHLIESSLICH vorlaeufig|belegt und nur
// Zeilen mit echtem Ganzzahl-Betrag. Ein 'erwartet'-Posten (oder ein terminal markierter)
// traegt NICHTS bei - nicht den Betrag 0, gar nichts. Kein `?? 0`: ein NULL-Betrag darf
// nie stillschweigend zur 0 werden.
export function costEvidenceSumMicroCents(zeilen) {
  return zeilen
    .filter((zeile) => REIFE_SUMMIERBAR.includes(zeile.reife) && isProviderMicroCents(zeile.betragMikroCents))
    .reduce((summe, zeile) => summe + zeile.betragMikroCents, 0);
}
