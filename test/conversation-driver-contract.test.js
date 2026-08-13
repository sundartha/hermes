// Testet die wiederverwendbare Vertragspruefung (./conversation-driver-contract.js) gegen
// die Attrappe fuer src/conversation/conversation-ports.js.
//
// GEPINNT: Modulpfad und Fabrik der Attrappe:
//   Pfad:    test/fixtures/mock-conversation-driver.js
//   Fabrik:  export function makeMockConversationDriver({ callbacks }) { ... }
// callbacks ist eine ConversationCallbacks-Implementierung (conversation-ports.js), hier
// von der Vertragspruefung selbst injiziert. Die Fabrik liefert ein ConversationControl-
// Objekt ({startConversation, endConversation}). Das Szenario steuert sich ALLEIN ueber
// den exakten Wert von params.objective - die Werte + ihr vorgeschriebenes Verhalten
// stehen in MOCK_OBJECTIVE (conversation-driver-contract.js), dort ausfuehrlich kommentiert.
//
// Testnamen tragen bewusst KEINE Katalog-ID (GAP-/PROMPT-/...) am Anfang, sonst landet die
// Datei im Gates-Lauf statt im Regressionslauf (Lehre catalog-id-prefix-misroutes-tests).
import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeCall } from "../src/claude.js";
import {
  baseStartParams,
  checkConversationDriverContract,
  makeCallbackSpy,
  MOCK_OBJECTIVE,
  waitUntil,
} from "./conversation-driver-contract.js";
import { makeMockConversationDriver } from "./fixtures/mock-conversation-driver.js";

checkConversationDriverContract(makeMockConversationDriver);

// Der Entwurf (conversation-ports.js) laesst offen, ob ConversationOutcome.summary mit
// unserer eigenen Zusammenfassung kollidiert. Entschieden: summarizeCall (claude.js)
// bleibt die EINZIGE Quelle unserer eigenen Gespraechszusammenfassung und laeuft SPAETER
// auf dem eigenen Transkript. Was ueber diesen Port hereinkommt, ist reiner Anbieter-Text
// (ConversationOutcome.summary) - eine Textangabe, kein Aufruf, keine Ersetzung. Bricht
// dieser Test, wurde summarizeCall waehrend der Verdrahtung entfernt, umbenannt oder mit
// dem Anbieter-Text zusammengefuehrt - genau der stille Wechsel, den dieser Testfall
// verhindern soll.
test("Vertrag: die Anbieter-Zusammenfassung aus onOutcomeDelivered ersetzt unsere eigene summarizeCall nicht", async () => {
  assert.equal(typeof summarizeCall, "function", "summarizeCall bleibt bestehen und aufrufbar");

  const callId = "cdc-summary-pin";
  const spy = makeCallbackSpy();
  const driver = makeMockConversationDriver({ callbacks: spy.callbacks });
  await driver.startConversation(baseStartParams(callId, MOCK_OBJECTIVE.OUTCOME));
  await waitUntil(() => spy.outcomes.length > 0);

  const outcome = spy.outcomes[0];
  assert.equal(typeof outcome.summary, "string", "die Anbieter-Zusammenfassung ist reiner Text");
  assert.notEqual(
    outcome.summary,
    summarizeCall,
    "Text und Funktion sind zwei getrennte Werte - der Port liefert niemals unsere Funktion zurueck",
  );
});
