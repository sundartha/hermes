#!/usr/bin/env node
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
const USD_DECIMALS_SCALE = 1_000_000;
const JSON_INDENT = 2;

export const RECORD_TYPES_TO_PROBE = Object.freeze([
  "sip-trunking", "call-control", "speech-to-text", "text-to-speech", "recording", "ai-voice-assistant",
  "inference",
]);

function parsedIds(csv) {
  return (csv || "").split(",").map((eintrag) => eintrag.trim()).filter(Boolean);
}

async function fetchPage(recordType, pageNumber) {
  const url = new URL(DETAIL_RECORDS_PATH, TELNYX_API_BASE);
  url.searchParams.set("filter[record_type]", recordType);
  url.searchParams.set("page[size]", String(PAGE_SIZE));
  url.searchParams.set("page[number]", String(pageNumber));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TELNYX_API_KEY}` } });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, url: url.pathname + url.search, data: body.data || [], meta: body.meta };
}

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

async function fetchRecordsByType() {
  const recordsByType = new Map();
  for (const recordType of RECORD_TYPES_TO_PROBE) {
    const ergebnis = await fetchAllPages(recordType);
    if (!ergebnis.ok) return { ok: false, status: ergebnis.status, url: ergebnis.url };
    recordsByType.set(recordType, ergebnis.records);
  }
  return { ok: true, recordsByType };
}

function positivkontrolle(callControlRecords, knownCallControlId) {
  if (!knownCallControlId) return { status: "uebersprungen", grund: "KV2_5_KNOWN_CALL_CONTROL_ID nicht gesetzt" };
  const treffer = callControlRecords.some((eintrag) => eintrag.call_control_id === knownCallControlId);
  return { status: treffer ? "ok" : "fehlgeschlagen", callControlId: knownCallControlId };
}

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

function latenzObergrenzeMinuten(sipRecords, nowMs) {
  let juengsterMs = null;
  for (const eintrag of sipRecords) {
    const ms = Date.parse(eintrag.started_at);
    if (Number.isFinite(ms) && (juengsterMs === null || ms > juengsterMs)) juengsterMs = ms;
  }
  if (juengsterMs === null) return null;
  return Math.round((nowMs - juengsterMs) / MS_PER_MINUTE);
}

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

const istHauptmodul = fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
if (istHauptmodul) {
  main().catch((fehler) => meldeAbbruch(`unerwarteter Fehler. ${fehler.message}`));
}
