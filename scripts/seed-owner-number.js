#!/usr/bin/env node
import * as store from "../src/store.js";
import { BOOTSTRAP_TENANT_ID } from "../src/begriffe/mandant.js";
import { PROVIDER } from "../src/begriffe/nummern-vergabe.js";

const ERSETZT_OPTION = "--ersetzt";
const [, , e164, provider, option, alteE164] = process.argv;
const validProviders = Object.values(PROVIDER);
const mitErsatz = option === ERSETZT_OPTION;
const aufrufOk = e164 && validProviders.includes(provider) && (option === undefined || (mitErsatz && alteE164));

if (!aufrufOk) {
  console.error(`Aufruf: node scripts/seed-owner-number.js <e164> <${validProviders.join("|")}> [${ERSETZT_OPTION} <alte-e164>]`);
  console.error("Traegt eine bereits gekaufte Owner-Nummer als aktive Store-Nummer ein.");
  console.error(`Mit ${ERSETZT_OPTION} waehlt Hermes ab jetzt die neue statt der alten Nummer als Absender.`);
  process.exit(1);
}

await store.oeffneSpeicher();
if (mitErsatz) {
  const ergebnis = store.ersatzNummerEintragen(store.load(), { e164, alteE164, tenantId: BOOTSTRAP_TENANT_ID, provider });
  if (!ergebnis.ok) {
    console.error(`[seed-owner-number] Abbruch (${ergebnis.grund}): ${alteE164} ersetzen mit ${e164} nicht moeglich, nichts geschrieben.`);
    process.exit(1);
  }
  await store.save();
} else {
  store.seedBootstrapNumber(e164, BOOTSTRAP_TENANT_ID, provider);
  await store.save();
}
console.log(`[seed-owner-number] Owner-Nummer (${provider}) eingetragen/bestaetigt (idempotent).`);
