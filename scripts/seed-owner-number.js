#!/usr/bin/env node
import * as store from "../src/store.js";
import { BOOTSTRAP_TENANT_ID } from "../src/begriffe/mandant.ts";
import { PROVIDER } from "../src/begriffe/nummern-vergabe.ts";

const ERSETZT_OPTION = "--ersetzt";
const RUECKBAU_OPTION = "--rueckbau";
const [, , e164, provider, option, alteE164] = process.argv;
const validProviders = Object.values(PROVIDER);
const mitErsatz = option === ERSETZT_OPTION;
const mitRueckbau = option === RUECKBAU_OPTION;
const aufrufOk = e164 && validProviders.includes(provider) && (option === undefined || ((mitErsatz || mitRueckbau) && alteE164));

if (!aufrufOk) {
  console.error(`Aufruf: node scripts/seed-owner-number.js <e164> <${validProviders.join("|")}> [${ERSETZT_OPTION}|${RUECKBAU_OPTION} <alte-e164>]`);
  console.error("Traegt eine bereits gekaufte Owner-Nummer als aktive Store-Nummer ein.");
  console.error(`Mit ${ERSETZT_OPTION} waehlt Hermes ab jetzt die neue statt der alten Nummer als Absender.`);
  console.error(`Mit ${RUECKBAU_OPTION} waehlt Hermes wieder die alte Nummer; die neue bleibt eingetragen.`);
  process.exit(1);
}

await store.oeffneSpeicher();
if (mitErsatz || mitRueckbau) {
  const aufgabe = mitErsatz ? store.ersatzNummerEintragen : store.ersatzSpurEntfernen;
  const ergebnis = aufgabe(store.load(), { e164, alteE164, tenantId: BOOTSTRAP_TENANT_ID, provider });
  if (!ergebnis.ok) {
    console.error(`[seed-owner-number] Abbruch (${ergebnis.grund}): ${option} ${alteE164} mit ${e164} nicht moeglich, nichts geschrieben.`);
    process.exit(1);
  }
  if (ergebnis.geaendert !== false) await store.save();
  if (ergebnis.auftragId) await store.nummernSql()?.auftragEntfernen({ tenantId: BOOTSTRAP_TENANT_ID, jobId: ergebnis.auftragId });
  if (mitRueckbau) {
    console.log(`[seed-owner-number] Rueckbau ok: ${alteE164} ist wieder die gewaehlte Absendernummer.`);
    process.exit(0);
  }
} else {
  store.seedBootstrapNumber(e164, BOOTSTRAP_TENANT_ID, provider);
  await store.save();
}
console.log(`[seed-owner-number] Owner-Nummer (${provider}) eingetragen/bestaetigt (idempotent).`);
