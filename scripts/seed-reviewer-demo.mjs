#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  REVIEWER_SEED_CALLS,
  applyReviewerSeedAndPersist,
  countSeedCallsInsideCostWindow,
  reviewerSeedEndedAtIso,
} from "./lib/reviewer-demo-seed.mjs";
import { KYC_OUTBOUND_MIN } from "../src/store/defaults.js";

const EXIT_ABORT = 1;
const PG_BACKEND = "pg";
const PREFIX = "[seed-reviewer-demo]";
const USAGE =
  "Aufruf: node scripts/seed-reviewer-demo.mjs [--apply --tenant <ID> [--dienst-gestoppt]]\n" +
  "Ohne --apply: Trockenlauf, es wird nichts geschrieben.";
const PG_ABORT =
  "Abbruch: STORE_BACKEND=pg verlangt --dienst-gestoppt. Den Dienst VOR dem Lauf stoppen und " +
  "danach starten - der pg-Flush schreibt ALLE Mandanten zurueck und loescht fehlende Zeilen; " +
  "bei laufendem Dienst gingen die Seed-Zeilen verloren oder dessen Schreibungen (auch " +
  "Nutzungs- und Budget-Zaehler) wuerden ueberschrieben.";

function abort(message) {
  console.error(`${PREFIX} ${message}`);
  process.exit(EXIT_ABORT);
}

async function orAbort(action) {
  try {
    return await action();
  } catch (err) {
    return abort(`Abbruch: ${err.message || err.code || String(err)}`);
  }
}

function readOptions() {
  try {
    return parseArgs({
      options: {
        apply: { type: "boolean", default: false },
        tenant: { type: "string" },
        "dienst-gestoppt": { type: "boolean", default: false },
      },
    }).values;
  } catch (err) {
    return abort(`${err.message}\n${USAGE}`);
  }
}

function printDryRun() {
  for (const entry of REVIEWER_SEED_CALLS) {
    console.log(`${PREFIX} Anruf eingehend von ${entry.from}: ${entry.summary}`);
    for (const text of entry.actionItems) console.log(`${PREFIX}   Action Item: ${text}`);
  }
  console.log(`${PREFIX} Trockenlauf - nichts geschrieben. Schreiben mit --apply --tenant <ID>.`);
}

function warnIfNotSubscriber(store, tenantId) {
  if (store.tenantActiveSubscriber(tenantId, KYC_OUTBOUND_MIN)) return;
  console.warn(
    `${PREFIX} Hinweis: Outbound bleibt gesperrt, bis Abo und Verifikation echt bestehen.`,
  );
}

function warnIfInsideCostWindow(store, tenantId, endedAtIso) {
  const inside = countSeedCallsInsideCostWindow(store, tenantId, endedAtIso);
  if (inside === 0) return;
  console.warn(
    `${PREFIX} Hinweis: ${inside} vorhandene Seed-Anrufe liegen in den Fenstern der ` +
      "Kosten-Ueberwachung (Fenster seit dem ersten Lauf vergroessert?) - moeglicher " +
      "Fehlalarm. Das Skript datiert vorhandene Anrufe nicht um.",
  );
}

async function seedEndedAtIso(billing) {
  const { PROVIDER_COST_RECORD_WINDOW_MS } = await import("../src/billing/cost-truing.js");
  return reviewerSeedEndedAtIso({
    nowMs: Date.now(),
    belegFensterMs: PROVIDER_COST_RECORD_WINDOW_MS,
    heartbeatFensterH: billing.kostenHeartbeatFensterH,
  });
}

const NOTHING_TO_CLOSE = async () => {};

async function openStore({ storeBackend, databaseUrl }) {
  if (storeBackend !== PG_BACKEND) {
    return { store: await import("../src/store.js"), close: NOTHING_TO_CLOSE };
  }
  const { expectedSchemaColumns, openPgStoreWithoutMigration } =
    await import("./lib/pg-schema-abgleich.mjs");
  const { createPgPoolRunner } = await import("../src/store/pg-runner.js");
  const expected = await expectedSchemaColumns();
  const { runner, close } = await createPgPoolRunner(databaseUrl);
  return { store: await openPgStoreWithoutMigration(runner, expected), close };
}

async function applySeed(store, tenantId, billing) {
  const endedAtIso = await seedEndedAtIso(billing);
  const counts = await orAbort(() => applyReviewerSeedAndPersist(store, tenantId, endedAtIso));
  warnIfNotSubscriber(store, tenantId);
  warnIfInsideCostWindow(store, tenantId, endedAtIso);
  const { callsCreated, itemsCreated } = counts;
  if (callsCreated === 0 && itemsCreated === 0) console.log(`${PREFIX} nichts zu tun.`);
  else console.log(`${PREFIX} angelegt: ${callsCreated} Anrufe, ${itemsCreated} Action Items.`);
  return counts;
}

async function main() {
  const options = readOptions();
  if (!options.apply) return printDryRun();
  if (!options.tenant) return abort(`--apply verlangt --tenant <ID>.\n${USAGE}`);
  const { config } = await import("../src/config.js");
  if (config.store.storeBackend === PG_BACKEND && !options["dienst-gestoppt"])
    return abort(PG_ABORT);
  const { store, close } = await orAbort(() => openStore(config.store));
  await applySeed(store, options.tenant, config.billing);
  return close();
}

await main();
