import assert from "node:assert/strict";
import { test } from "node:test";

const DISCLOSURE_SENTENCE =
  "Dieser Anruf wird automatisiert im Auftrag von Testkonto gefuehrt und aufgezeichnet.";
const LANGUAGE = "de-DE";

export const MOCK_OBJECTIVE = Object.freeze({
  SILENT: "mock:silent",
  REJECT: "mock:reject",
  OUTCOME: "mock:outcome",
  CONSULT: "mock:consult",
  CONSULT_TWICE: "mock:consult-twice",
  CONSULT_CONCURRENT: "mock:consult-concurrent",
  NEVER_CONNECTED: "mock:never-connected",
});

const POLL_STEP_MS = 5;
const POLL_TIMEOUT_MS = 500;
const SILENCE_GRACE_MS = 30;
const NEVER_CONNECTED_REASONS = Object.freeze(["no-answer", "busy", "canceled"]);
const PAIRED_CONSULT_COUNT = 2;
const OUT_OF_ORDER_DELAY_MS = 10;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitUntil(predicate) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error("Vertragspruefung: Warten auf ein Callback-Ereignis lief in die Frist");
    await sleep(POLL_STEP_MS);
  }
}

export function baseStartParams(callId, objective) {
  return { callId, objective, disclosureSentence: DISCLOSURE_SENTENCE, language: LANGUAGE };
}

export function makeCallbackSpy(overrides = {}) {
  const consults = [];
  const outcomes = [];
  const callbacks = {
    async onConsultRaised(request) {
      consults.push(request);
      if (overrides.onConsultRaised) return overrides.onConsultRaised(request);
      return { kind: "timeout", facts: [], reason: "kein_override_definiert" };
    },
    async onOutcomeDelivered(outcome) {
      outcomes.push(outcome);
      if (overrides.onOutcomeDelivered) await overrides.onOutcomeDelivered(outcome);
    },
  };
  return { callbacks, consults, outcomes };
}

function checkStartSucceeds(makeDriver) {
  test("Vertrag: startConversation liefert bei Erfolg ok:true", async () => {
    const spy = makeCallbackSpy();
    const driver = makeDriver({ callbacks: spy.callbacks });
    const result = await driver.startConversation(baseStartParams("cdc-start-ok", MOCK_OBJECTIVE.SILENT));
    assert.equal(result.ok, true, "ok:true bei erfolgreichem Start");
  });
}

function checkStartFailsCleanly(makeDriver) {
  test("Vertrag: startConversation scheitert sauber - ok:false mit einem Grund", async () => {
    const spy = makeCallbackSpy();
    const driver = makeDriver({ callbacks: spy.callbacks });
    const result = await driver.startConversation(baseStartParams("cdc-start-reject", MOCK_OBJECTIVE.REJECT));
    assert.equal(result.ok, false, "ok:false bei abgelehntem Start");
    assert.equal(typeof result.reason, "string", "reason ist ein String");
    assert.ok(result.reason.length > 0, "reason ist nicht leer");
    assert.equal(spy.consults.length, 0, "eine Ablehnung loest keine Rueckfrage aus");
    assert.equal(spy.outcomes.length, 0, "eine Ablehnung liefert kein Ergebnis");
  });
}

function checkSilentIndistinguishableFromConducted(makeDriver) {
  test("Vertrag: ein stummer Start ist am Ergebnis allein nicht von einem gefuehrten Gespraech zu unterscheiden", async () => {
    const silent = makeCallbackSpy();
    const silentDriver = makeDriver({ callbacks: silent.callbacks });
    const silentResult = await silentDriver.startConversation(
      baseStartParams("cdc-silent", MOCK_OBJECTIVE.SILENT),
    );

    const talking = makeCallbackSpy();
    const talkingDriver = makeDriver({ callbacks: talking.callbacks });
    const talkingResult = await talkingDriver.startConversation(
      baseStartParams("cdc-talking", MOCK_OBJECTIVE.OUTCOME),
    );

    assert.deepEqual(
      silentResult,
      talkingResult,
      "StartConversationResult ist in beiden Faellen ok:true ohne Zusatzfeld - ok:true heisst NUR angenommen",
    );

    await waitUntil(() => talking.outcomes.length > 0);
    await sleep(SILENCE_GRACE_MS);
    assert.equal(silent.consults.length, 0, "das stumme Laufwerk meldet nie eine Rueckfrage");
    assert.equal(silent.outcomes.length, 0, "das stumme Laufwerk liefert nie ein Ergebnis");
    assert.equal(talking.outcomes.length, 1, "das gefuehrte Gespraech liefert sehr wohl ein Ergebnis");
    assert.equal(talking.outcomes[0].connected, true, "das gefuehrte Gespraech ist verbunden");
  });
}

function checkEndIsIdempotent(makeDriver) {
  test("Vertrag: endConversation ist idempotent - ein zweiter, nacheinander gestellter Aufruf ist kein Fehler", async () => {
    const callId = "cdc-idempotent";
    const spy = makeCallbackSpy();
    const driver = makeDriver({ callbacks: spy.callbacks });
    await driver.startConversation(baseStartParams(callId, MOCK_OBJECTIVE.SILENT));
    await assert.doesNotReject(
      () => driver.endConversation({ callId, reason: "auftraggeber_abbruch" }),
      "erster endConversation-Aufruf",
    );
    await assert.doesNotReject(
      () => driver.endConversation({ callId, reason: "auftraggeber_abbruch" }),
      "zweiter Aufruf auf derselben, bereits beendeten Unterhaltung ist KEIN Fehler",
    );
  });
}

function checkEndConcurrentCallsAreSafe(makeDriver) {
  test("Vertrag: gleichzeitige endConversation-Aufrufe auf demselben Anruf sind sicher (Ueberschneidung, s. EndConversationParams)", async () => {
    const callId = "cdc-end-concurrent";
    const spy = makeCallbackSpy();
    const driver = makeDriver({ callbacks: spy.callbacks });
    await driver.startConversation(baseStartParams(callId, MOCK_OBJECTIVE.SILENT));
    await assert.doesNotReject(
      () =>
        Promise.all([
          driver.endConversation({ callId, reason: "max_dauer" }),
          driver.endConversation({ callId, reason: "sicherheitsabbruch" }),
        ]),
      "zwei GLEICHZEITIGE endConversation-Aufrufe auf demselben callId sind KEIN Fehler",
    );
  });
}

function checkConsultAnswerArrives(makeDriver) {
  test("Vertrag: eine Rueckfrage haelt offen, und die Antwort kommt im Gespraech an", async () => {
    const callId = "cdc-consult-answered";
    const spy = makeCallbackSpy({
      onConsultRaised: async () => ({ kind: "answered", facts: ["Rueckruf um 15 Uhr ist in Ordnung"] }),
    });
    const driver = makeDriver({ callbacks: spy.callbacks });
    await driver.startConversation(baseStartParams(callId, MOCK_OBJECTIVE.CONSULT));
    await waitUntil(() => spy.outcomes.length > 0);

    assert.equal(spy.consults.length, 1, "genau eine Rueckfrage wird gemeldet");
    const [raised] = spy.consults;
    assert.equal(raised.callId, callId);
    const { question } = raised;
    assert.equal(typeof question, "string");
    assert.ok(question.length > 0, "die Rueckfrage ist nicht leer");

    const [outcome] = spy.outcomes;
    assert.equal(outcome.connected, true, "ein gefuehrtes Gespraech mit Rueckfrage ist verbunden");
    assert.equal(outcome.achieved, true, "beantwortete Rueckfrage -> Auftrag als erfuellt gewertet");
    assert.ok(
      outcome.summary.includes("15 Uhr"),
      "die Antwort-Fakten sind im weitergefuehrten Gespraech angekommen",
    );
  });
}

function checkConsultTimeoutIsValidOutcome(makeDriver) {
  test("Vertrag: eine unbeantwortete Rueckfrage (Zeitablauf) ist ein gueltiger Ausgang, kein Absturz", async () => {
    const callId = "cdc-consult-timeout";
    const answer = { kind: "timeout", facts: [], reason: "zeitablauf" };
    assert.ok(Array.isArray(answer.facts), "facts ist ein Array, auch bei Zeitablauf (kleiner Befund)");
    const spy = makeCallbackSpy({ onConsultRaised: async () => answer });
    const driver = makeDriver({ callbacks: spy.callbacks });
    await assert.doesNotReject(
      () => driver.startConversation(baseStartParams(callId, MOCK_OBJECTIVE.CONSULT)),
      "ein Fensterablauf darf den Start nicht scheitern lassen",
    );
    await waitUntil(() => spy.outcomes.length > 0);

    const [outcome] = spy.outcomes;
    assert.equal(outcome.connected, true, "eine gestellte, aber unbeantwortete Rueckfrage ist trotzdem ein verbundenes Gespraech");
    assert.equal(
      outcome.achieved,
      null,
      "unbeantwortet ist UNBEKANNT (null) - Zeitablauf wird NIE als false gelesen",
    );
  });
}

function checkConsultRejectedIsValidOutcome(makeDriver) {
  test("Vertrag: eine vom Gate/der Sanitisierung abgelehnte Rueckfrage ist ein EIGENER Ausgang, kein Zeitablauf (Befund 5, G26)", async () => {
    const callId = "cdc-consult-rejected";
    const answer = { kind: "rejected", facts: [], reason: "gate" };
    assert.ok(Array.isArray(answer.facts), "facts ist ein Array, auch bei Ablehnung (kleiner Befund)");
    const spy = makeCallbackSpy({ onConsultRaised: async () => answer });
    const driver = makeDriver({ callbacks: spy.callbacks });
    await driver.startConversation(baseStartParams(callId, MOCK_OBJECTIVE.CONSULT));
    await waitUntil(() => spy.outcomes.length > 0);

    const [outcome] = spy.outcomes;
    assert.equal(outcome.connected, true, "eine abgelehnte Rueckfrage aendert nichts daran, dass ein Gespraech lief");
    assert.equal(
      outcome.achieved,
      null,
      "eine Ablehnung ist ebenfalls UNBEKANNT (null), aber ueber einen ANDEREN Diskriminator " +
        "erreicht als Zeitablauf - kind:'rejected' statt kind:'timeout', beides feste Werte " +
        "statt eines freien Textstrings",
    );
  });
}

function checkSequentialConsultAnswersAreCorrectlyPaired(makeDriver) {
  test("Vertrag: zwei NACHEINANDER gestellte Rueckfragen tragen unterscheidbare Kennungen, keine ueberschreibt die andere", async () => {
    const callId = "cdc-consult-twice";
    const answersGiven = [];
    const spy = makeCallbackSpy({
      onConsultRaised: async (request) => {
        const facts = [answersGiven.length === 0 ? "erste Antwort" : "zweite Antwort"];
        answersGiven.push(request.requestId);
        return { kind: "answered", facts };
      },
    });
    const driver = makeDriver({ callbacks: spy.callbacks });
    await driver.startConversation(baseStartParams(callId, MOCK_OBJECTIVE.CONSULT_TWICE));
    await waitUntil(() => spy.outcomes.length > 0);

    assert.equal(
      spy.consults.length,
      PAIRED_CONSULT_COUNT,
      "zwei nacheinander gestellte Rueckfragen werden gemeldet",
    );
    const [first, second] = spy.consults;
    assert.equal(typeof first.requestId, "string");
    assert.ok(first.requestId.length > 0, "die erste Anfrage traegt eine Kennung");
    assert.equal(typeof second.requestId, "string");
    assert.ok(second.requestId.length > 0, "die zweite Anfrage traegt eine Kennung");
    assert.notEqual(
      first.requestId,
      second.requestId,
      "zwei verschiedene Anfragen tragen zwei verschiedene Kennungen - sonst kann eine " +
        "Implementierung sie nicht auseinanderhalten (pendingConsult() allein liefert nur " +
        "'irgendeine ist offen', nicht 'genau diese')",
    );

    const [outcome] = spy.outcomes;
    assert.equal(outcome.connected, true, "zwei gefuehrte Rueckfragen sind ein verbundenes Gespraech");
    assert.ok(
      outcome.summary.includes("erste Antwort") && outcome.summary.includes("zweite Antwort"),
      "beide Antworten sind im Ergebnis wiederzufinden - keine wurde durch die andere ueberschrieben",
    );
  });
}

function checkConcurrentConsultAnswersMatchByRequestId(makeDriver) {
  test("Vertrag: zwei GLEICHZEITIG offene, AUSSER DER REIHE beantwortete Rueckfragen werden ueber requestId zugeordnet, nicht ueber Ankunftsreihenfolge (Befund 1, Blocker)", async () => {
    const callId = "cdc-consult-concurrent";
    const spy = makeCallbackSpy({
      onConsultRaised: (_request) => {
        const raisedFirst = spy.consults.length === 1;
        const answer = { kind: "answered", facts: [raisedFirst ? "Antwort auf Frage 1" : "Antwort auf Frage 2"] };
        return raisedFirst ? sleep(OUT_OF_ORDER_DELAY_MS).then(() => answer) : Promise.resolve(answer);
      },
    });
    const driver = makeDriver({ callbacks: spy.callbacks });
    await driver.startConversation(baseStartParams(callId, MOCK_OBJECTIVE.CONSULT_CONCURRENT));
    await waitUntil(() => spy.outcomes.length > 0);

    assert.equal(spy.consults.length, PAIRED_CONSULT_COUNT, "zwei gleichzeitig offene Rueckfragen werden gemeldet");
    const [first, second] = spy.consults;
    assert.notEqual(
      first.requestId,
      second.requestId,
      "auch gleichzeitig offene Rueckfragen tragen zwei verschiedene Kennungen",
    );

    const [outcome] = spy.outcomes;
    assert.equal(outcome.connected, true, "zwei gefuehrte Rueckfragen sind ein verbundenes Gespraech");
    const posFirstQuestion = outcome.summary.indexOf("Frage 1");
    const posSecondQuestion = outcome.summary.indexOf("Frage 2");
    assert.ok(posFirstQuestion >= 0 && posSecondQuestion >= 0, "beide Antworten sind im Ergebnis wiederzufinden");
    assert.ok(
      posFirstQuestion < posSecondQuestion,
      "die Antwort auf die ZUERST gestellte Frage steht an erster Stelle, obwohl sie ZULETZT " +
        "eintraf - eine Zuordnung nach Ankunftsreihenfolge haette die beiden vertauscht " +
        "(bewusst gegengeprueft: mit einer Ankunftsreihenfolge-Zuordnung wird genau diese " +
        "Zusicherung rot)",
    );
  });
}

function checkConsultRequestCarriesTranscript(makeDriver) {
  test("Vertrag: die Rueckfrage-Anfrage liefert den bisherigen Gespraechsverlauf mit (Befund 4, Blocker)", async () => {
    const callId = "cdc-consult-transcript";
    const spy = makeCallbackSpy({
      onConsultRaised: async () => ({ kind: "timeout", facts: [], reason: "zeitablauf" }),
    });
    const driver = makeDriver({ callbacks: spy.callbacks });
    await driver.startConversation(baseStartParams(callId, MOCK_OBJECTIVE.CONSULT));
    await waitUntil(() => spy.consults.length > 0);

    const [request] = spy.consults;
    assert.ok(
      Array.isArray(request.transcriptSoFar),
      "transcriptSoFar ist ein Array - PFLICHTFELD, sonst hat der Zitat-Riegel " +
        "(consult/question.js: containsVerbatimQuote) keine Eingabe und faellt lautlos auf " +
        "fail-open zurueck",
    );
    assert.ok(
      request.transcriptSoFar.length > 0,
      "transcriptSoFar ist NICHT LEER (Nachfassrunde V5): [].every(...) ist vakuos wahr und " +
        "haette ein leeres Array durchgewunken - genau das Array, bei dem containsVerbatimQuote " +
        "sofort fail-open auf false liefert. Ein leeres Array ist hier NIE zulaessig, weil der " +
        "Offenlegungssatz (Absolute Regel 2) immer schon gesprochen wurde, bevor eine Rueckfrage " +
        "entstehen kann - es gibt keinen legitimen 'noch kein Wort gefallen'-Fall.",
    );
    assert.ok(
      request.transcriptSoFar.every((line) => typeof line === "string"),
      "jeder Verlaufseintrag ist ein String - direkt nutzbar als transcript-Argument von sanitizeConsultQuestion",
    );
  });
}

function checkNeverConnectedIsDistinctSignal(makeDriver) {
  test("Vertrag: 'nie verbunden' ist ein eigenes Signal, getrennt von einem gefuehrten, aber ergebnislosen Gespraech (Befund 2, Blocker)", async () => {
    const callId = "cdc-never-connected";
    const spy = makeCallbackSpy();
    const driver = makeDriver({ callbacks: spy.callbacks });
    await driver.startConversation(baseStartParams(callId, MOCK_OBJECTIVE.NEVER_CONNECTED));
    await waitUntil(() => spy.outcomes.length > 0);

    assert.equal(spy.consults.length, 0, "es kam nie zu einem Gespraech - also auch keine Rueckfrage");
    const [outcome] = spy.outcomes;
    assert.equal(
      outcome.connected,
      false,
      "connected:false unterscheidet dies STRUKTURELL von einem gefuehrten, aber ergebnislosen Gespraech",
    );
    assert.equal(typeof outcome.neverConnectedReason, "string");
    assert.ok(
      NEVER_CONNECTED_REASONS.includes(outcome.neverConnectedReason),
      "der Grund nutzt das bestehende Vokabular aus telephony/failure-reason.js - kein zweites System",
    );
    assert.equal(outcome.achieved, null, "ohne Gespraech ist der Auftrag nicht auswertbar - NIE false");
  });
}

function checkEndResolvesOpenConsult(makeDriver) {
  test("Vertrag: endConversation schliesst eine offen haengende Rueckfrage als unbeantwortet ab, mit erkennbarem Grund (Befund 3, Blocker)", async () => {
    const callId = "cdc-end-mid-consult";
    const spy = makeCallbackSpy({
      onConsultRaised: () => new Promise(() => undefined),
    });
    const driver = makeDriver({ callbacks: spy.callbacks });
    await driver.startConversation(baseStartParams(callId, MOCK_OBJECTIVE.CONSULT));
    await waitUntil(() => spy.consults.length > 0);

    const startedAt = Date.now();
    await assert.doesNotReject(
      () => driver.endConversation({ callId, reason: "sicherheitsabbruch" }),
      "endConversation darf nicht auf eine noch offene, nie beantwortete Rueckfrage warten",
    );
    assert.ok(
      Date.now() - startedAt < POLL_TIMEOUT_MS,
      "endConversation kehrt zuegig zurueck, obwohl die Rueckfrage nie beantwortet wird",
    );

    await waitUntil(() => spy.outcomes.length > 0);
    const [outcome] = spy.outcomes;
    assert.equal(outcome.connected, true, "das Gespraech WAR verbunden - es wurde nur waehrenddessen beendet");
    assert.equal(outcome.achieved, null, "eine durch Beenden abgebrochene Rueckfrage ist nicht auswertbar");
    assert.ok(
      outcome.summary.includes("sicherheitsabbruch"),
      "der Abbruchgrund ist im Ergebnis erkennbar ('mit erkennbarem Grund')",
    );
  });
}

function checkOutcomeClosesConversation(makeDriver) {
  test("Vertrag: ein geliefertes Ergebnis schliesst das Gespraech ab", async () => {
    const callId = "cdc-outcome";
    const spy = makeCallbackSpy();
    const driver = makeDriver({ callbacks: spy.callbacks });
    await driver.startConversation(baseStartParams(callId, MOCK_OBJECTIVE.OUTCOME));
    await waitUntil(() => spy.outcomes.length > 0);

    const [outcome] = spy.outcomes;
    assert.equal(outcome.callId, callId);
    assert.equal(
      outcome.connected,
      true,
      "der schlichte 'lief normal durch'-Fall MUSS connected explizit zusichern (Nachfassrunde: " +
        "genau dieser haeufigste Fall fehlte bisher, ein Adapter haette das Feld hier weglassen koennen)",
    );
    assert.ok(
      outcome.achieved === true || outcome.achieved === false || outcome.achieved === null,
      "achieved ist boolean oder null",
    );
    assert.equal(typeof outcome.summary, "string");
    assert.ok(outcome.summary.length > 0, "summary ist nicht leer");

    await assert.doesNotReject(
      () => driver.endConversation({ callId, reason: "auftraggeber_abbruch" }),
      "nach der Ergebnis-Zustellung bleibt Beenden sicher moeglich",
    );
  });
}

function checkEndsWithoutHeartbeat(makeDriver) {
  test("Vertrag: verstummt das Laufwerk, beendet Hermes selbst mit Grund - der Port hat dafuer bewusst keine Lebenszeichen-Methode", async () => {
    const callId = "cdc-heartbeat-less";
    const spy = makeCallbackSpy();
    const driver = makeDriver({ callbacks: spy.callbacks });
    await driver.startConversation(baseStartParams(callId, MOCK_OBJECTIVE.SILENT));
    await assert.doesNotReject(
      () => driver.endConversation({ callId, reason: "kein_lebenszeichen" }),
      "Hermes' eigene Wanduhr-Frist muss immer durchgehen, egal ob das Laufwerk je etwas meldet",
    );
  });
}

export function checkConversationDriverContract(makeDriver) {
  checkStartSucceeds(makeDriver);
  checkStartFailsCleanly(makeDriver);
  checkSilentIndistinguishableFromConducted(makeDriver);
  checkEndIsIdempotent(makeDriver);
  checkEndConcurrentCallsAreSafe(makeDriver);
  checkConsultAnswerArrives(makeDriver);
  checkConsultTimeoutIsValidOutcome(makeDriver);
  checkConsultRejectedIsValidOutcome(makeDriver);
  checkSequentialConsultAnswersAreCorrectlyPaired(makeDriver);
  checkConcurrentConsultAnswersMatchByRequestId(makeDriver);
  checkConsultRequestCarriesTranscript(makeDriver);
  checkNeverConnectedIsDistinctSignal(makeDriver);
  checkEndResolvesOpenConsult(makeDriver);
  checkOutcomeClosesConversation(makeDriver);
  checkEndsWithoutHeartbeat(makeDriver);
}
