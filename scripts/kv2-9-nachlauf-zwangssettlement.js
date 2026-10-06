#!/usr/bin/env node
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
if (apply) await store.save();

console.log(
  `[kv2-9-nachlauf] mode=${apply ? "APPLY" : "DRY-RUN"} scanned=${report.scanned} ` +
    `treffer=${report.treffer.length}`,
);
for (const treffer of report.treffer) console.log(`  geoeffnet ${treffer.id}`);
process.exit(0);
