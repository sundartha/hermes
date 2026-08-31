#!/usr/bin/env node
// KV2-7, Phasenschnitt-Nachlauf (tasks/kostenv2/spec-kv2-7.md): oeffnet jeden
// el_convai_sip-Anruf wieder, der im Fenster KV2-5..KV2-7 faelschlich zugelatcht wurde
// (telnyx_sip-Beleg vorhanden, keine elevenlabs_convai-Zeile). EINMALIGER Migrations-
// Lauf, Teil des KV2-7-Deploys, KEIN Dauerbetrieb - nicht in den Boot verdrahtet.
// Dry-Run per Default, idempotent (zweiter Lauf = 0 Treffer). Funktioniert fuer beide
// Backends (STORE_BACKEND json|pg) ueber die Store-Fassade (Muster bootstrap-tenant.js).
// Aufruf: node scripts/kv2-7-nachlauf-phasenschnitt.js [--apply]
import * as store from "../src/store.js";
import { oeffneGelatchteElAnrufe } from "../src/billing/nachlauf-phasenschnitt.js";

const apply = process.argv.includes("--apply");

const report = oeffneGelatchteElAnrufe({ store, apply });
if (apply) await store.save(); // PFLICHT: pg-Flush abwarten (Muster bootstrap-tenant.js)

// Operator-Report: Call-IDs + Grund, PII-frei (keine Rufnummern, keine Betraege).
console.log(
  `[kv2-7-nachlauf] mode=${apply ? "APPLY" : "DRY-RUN"} scanned=${report.scanned} ` +
    `treffer=${report.treffer.length}`,
);
for (const treffer of report.treffer) console.log(`  geoeffnet ${treffer.id}`);
process.exit(0);
