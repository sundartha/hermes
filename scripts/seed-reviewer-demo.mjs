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
  applyReviewerSeed,
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

async function applySeed(tenantId, billing) {
  // Dynamischer Import erst hier: der Trockenlauf laedt den Store nie, und unter pg laeuft der
  // Store-Import (init samt DDL) erst NACH der Dienst-gestoppt-Pruefung.
  const store = await import("../src/store.js");
  const endedAtIso = await seedEndedAtIso(billing);
  let counts;
  try {
    counts = applyReviewerSeed(store, tenantId, endedAtIso);
  } catch (err) {
    return abort(`Abbruch: ${err.message}`);
  }
  await store.save(); // PFLICHT: pg-Flush abwarten (json = No-op nach internem save)
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
  return applySeed(options.tenant, config.billing);
}

await main();
