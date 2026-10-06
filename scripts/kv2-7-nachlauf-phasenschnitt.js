#!/usr/bin/env node
import * as store from "../src/store.js";
import { oeffneGelatchteElAnrufe } from "../src/billing/nachlauf-phasenschnitt.js";

const apply = process.argv.includes("--apply");

const report = oeffneGelatchteElAnrufe({ store, apply });
if (apply) await store.save();

console.log(
  `[kv2-7-nachlauf] mode=${apply ? "APPLY" : "DRY-RUN"} scanned=${report.scanned} ` +
    `treffer=${report.treffer.length}`,
);
for (const treffer of report.treffer) console.log(`  geoeffnet ${treffer.id}`);
process.exit(0);
