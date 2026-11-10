import assert from "node:assert/strict";
import test from "node:test";

import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { runOutbound } from "../_outbound-harness.js";

const LEERER_NAME = "   ";
const ERWARTET = Object.freeze({
  de: "Hallo, ich rufe an, um ein kurzes Anliegen zu klären – ich bin Hermes, der KI-Assistent von meinem Auftraggeber, und ich fasse das Gespräch für meinen Auftraggeber zusammen.",
  en: "Hello, I am calling to sort out a small matter with you – I am Hermes, the AI assistant of its owner, and I will summarise this conversation for the person I represent.",
  fr: "Bonjour, j'appelle pour régler une petite demande – je suis Hermes, l'assistant IA de mon mandant, et je résume cette conversation pour mon mandant.",
});

const SEED = { tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: LEERER_NAME }] };

const ENTITAETEN = [
  ["&apos;", "'"],
  ["&amp;", "&"],
];

function ersterSay(xml) {
  const treffer = /<Say[^>]*>([\s\S]*?)<\/Say>/.exec(xml);
  assert.ok(treffer, `kein Say im Dokument: ${xml}`);
  return ENTITAETEN.reduce((text, [von, nach]) => text.replaceAll(von, nach), treffer[1]);
}

for (const [sprache, erwartet] of Object.entries(ERWARTET)) {
  test(`Eroeffnung ${sprache}: ein Auftraggeber ohne Namen ergibt den Ersatzausdruck, nie eine leere Stelle`, async () => {
    const { body } = await runOutbound({ call: { language: sprache, goal: "" }, seed: SEED });
    assert.equal(ersterSay(body), erwartet);
  });
}
