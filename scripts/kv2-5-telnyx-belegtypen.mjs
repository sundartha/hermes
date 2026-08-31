#!/usr/bin/env node
// KV2-5 (tasks/kostenv2/spec-kv2-5.md, Abnahmekriterium (d)): das Messwerkzeug fuer die
// Pflicht-Typmenge des Profils el_convai_sip. LESEND, kein Schreibzugriff. Wiederholbar
// (Repo-Praxis: scripts/*.mjs, Muster check-outbound-drift.mjs/stt-wer.mjs).
//
// Drei Ausgaben, EINE Ausfuehrung:
//   Q1 (Pflicht-Typmenge): welche record_type-Werte fuehrt der EL-Weg BEWEISBAR?
//   Q2 (Latenz-Obergrenze): ehrliche Obergrenze (jetzt - started_at des juengsten Belegs),
//       NICHT die reale Latenz - die ist retrospektiv nicht messbar (s. Ausgabe).
//   Q3 (inference): traegt record_type=inference auf diesem Konto ueberhaupt Betraege?
//
// POSITIV-KONTROLLE ist PFLICHT (Lehre pruefkommando-ohne-positiv-kontrolle): ohne den
// Nachweis, dass der Abruf fuer eine BEKANNTE call_control_id aus dem ALTEN Telnyx-
// Zeitraum ueberhaupt Treffer liefert, ist "0 Treffer fuer EL" kein Messergebnis, sondern
// ein kaputtes Kommando. Scheitert sie, gilt (d) als gescheitert - unabhaengig vom
// EL-Ergebnis.
//
// Eingaben (per Env, NIEMALS im Code hartkodiert - operative Daten, keine Geheimnisse,
// aber Konto-spezifisch und nur durch eine DB-Abfrage zu beschaffen, s. Kopf-Kommentar
// unten bei KV2_5_KNOWN_SIP_CALL_IDS):
//   TELNYX_API_KEY                    - Pflicht, wird NIE geloggt/ausgegeben
//   TELNYX_API_BASE                   - Default https://api.telnyx.com
//   KV2_5_KNOWN_SIP_CALL_IDS          - kommagetrennt, die bekannten sip_call_id-Werte der
//                                        EL-Anrufe (z.B. aus einer lesenden DB-Abfrage auf
//                                        calls.sip_call_id WHERE cost_profile='el_convai_sip')
//   KV2_5_KNOWN_CALL_CONTROL_ID       - EINE bekannte call_control_id aus dem ALTEN
//                                        Telnyx-Zeitraum (Positiv-Kontrolle, Q0)
//
// Ausgabe: eine Textbilanz PLUS ein JSON-Block - beide PII-frei (keine Rufnummer, kein
// API-Key, keine Rufnummer in cld/cli wird gedruckt).
//
// G35-Ausnahme (wie bei den uebrigen operativen scripts/*.mjs, z.B. convo-bench.mjs,
// deepseek-b1-messung.mjs): dieses Skript laeuft AUSSERHALB des Servers und importiert
// deshalb bewusst nicht src/config.js (kein Config-/Boot-Seiteneffekt in einem reinen
// CLI-Werkzeug) - process.env ist hier die einzig sinnvolle Quelle.
//
// Die reinen Funktionen sind exportiert und main() laeuft nur, wenn das Skript direkt
// ausgefuehrt wird (istHauptmodul-Wache, Muster scripts/check-outbound-drift.mjs) - so
// kann ein Test die Messlogik pinnen, ohne TELNYX_API_KEY zu brauchen oder main() beim
// Import ungewollt mit Netz-IO auszuloesen.

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const TELNYX_API_BASE = process.env.TELNYX_API_BASE || "https://api.telnyx.com";
const TELNYX_API_KEY = process.env.TELNYX_API_KEY || "";
const DETAIL_RECORDS_PATH = "/v2/detail_records";
const PAGE_SIZE = 50;
const FIRST_PAGE = 1;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
const USD_DECIMALS_SCALE = 1_000_000; // Rundung der USD-Summe auf 6 Nachkommastellen
const JSON_INDENT = 2;

// Bekannte Belegtypen (ASSIGNABLE_COST_RECORD_TYPES, s. src/telephony/adapters/telnyx/voice.js) -
// EXPLIZIT dupliziert statt importiert: dieses Skript laeuft ausserhalb des Servers und
// darf keinen Netz-/Config-Seiteneffekt eines src/-Imports mitziehen (reines CLI-Werkzeug).
// "inference" gehoert NICHT zu ASSIGNABLE_COST_RECORD_TYPES (kein Traeger bucht ihn heute),
// steht aber trotzdem in der Probe-Liste - Q3 verspricht im Kopfkommentar ausdruecklich,
// zu messen, ob der Typ auf diesem Konto ueberhaupt Betraege traegt. Ohne den Typ in dieser
// Liste bleibt inferenceBilanz() immer auf der leeren Liste stehen (Map.get liefert
// undefined) und Q3 wird nie gemessen, sondern nur mit "0" vorgetaeuscht.
export const RECORD_TYPES_TO_PROBE = Object.freeze([
  "sip-trunking", "call-control", "speech-to-text", "text-to-speech", "recording", "ai-voice-assistant",
  "inference",
]);

function parsedIds(csv) {
  return (csv || "").split(",").map((eintrag) => eintrag.trim()).filter(Boolean);
}

// EIN GET gegen /v2/detail_records. ERLAUBTE Parameter AUSSCHLIESSLICH filter[record_type],
// page[size], page[number] - kein weiterer filter[...] (ein falscher Filtername liefert
// HTTP 200 mit 0 Treffern, stiller Datenverlust, s. voice.js-Kopfkommentar).
async function fetchPage(recordType, pageNumber) {
  const url = new URL(DETAIL_RECORDS_PATH, TELNYX_API_BASE);
  url.searchParams.set("filter[record_type]", recordType);
  url.searchParams.set("page[size]", String(PAGE_SIZE));
  url.searchParams.set("page[number]", String(pageNumber));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TELNYX_API_KEY}` } });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, url: url.pathname + url.search, data: body.data || [], meta: body.meta };
}

// Alle Seiten EINES Typs (Obergrenze: dieses Skript ist EINMALIG, keine Sweep-Drossel
// noetig - anders als der Produktions-Adapter blaettert es hier ohne Zeitfenster-Bindung
// bis zur letzten Seite oder bis zu einer kleinen Seitenobergrenze).
const MAX_PAGES = 20;
async function fetchAllPages(recordType) {
  const alle = [];
  for (let seite = FIRST_PAGE; seite <= MAX_PAGES; seite++) {
    const ergebnis = await fetchPage(recordType, seite);
    if (!ergebnis.ok) return { ok: false, status: ergebnis.status, url: ergebnis.url };
    alle.push(...ergebnis.data);
    const gesamtseiten = Number(ergebnis.meta?.total_pages);
    if (Number.isFinite(gesamtseiten) ? seite >= gesamtseiten : ergebnis.data.length < PAGE_SIZE) break;
  }
  return { ok: true, records: alle };
}

// Ruft ALLE Pflicht-Typen ab, oder liefert den ersten Fehlschlag (Statuscode+Endpunkt).
async function fetchRecordsByType() {
  const recordsByType = new Map();
  for (const recordType of RECORD_TYPES_TO_PROBE) {
    const ergebnis = await fetchAllPages(recordType);
    if (!ergebnis.ok) return { ok: false, status: ergebnis.status, url: ergebnis.url };
    recordsByType.set(recordType, ergebnis.records);
  }
  return { ok: true, recordsByType };
}

// Q0: Positiv-Kontrolle. Ein bekannter ALTER call_control_id-Wert MUSS im call-control-Pool
// auftauchen - sonst ist das Kommando selbst kaputt (falscher Filter, falscher Endpunkt,
// abgelaufener Schluessel), und ein spaeteres "0 Treffer" fuer EL beweist nichts.
function positivkontrolle(callControlRecords, knownCallControlId) {
  if (!knownCallControlId) return { status: "uebersprungen", grund: "KV2_5_KNOWN_CALL_CONTROL_ID nicht gesetzt" };
  const treffer = callControlRecords.some((eintrag) => eintrag.call_control_id === knownCallControlId);
  return { status: treffer ? "ok" : "fehlgeschlagen", callControlId: knownCallControlId };
}

// Q1: welche record_type-Werte fuehrt der EL-Weg BEWEISBAR? Ein Record gehoert zum EL-Weg,
// wenn er (a) eine der bekannten sip_call_id traegt ODER (b) eine telnyx_session_id, die
// AUCH auf einem der sip-trunking-Belege mit bekannter sip_call_id steht - exakt der Weg,
// den anchoredSessionIds() im Produktions-Adapter ginge.
function elWegTypen(recordsByType, knownSipCallIds) {
  const sipRecords = recordsByType.get("sip-trunking") || [];
  const elSessionIds = new Set(
    sipRecords
      .filter((eintrag) => knownSipCallIds.includes(eintrag.sip_call_id))
      .map((eintrag) => eintrag.telnyx_session_id)
      .filter(Boolean),
  );
  const typen = new Set();
  for (const [recordType, records] of recordsByType) {
    const gehoertZumElWeg = records.some(
      (eintrag) =>
        knownSipCallIds.includes(eintrag.sip_call_id) ||
        elSessionIds.has(eintrag.telnyx_session_id) ||
        elSessionIds.has(eintrag.call_session_id),
    );
    if (gehoertZumElWeg) typen.add(recordType);
  }
  return [...typen];
}

// Q2: ehrliche OBERGRENZE, nicht die reale Latenz (die ist retrospektiv nicht messbar -
// wir wissen nicht, WANN der Beleg zuerst verfuegbar war, nur dass er JETZT da ist).
function latenzObergrenzeMinuten(sipRecords, nowMs) {
  let juengsterMs = null;
  for (const eintrag of sipRecords) {
    const ms = Date.parse(eintrag.started_at);
    if (Number.isFinite(ms) && (juengsterMs === null || ms > juengsterMs)) juengsterMs = ms;
  }
  if (juengsterMs === null) return null;
  return Math.round((nowMs - juengsterMs) / MS_PER_MINUTE);
}

// Q3: traegt record_type=inference ueberhaupt Betraege? Aendert am Code NICHTS - wird nur
// beziffert (Katalogzeile #15, preisquelle).
export function inferenceBilanz(inferenceRecords) {
  let summeUsd = 0;
  for (const eintrag of inferenceRecords) {
    const wert = Number(eintrag.cost);
    if (Number.isFinite(wert)) summeUsd += wert;
  }
  return { anzahl: inferenceRecords.length, summeUsd: Math.round(summeUsd * USD_DECIMALS_SCALE) / USD_DECIMALS_SCALE };
}

function meldeAbbruch(nachricht) {
  console.error(`[kv2-5-messung] ABBRUCH: ${nachricht} Zeitpunkt=${new Date().toISOString()}`);
  process.exitCode = 1;
}

// Baut die Endbilanz aus den drei Teilmessungen - ausgelagert (G30), damit main() nur noch
// die Ablauf-Reihenfolge und die Abbruchpfade zeigt.
export function baueErgebnis({ recordsByType, knownSipCallIds }) {
  const typen = knownSipCallIds.length > 0 ? elWegTypen(recordsByType, knownSipCallIds) : [];
  const latenzObergrenze = latenzObergrenzeMinuten(recordsByType.get("sip-trunking") || [], Date.now());
  const inferenz = inferenceBilanz(recordsByType.get("inference") || []);
  return {
    positivkontrolle: "ok",
    el_weg_record_types: typen.sort(),
    el_weg_hinweis:
      knownSipCallIds.length === 0
        ? "KV2_5_KNOWN_SIP_CALL_IDS nicht gesetzt - kein Ergebnis, keine Ableitung"
        : undefined,
    latenz_obergrenze_minuten: latenzObergrenze,
    latenz_hinweis:
      "Obergrenze (jetzt - started_at), NICHT die reale Latenz bis Verfuegbarkeit - die ist retrospektiv nicht messbar.",
    inference_anzahl: inferenz.anzahl,
    inference_summe_usd: inferenz.summeUsd,
  };
}

function druckeErgebnis(ergebnis) {
  console.log("[kv2-5-messung] positiv-kontrolle=ok");
  console.log(`[kv2-5-messung] el-weg record_types=${JSON.stringify(ergebnis.el_weg_record_types)}`);
  console.log(`[kv2-5-messung] latenz_obergrenze_minuten=${ergebnis.latenz_obergrenze_minuten ?? "n/a"}`);
  console.log(`[kv2-5-messung] inference n=${ergebnis.inference_anzahl} summe_usd=${ergebnis.inference_summe_usd}`);
  console.log(JSON.stringify(ergebnis, null, JSON_INDENT));
}

async function main() {
  if (!TELNYX_API_KEY) {
    meldeAbbruch("TELNYX_API_KEY fehlt. Statuscode=n/a Endpunkt=n/a");
    return;
  }
  const knownSipCallIds = parsedIds(process.env.KV2_5_KNOWN_SIP_CALL_IDS);
  const knownCallControlId = (process.env.KV2_5_KNOWN_CALL_CONTROL_ID || "").trim() || null;

  const abruf = await fetchRecordsByType();
  if (!abruf.ok) {
    meldeAbbruch(`Abruf fehlgeschlagen. Statuscode=${abruf.status} Endpunkt=${abruf.url}`);
    return;
  }

  const kontrolle = positivkontrolle(abruf.recordsByType.get("call-control") || [], knownCallControlId);
  if (kontrolle.status !== "ok") {
    const grund = kontrolle.grund || `kein Treffer fuer ${kontrolle.callControlId}`;
    meldeAbbruch(
      `Positiv-Kontrolle nicht bestanden (${kontrolle.status}: ${grund}). ` +
        "Ein Ergebnis ohne bestandene Positiv-Kontrolle ist KEINE Messung.",
    );
    return;
  }

  druckeErgebnis(baueErgebnis({ recordsByType: abruf.recordsByType, knownSipCallIds }));
}

// istHauptmodul-Wache (Muster scripts/check-outbound-drift.mjs): main() laeuft NUR bei
// direkter Ausfuehrung, nicht wenn ein Test die reinen Funktionen oben importiert.
const istHauptmodul = fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
if (istHauptmodul) {
  main().catch((fehler) => meldeAbbruch(`unerwarteter Fehler. ${fehler.message}`));
}
