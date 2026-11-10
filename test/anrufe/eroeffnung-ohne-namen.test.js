import assert from "node:assert/strict";
import { before, test } from "node:test";

import { seedCall, seedState, tempDataDir } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/store/defaults.js";

const LEERER_NAME = "   ";
const ERWARTET = Object.freeze({
  de: "Hallo, ich rufe an, um ein kurzes Anliegen zu klären – ich bin Hermes, der KI-Assistent von meinem Auftraggeber, und ich fasse das Gespräch für meinen Auftraggeber zusammen.",
  en: "Hello, I am calling to sort out a small matter with you – I am Hermes, the AI assistant of its owner, and I will summarise this conversation for the person I represent.",
  fr: "Bonjour, j'appelle pour régler une petite demande – je suis Hermes, l'assistant IA de mon mandant, et je résume cette conversation pour mon mandant.",
});

let openingText;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({ calls: [], tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: LEERER_NAME }] }),
  );
  ({ openingText } = await import("../../src/claude.js"));
});

for (const [sprache, erwartet] of Object.entries(ERWARTET)) {
  test(`Eroeffnung ${sprache}: ein Auftraggeber ohne Namen ergibt den Ersatzausdruck, nie eine leere Stelle`, () => {
    const call = seedCall({ tenantId: BOOTSTRAP_TENANT_ID, direction: "outbound", language: sprache, goal: "" });
    assert.equal(openingText(call), erwartet);
  });
}
