#!/usr/bin/env node
// IP1: zieht Bestands-Begruessungen auf die korrigierte DE-Schreibweise nach ("fuer" -> "für").
// Idempotent, Trockenlauf ist Default (--apply schreibt). Backend-neutral ueber die Store-
// Fassade (json wie pg), KEIN rohes SQL, KEINE Boot-Verdrahtung (IP1 NICHT-Scope; die
// Boot-Migration daneben, store/greeting-notice-migration.js, ergaenzt den PFLICHTSATZ und
// bleibt unangetastet).
//
// Der Lauf ist Hygiene, kein Blocker: greetingForLanguage hebt eine nicht nachgezogene
// Fassung schon zur Laufzeit (i18n/greeting-catalog.js), der gesprochene Satz ist also
// auch VOR diesem Lauf korrekt. BETRIEBSHINWEIS: der pg-Store haelt seinen Spiegel im
// Speicher - laeuft dieses Skript gegen die Prod-DB, WAEHREND der Server laeuft,
// ueberschreibt der naechste Voll-Flush des Servers die Zeile wieder mit seinem alten
// Spiegelwert. Nach einem Deploy/Neustart ist der Spiegel frisch. Also: nach einem Deploy
// fahren, nicht mitten im Betrieb.
// Aufruf: node scripts/greeting-orthografie-nachziehen.mjs [--apply]
import * as store from "../src/store.js";
import { greetingWithCurrentOrthography } from "../src/i18n/greeting-catalog.js";

const apply = process.argv.includes("--apply");

// Rein: liest den Spiegel, mutiert nichts. Nicht-String bleibt UNBERUEHRT - eine
// Migration darf keinen Fehlerpfad ueberkleben (Muster backfillGreetingNotices).
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

// Operator-Report: tenantId ja, Begruessungs-WERTE nein (Muster backfill-plan-profiles).
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

// Schreibweg = der regulaere Settings-Schreibweg der Fassade (FIELD_GUARDS/hasInboundNotice,
// changed-Keys, json wie pg), NIE eine rohe Spiegel-Mutation.
for (const eintrag of treffer) store.updateSettings(eintrag.tenantId, { greeting: eintrag.next });
await store.save(); // PFLICHT: pg-Flush abwarten (Muster seed-owner-number/unlock-tenant)
console.log(
  `[greeting-orthografie] APPLY: ${treffer.length} Begruessung(en) nachgezogen (idempotent).`,
);
// Die Fassade gibt ihren pg-Pool nicht heraus -> expliziter Exit (Muster unlock-tenant).
process.exit(0);
