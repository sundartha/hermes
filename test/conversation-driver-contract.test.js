import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeCall } from "../src/claude.js";
import {
  baseStartParams,
  checkConcurrentConsultAnswersMatchByRequestId,
  checkConsultAnswerArrives,
  checkConsultRejectedIsValidOutcome,
  checkConsultRequestCarriesTranscript,
  checkConsultTimeoutIsValidOutcome,
  checkEndConcurrentCallsAreSafe,
  checkEndIsIdempotent,
  checkEndResolvesOpenConsult,
  checkEndsWithoutHeartbeat,
  checkNeverConnectedIsDistinctSignal,
  checkOutcomeClosesConversation,
  checkSequentialConsultAnswersAreCorrectlyPaired,
  checkSilentIndistinguishableFromConducted,
  checkStartFailsCleanly,
  checkStartSucceeds,
  makeCallbackSpy,
  MOCK_OBJECTIVE,
  waitUntil,
} from "./conversation-driver-contract.js";
import { makeMockConversationDriver } from "./fixtures/mock-conversation-driver.js";

test("Vertrag: startConversation liefert bei Erfolg ok:true", () =>
  checkStartSucceeds(makeMockConversationDriver));
test("Vertrag: startConversation scheitert sauber - ok:false mit einem Grund", () =>
  checkStartFailsCleanly(makeMockConversationDriver));
test("Vertrag: ein stummer Start ist am Ergebnis allein nicht von einem gefuehrten Gespraech zu unterscheiden", () =>
  checkSilentIndistinguishableFromConducted(makeMockConversationDriver));
test("Vertrag: endConversation ist idempotent - ein zweiter, nacheinander gestellter Aufruf ist kein Fehler", () =>
  checkEndIsIdempotent(makeMockConversationDriver));
test("Vertrag: gleichzeitige endConversation-Aufrufe auf demselben Anruf sind sicher (Ueberschneidung, s. EndConversationParams)", () =>
  checkEndConcurrentCallsAreSafe(makeMockConversationDriver));
test("Vertrag: eine Rueckfrage haelt offen, und die Antwort kommt im Gespraech an", () =>
  checkConsultAnswerArrives(makeMockConversationDriver));
test("Vertrag: eine unbeantwortete Rueckfrage (Zeitablauf) ist ein gueltiger Ausgang, kein Absturz", () =>
  checkConsultTimeoutIsValidOutcome(makeMockConversationDriver));
test("Vertrag: eine vom Gate/der Sanitisierung abgelehnte Rueckfrage ist ein EIGENER Ausgang, kein Zeitablauf (Befund 5, G26)", () =>
  checkConsultRejectedIsValidOutcome(makeMockConversationDriver));
test("Vertrag: zwei NACHEINANDER gestellte Rueckfragen tragen unterscheidbare Kennungen, keine ueberschreibt die andere", () =>
  checkSequentialConsultAnswersAreCorrectlyPaired(makeMockConversationDriver));
test("Vertrag: zwei GLEICHZEITIG offene, AUSSER DER REIHE beantwortete Rueckfragen werden ueber requestId zugeordnet, nicht ueber Ankunftsreihenfolge (Befund 1, Blocker)", () =>
  checkConcurrentConsultAnswersMatchByRequestId(makeMockConversationDriver));
test("Vertrag: die Rueckfrage-Anfrage liefert den bisherigen Gespraechsverlauf mit (Befund 4, Blocker)", () =>
  checkConsultRequestCarriesTranscript(makeMockConversationDriver));
test("Vertrag: 'nie verbunden' ist ein eigenes Signal, getrennt von einem gefuehrten, aber ergebnislosen Gespraech (Befund 2, Blocker)", () =>
  checkNeverConnectedIsDistinctSignal(makeMockConversationDriver));
test("Vertrag: endConversation schliesst eine offen haengende Rueckfrage als unbeantwortet ab, mit erkennbarem Grund (Befund 3, Blocker)", () =>
  checkEndResolvesOpenConsult(makeMockConversationDriver));
test("Vertrag: ein geliefertes Ergebnis schliesst das Gespraech ab", () =>
  checkOutcomeClosesConversation(makeMockConversationDriver));
test("Vertrag: verstummt das Laufwerk, beendet Hermes selbst mit Grund - der Port hat dafuer bewusst keine Lebenszeichen-Methode", () =>
  checkEndsWithoutHeartbeat(makeMockConversationDriver));

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
