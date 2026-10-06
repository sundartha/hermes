#!/usr/bin/env node
import { fileURLToPath } from "url";
import { pgBackendActive, readAcrossTenants } from "./prod-read.mjs";

const OUTBOUND = "outbound";
export const ABANDON_WINDOW_MS = 15_000;
const PERCENT = 100;
const SINCE_FLAG = "--since";

function isEarlyAbandon(row, windowMs) {
  if (row.direction !== OUTBOUND) return false;
  if (!row.answeredAt || !row.endedAt) return false;
  if (row.callerTurns !== 0) return false;
  const answered = Date.parse(row.answeredAt);
  const ended = Date.parse(row.endedAt);
  if (Number.isNaN(answered) || Number.isNaN(ended)) return false;
  return ended - answered < windowMs;
}

export function abandonStats(rows, { windowMs = ABANDON_WINDOW_MS } = {}) {
  const answeredOutbound = rows.filter((r) => r.direction === OUTBOUND && r.answeredAt).length;
  const abandoned = rows.filter((r) => isEarlyAbandon(r, windowMs)).length;
  const ratePercent = answeredOutbound === 0 ? null : (abandoned / answeredOutbound) * PERCENT;
  return { answeredOutbound, abandoned, ratePercent };
}

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

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => failClosed(err.message));
