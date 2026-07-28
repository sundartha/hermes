#!/usr/bin/env node
// AL-P1 (PLAN-ASSISTANT-LEAP.md, Phase 1, Abbruch-Achse): read-only Auswertung der
// Quote "Angerufener legt waehrend der Eroeffnung auf".
// Definition (Spec): beantworteter OUTBOUND-Call mit endedAt-answeredAt < 15 s UND
// callerTurns === 0. Die naive Form ("null Anrufer-Zeilen") ist mit unseren Daten
// NICHT berechenbar: purgeTranscript leert call.transcript nach jeder Summary - sie
// traefe auf JEDEN abgeschlossenen Call zu. callerTurns ist purge-fest.
// RUECKWIRKEND NICHT ERHEBBAR: Bestandszeilen haben callerTurns=0, ohne dass ein
// Abbruch stattfand. Die Zahl misst ab Deploy VORWAERTS - der --since-Filter ist
// deshalb Pflichtargument, kein Komfort.
// Ausgabe: ausschliesslich Zaehler. Keine Rufnummer, keine call.id, kein Text.
import { fileURLToPath } from "url";
import { pgBackendActive, readAcrossTenants } from "./prod-read.mjs";

const OUTBOUND = "outbound";
// Spec-Fenster der Abbruch-Definition. Analyse-Konstante, KEIN Operator-Knopf ->
// modul-lokal, nicht config.js (G35, Muster EVENT_TOKEN_MAX_LEN).
export const ABANDON_WINDOW_MS = 15_000;
const PERCENT = 100;
const SINCE_FLAG = "--since";

// Ein Call zaehlt als Abbruch (reines Praedikat, von abandonStats genutzt).
// Unparsebare Zeitstempel -> false (nie raten).
function isEarlyAbandon(row, windowMs) {
  if (row.direction !== OUTBOUND) return false;
  if (!row.answeredAt || !row.endedAt) return false;
  if (row.callerTurns !== 0) return false;
  const answered = Date.parse(row.answeredAt);
  const ended = Date.parse(row.endedAt);
  if (Number.isNaN(answered) || Number.isNaN(ended)) return false;
  return ended - answered < windowMs;
}

// Reine Auswertung (P11/P12: offline testbar, kein IO, keine Uhr).
// rows: [{ direction, answeredAt, endedAt, callerTurns }]
// Rueckgabe: { answeredOutbound, abandoned, ratePercent } - ratePercent ist null bei
// leerem Nenner (KEINE erfundene 0 %, Muster median() in telnyx-call-latency.mjs).
export function abandonStats(rows, { windowMs = ABANDON_WINDOW_MS } = {}) {
  const answeredOutbound = rows.filter((r) => r.direction === OUTBOUND && r.answeredAt).length;
  const abandoned = rows.filter((r) => isEarlyAbandon(r, windowMs)).length;
  const ratePercent = answeredOutbound === 0 ? null : (abandoned / answeredOutbound) * PERCENT;
  return { answeredOutbound, abandoned, ratePercent };
}

// snake_case (DB-Zeile) -> die vier Feldnamen der reinen Funktion (EINE Quelle, G5).
function toRow(r) {
  return {
    direction: r.direction,
    answeredAt: r.answered_at,
    endedAt: r.ended_at,
    callerTurns: r.caller_turns,
  };
}

function failClosed(reason) {
  console.error(`Grund: ${reason}`);
  console.error("Aufruf: node scripts/call-abandon-rate.mjs --since <ISO-Zeitstempel>");
  process.exit(1);
}

function parseSinceArg(argv) {
  const idx = argv.indexOf(SINCE_FLAG);
  return idx === -1 ? null : (argv[idx + 1] ?? null);
}

async function main() {
  if (!pgBackendActive()) failClosed("nur im pg-Backend (STORE_BACKEND=pg) auswertbar");
  const since = parseSinceArg(process.argv);
  if (!since) failClosed("--since <ISO-Zeitstempel> ist Pflicht (rueckwirkend nicht erhebbar)");

  const rows = await readAcrossTenants((client) =>
    client
      .query(
        `SELECT direction, answered_at, ended_at, caller_turns
           FROM call
          WHERE direction = $1 AND answered_at IS NOT NULL AND started_at >= $2`,
        [OUTBOUND, since],
      )
      .then((r) => r.rows.map(toRow)),
  );
  const stats = abandonStats(rows);
  console.log(`beantwortete Outbound-Calls: ${stats.answeredOutbound}`);
  console.log(`davon Abbruch (<15s, 0 Anrufer-Turns): ${stats.abandoned}`);
  console.log(`Quote: ${stats.ratePercent === null ? "-" : stats.ratePercent.toFixed(1) + " %"}`);
}

// Nur als Skript ausfuehren, NICHT beim Import (Muster telnyx-call-latency.mjs).
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => failClosed(err.message));
