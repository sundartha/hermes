#!/usr/bin/env node
// KV2-9, zweiter einmaliger Nachlauf (tasks/PLAN-KOSTEN-V2.md, Phase KV2-9): oeffnet
// jeden el_convai_sip-Anruf wieder, den KV2-8 zwangs-gesettelt hat (Endzustand
// unvollstaendig_final, per Frist geschlossen), obwohl seine EL-Belegzeile noch
// 'vorlaeufig' war und seine Belegsumme unter der Schaetzung liegt. EINMALIGER
// Migrations-Lauf, Teil des KV2-9-Deploys, KEIN Dauerbetrieb - nicht in den Boot
// verdrahtet. Dry-Run per Default, idempotent (zweiter Lauf = 0 Treffer). Muster
// woertlich scripts/kv2-7-nachlauf-phasenschnitt.js.
// Aufruf: node scripts/kv2-9-nachlauf-zwangssettlement.js [--apply]
import * as store from "../src/store.js";
import { config } from "../src/config.js";
import { faelligkeitsfensterMs } from "../src/billing/kosten-abschluss.js";
import { oeffneZwangsGesettelteElAnrufe } from "../src/billing/nachlauf-phasenschnitt.js";

const apply = process.argv.includes("--apply");
const report = oeffneZwangsGesettelteElAnrufe({
  store, apply, nowMs: Date.now(),
  deadlineMs: faelligkeitsfensterMs(config.billing),
  providerToBucketRateMicro: config.billing.providerToBucketRateMicro,
});
if (apply) await store.save(); // PFLICHT: pg-Flush abwarten (Muster bootstrap-tenant.js)

// Operator-Report: Call-IDs + Grund, PII-frei (keine Rufnummern, keine Betraege).
console.log(
  `[kv2-9-nachlauf] mode=${apply ? "APPLY" : "DRY-RUN"} scanned=${report.scanned} ` +
    `treffer=${report.treffer.length}`,
);
for (const treffer of report.treffer) console.log(`  geoeffnet ${treffer.id}`);
process.exit(0);
