import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeCall } from "../src/claude.js";
import {
  baseStartParams,
  concurrentConsultAnswersMatchByRequestIdCase,
  consultAnswerArrivesCase,
  consultRejectedIsValidOutcomeCase,
  consultRequestCarriesTranscriptCase,
  consultTimeoutIsValidOutcomeCase,
  endConcurrentCallsAreSafeCase,
  endIsIdempotentCase,
  endResolvesOpenConsultCase,
  endsWithoutHeartbeatCase,
  makeCallbackSpy,
  MOCK_OBJECTIVE,
  neverConnectedIsDistinctSignalCase,
  outcomeClosesConversationCase,
  sequentialConsultAnswersAreCorrectlyPairedCase,
  silentIndistinguishableFromConductedCase,
  startFailsCleanlyCase,
  startSucceedsCase,
  waitUntil,
} from "./conversation-driver-contract.js";
import { makeMockConversationDriver } from "./fixtures/mock-conversation-driver.js";

test("Vertrag: startConversation liefert bei Erfolg ok:true", () =>
  startSucceedsCase(makeMockConversationDriver));
test("Vertrag: startConversation scheitert sauber - ok:false mit einem Grund", () =>
  startFailsCleanlyCase(makeMockConversationDriver));
test("Vertrag: ein stummer Start ist am Ergebnis allein nicht von einem gefuehrten Gespraech zu unterscheiden", () =>
  silentIndistinguishableFromConductedCase(makeMockConversationDriver));
test("Vertrag: endConversation ist idempotent - ein zweiter, nacheinander gestellter Aufruf ist kein Fehler", () =>
  endIsIdempotentCase(makeMockConversationDriver));
test("Vertrag: gleichzeitige endConversation-Aufrufe auf demselben Anruf sind sicher (Ueberschneidung, s. EndConversationParams)", () =>
  endConcurrentCallsAreSafeCase(makeMockConversationDriver));
test("Vertrag: eine Rueckfrage haelt offen, und die Antwort kommt im Gespraech an", () =>
  consultAnswerArrivesCase(makeMockConversationDriver));
test("Vertrag: eine unbeantwortete Rueckfrage (Zeitablauf) ist ein gueltiger Ausgang, kein Absturz", () =>
  consultTimeoutIsValidOutcomeCase(makeMockConversationDriver));
test("Vertrag: eine vom Gate/der Sanitisierung abgelehnte Rueckfrage ist ein EIGENER Ausgang, kein Zeitablauf (Befund 5, G26)", () =>
  consultRejectedIsValidOutcomeCase(makeMockConversationDriver));
test("Vertrag: zwei NACHEINANDER gestellte Rueckfragen tragen unterscheidbare Kennungen, keine ueberschreibt die andere", () =>
  sequentialConsultAnswersAreCorrectlyPairedCase(makeMockConversationDriver));
test("Vertrag: zwei GLEICHZEITIG offene, AUSSER DER REIHE beantwortete Rueckfragen werden ueber requestId zugeordnet, nicht ueber Ankunftsreihenfolge (Befund 1, Blocker)", () =>
  concurrentConsultAnswersMatchByRequestIdCase(makeMockConversationDriver));
test("Vertrag: die Rueckfrage-Anfrage liefert den bisherigen Gespraechsverlauf mit (Befund 4, Blocker)", () =>
  consultRequestCarriesTranscriptCase(makeMockConversationDriver));
test("Vertrag: 'nie verbunden' ist ein eigenes Signal, getrennt von einem gefuehrten, aber ergebnislosen Gespraech (Befund 2, Blocker)", () =>
  neverConnectedIsDistinctSignalCase(makeMockConversationDriver));
test("Vertrag: endConversation schliesst eine offen haengende Rueckfrage als unbeantwortet ab, mit erkennbarem Grund (Befund 3, Blocker)", () =>
  endResolvesOpenConsultCase(makeMockConversationDriver));
test("Vertrag: ein geliefertes Ergebnis schliesst das Gespraech ab", () =>
  outcomeClosesConversationCase(makeMockConversationDriver));
test("Vertrag: verstummt das Laufwerk, beendet Hermes selbst mit Grund - der Port hat dafuer bewusst keine Lebenszeichen-Methode", () =>
  endsWithoutHeartbeatCase(makeMockConversationDriver));

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
