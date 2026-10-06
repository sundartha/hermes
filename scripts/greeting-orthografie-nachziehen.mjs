#!/usr/bin/env node
import * as store from "../src/store.js";
import { greetingWithCurrentOrthography } from "../src/i18n/greeting-catalog.js";

const apply = process.argv.includes("--apply");

function mandantenMitAlterSchreibweise(settingsByTenant) {
  const treffer = [];
  for (const [tenantId, settings] of Object.entries(settingsByTenant || {})) {
    const stored = settings?.greeting;
    if (typeof stored !== "string") continue;
    const next = greetingWithCurrentOrthography(stored);
    if (next !== stored) treffer.push({ tenantId, next });
  }
  return treffer;
}

const settingsByTenant = store.load().settings;
const geprueft = Object.keys(settingsByTenant || {}).length;
const treffer = mandantenMitAlterSchreibweise(settingsByTenant);

console.log(
  `[greeting-orthografie] mode=${apply ? "APPLY" : "DRY-RUN"} ` +
    `geprueft=${geprueft} betroffen=${treffer.length}`,
);
for (const eintrag of treffer) console.log(`  nachziehen tenant=${eintrag.tenantId}`);

if (!apply) {
  console.log(
    `[greeting-orthografie] DRY-RUN: --apply wuerde ${treffer.length} Begruessung(en) ` +
      "umschreiben; nichts geschrieben.",
  );
  process.exit(0);
}

for (const eintrag of treffer) store.updateSettings(eintrag.tenantId, { greeting: eintrag.next });
await store.save();
console.log(
  `[greeting-orthografie] APPLY: ${treffer.length} Begruessung(en) nachgezogen (idempotent).`,
);
process.exit(0);
