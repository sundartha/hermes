#!/usr/bin/env node
// Legt die Beispieldaten fuer das Reviewer-Konto der App-Einreichung an: drei beendete
// Inbound-Anrufe mit Zusammenfassung und offenen Action Items (Inhalt und Begruendung in
// scripts/lib/reviewer-demo-seed.mjs). Die Daten zeigen die Werkzeuge list_calls und
// list_action_items mit Inhalt, statt mit einer leeren Liste.
//
// VERBOTEN (und deshalb nicht moeglich): Abo, Verifikation (KYC), Mandanten-Status, Profil,
// Nummer, Budget oder Nutzung setzen; einen Mandanten anlegen; den Betreiber-Mandanten
// beschreiben. Das Reviewer-Konto ist ein regulaerer Kunde mit echtem Abo und echter
// Verifikation und denselben Sicherungen wie jeder Kunde. Der Mandant muss vorher durch
// einen Browser-Login in der Web-App entstanden sein.
//
// Ablauf:
//   node scripts/seed-reviewer-demo.mjs                                  Trockenlauf (Default):
//                                                                         zeigt die Datensaetze,
//                                                                         laedt keinen Store,
//                                                                         schreibt nichts
//   node scripts/seed-reviewer-demo.mjs --apply --tenant <ID>            json-Store schreiben
//   STORE_BACKEND=pg DATABASE_URL=... \
//     node scripts/seed-reviewer-demo.mjs --apply --tenant <ID> --dienst-gestoppt
//
// pg nur bei GESTOPPTEM Dienst: Dienst stoppen -> Skript -> Dienst starten. Grund: der
// pg-Store haelt den Zustand im Speicher und schreibt beim Flush in EINER Transaktion ALLE
// Mandanten zurueck und loescht dabei fehlende Zeilen (src/store/pg.js flush). Laeuft der
// Dienst waehrend des Seeds, loescht sein naechster Flush die Seed-Zeilen, und der Flush des
// Skripts ueberschreibt, was der Dienst dazwischen geschrieben hat (auch Nutzungs- und
// Budget-Zaehler). "Neustart danach" reicht deshalb nicht.
//
// Idempotent: ein zweiter Lauf legt nichts an ("nichts zu tun"). Beendete Anrufe fallen nach
// der normalen Aufbewahrungsfrist weg; vor der Einreichung und bei langem Review erneut laufen
// lassen. Die Ausgabe nennt nur Zaehler - nie Mandanten-Kennung, Nummern oder Texte des Stores.
import { parseArgs } from "node:util";
import { REVIEWER_SEED_CALLS, applyReviewerSeed } from "./lib/reviewer-demo-seed.mjs";
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

// Nur lesend: meldet, dass Outbound fuer diesen Mandanten gesperrt bleibt. Setzt NICHTS.
function warnIfNotSubscriber(store, tenantId) {
  if (store.tenantActiveSubscriber(tenantId, KYC_OUTBOUND_MIN)) return;
  console.warn(`${PREFIX} Hinweis: Outbound bleibt gesperrt, bis Abo und Verifikation echt bestehen.`);
}

async function applySeed(tenantId) {
  // Dynamischer Import erst hier: der Trockenlauf laedt den Store nie, und unter pg laeuft der
  // Store-Import (init samt DDL) erst NACH der Dienst-gestoppt-Pruefung.
  const store = await import("../src/store.js");
  let counts;
  try {
    counts = applyReviewerSeed(store, tenantId);
  } catch (err) {
    return abort(`Abbruch: ${err.message}`);
  }
  await store.save(); // PFLICHT: pg-Flush abwarten (json = No-op nach internem save)
  warnIfNotSubscriber(store, tenantId);
  const { callsCreated, itemsCreated } = counts;
  if (callsCreated === 0 && itemsCreated === 0) console.log(`${PREFIX} nichts zu tun.`);
  else console.log(`${PREFIX} angelegt: ${callsCreated} Anrufe, ${itemsCreated} Action Items.`);
  return counts;
}

async function main() {
  const options = readOptions();
  if (!options.apply) return printDryRun();
  if (!options.tenant) return abort(`--apply verlangt --tenant <ID>.\n${USAGE}`);
  // Backend aus der zentralen Konfiguration; src/config.js importiert den Store nicht.
  const { config } = await import("../src/config.js");
  if (config.store.storeBackend === PG_BACKEND && !options["dienst-gestoppt"]) return abort(PG_ABORT);
  return applySeed(options.tenant);
}

await main();
