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
// PFLICHT DES BETREIBERS vor dem ersten Login: das Reviewer-Konto beim Login-Anbieter mit
// einer E-Mail anlegen, die in Hermes noch KEINEM Konto zugeordnet ist. Der Web-Login fuehrt
// Konten ueber die E-Mail zusammen (src/web-auth.js resolveOrCreateTenant: bekannte E-Mail ->
// bestehender Mandant). Mit einer schon benutzten E-Mail landete der Reviewer im Mandanten
// dieses Kontos - samt dessen echten Anrufen und Transkripten -, und dieses Skript schriebe
// seine Beispieldaten dorthin (es verweigert nur den Betreiber-Mandanten).
//
// Kosten-Ueberwachung: die Seed-Anrufe enden VOR dem Beleg- und Herzschlag-Fenster der
// Kosten-Ueberwachung (Begruendung in scripts/lib/reviewer-demo-seed.mjs) und loesen deshalb
// keinen Kosten-Alarm aus. Folge: sie fallen RETENTION_DAYS nach diesem vordatierten Ende
// weg (mit der Standard-Konfiguration liegt es rund 8 Tage vor dem Lauf) - bei
// RETENTION_DAYS von 8 oder weniger sofort, bei RETENTION_DAYS=0 nie.
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
// STAND (pg gegen Produktion): den Lauf aus genau dem Commit starten, der live deployt ist
// (Checkout auf diesen Commit, `npm ci` - der Schema-Abgleich braucht die
// Entwicklungs-Abhaengigkeit pglite). Das Skript fuehrt KEINE DDL gegen die Zieldatenbank aus:
// unter pg importiert es die Store-Fassade nie (ihr Import migriert, src/store.js) und oeffnet
// den pg-Store ohne Migration. Vor jedem Schreiben gleicht es das Schema der Zieldatenbank mit
// dem Schema ab, das die Migration DIESES Checkouts in einer fluechtigen In-Memory-Datenbank
// erzeugt; eine fehlende Tabelle/Spalte oder eine unbekannte Spalte in einer bekannten Tabelle
// bricht ab, ohne etwas zu schreiben (scripts/lib/pg-schema-abgleich.mjs). Grenze: der Abgleich
// vergleicht nur Namen - einen geaenderten Spaltentyp oder eine geaenderte Flush-Logik bei
// gleichem Schema faengt er nicht. Deshalb bleibt der deployte Commit Pflicht.
//
// pg nur bei GESTOPPTEM Dienst: Dienst stoppen -> Skript -> Dienst starten. Grund: der
// pg-Store haelt den Zustand im Speicher und schreibt beim Flush in EINER Transaktion ALLE
// Mandanten zurueck und loescht dabei fehlende Zeilen (src/store/pg.js flush). Laeuft der
// Dienst waehrend des Seeds, loescht sein naechster Flush die Seed-Zeilen, und der Flush des
// Skripts ueberschreibt, was der Dienst dazwischen geschrieben hat (auch Nutzungs- und
// Budget-Zaehler). "Neustart danach" reicht deshalb nicht.
//
// Idempotent: ein zweiter Lauf legt nichts an ("nichts zu tun"). Die Seed-Anrufe fallen nach
// der Aufbewahrungsfrist (ab ihrem vordatierten Ende) weg; vor der Einreichung und bei langem
// Review erneut laufen lassen. Ein erneuter Lauf legt NUR neu an, was schon weggefallen ist;
// einen vorhandenen Seed-Anruf frischt er nicht auf - weder seine Aufbewahrung noch sein
// endedAt. Wurden Beleg- oder Herzschlag-Fenster der Kosten-Ueberwachung nach dem ersten Lauf
// vergroessert, koennen vorhandene Seed-Anrufe in diese Fenster fallen und einen Fehlalarm
// ausloesen; der Lauf meldet ihre Zahl als Hinweis und aendert sie nicht.
// Die Ausgabe nennt nur Zaehler - nie Mandanten-Kennung, Nummern oder Texte des Stores.
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

// Wartet auf action(); ein Fehler endet als Abbruch (Exit 1) mit der Fehlermeldung. Ein
// Verbindungsfehler traegt je nach Treiberweg nur einen Code (AggregateError ohne Text).
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

// Nur lesend: meldet, dass Outbound fuer diesen Mandanten gesperrt bleibt. Setzt NICHTS.
function warnIfNotSubscriber(store, tenantId) {
  if (store.tenantActiveSubscriber(tenantId, KYC_OUTBOUND_MIN)) return;
  console.warn(
    `${PREFIX} Hinweis: Outbound bleibt gesperrt, bis Abo und Verifikation echt bestehen.`,
  );
}

// Nur lesend: vorhandene Seed-Anrufe in den heutigen Fenstern der Kosten-Ueberwachung melden.
function warnIfInsideCostWindow(store, tenantId, endedAtIso) {
  const inside = countSeedCallsInsideCostWindow(store, tenantId, endedAtIso);
  if (inside === 0) return;
  console.warn(
    `${PREFIX} Hinweis: ${inside} vorhandene Seed-Anrufe liegen in den Fenstern der ` +
      "Kosten-Ueberwachung (Fenster seit dem ersten Lauf vergroessert?) - moeglicher " +
      "Fehlalarm. Das Skript datiert vorhandene Anrufe nicht um.",
  );
}

// Ende-Zeitpunkt der Seed-Anrufe aus denselben Fensterlaengen, die der Kosten-Sweep liest
// (Beleg-Fenster aus cost-truing.js, Herzschlag-Fenster aus der Konfiguration).
async function seedEndedAtIso(billing) {
  const { PROVIDER_COST_RECORD_WINDOW_MS } = await import("../src/billing/cost-truing.js");
  return reviewerSeedEndedAtIso({
    nowMs: Date.now(),
    belegFensterMs: PROVIDER_COST_RECORD_WINDOW_MS,
    heartbeatFensterH: billing.kostenHeartbeatFensterH,
  });
}

const NOTHING_TO_CLOSE = async () => {};

// json: die Store-Fassade (das json-Backend kennt keine DDL). pg: NIE die Fassade - ihr Import
// migriert. Stattdessen der pg-Store ohne Migration; init gleicht vorher das Schema ab und
// bricht bei Abweichung ab, bevor Mandantendaten gelesen oder geschrieben werden.
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
  // Backend aus der zentralen Konfiguration; src/config.js importiert den Store nicht.
  const { config } = await import("../src/config.js");
  if (config.store.storeBackend === PG_BACKEND && !options["dienst-gestoppt"])
    return abort(PG_ABORT);
  // Store erst hier: der Trockenlauf laedt nie einen Store, und unter pg wird die
  // Zieldatenbank erst NACH der Dienst-gestoppt-Pruefung beruehrt.
  const { store, close } = await orAbort(() => openStore(config.store));
  await applySeed(store, options.tenant, config.billing);
  return close();
}

await main();
