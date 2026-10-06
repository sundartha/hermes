import { test } from "node:test";
import assert from "node:assert/strict";
import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";
import {
  FROM_SOURCE,
  makeDefaultState,
  endCallRecord,
  recordCallCostEvidence,
  callCostEvidence,
  recordElDetectorCounts,
} from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, REIFE } from "../src/store/defaults.js";
import { KOSTENART } from "../src/billing/kostenarten.js";
import { terminateAndBillCall } from "../src/telephony/call-termination.js";
import { MS_PER_SECOND } from "../src/utils/timer.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { waitUntil, withFetch } from "./helpers.js";
import {
  CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES,
  CONVERSATION_DONE_MIT_KOSTEN,
  CONVERSATION_DONE_WITH_ANALYSIS,
  CONVERSATION_DONE_WITH_DATA_COLLECTION,
  CONVERSATION_FAILED_INVALID_DESTINATION,
  CONVERSATION_MIT_KLAMMER_MARKEN,
  CONVERSATION_VORFALL_2026_09_02,
} from "./fixtures/elevenlabs-conversations.js";

const ACCOUNT = { apiKey: "test-key", apiBase: "https://el.test" };
const HTTP_OK = 200;
const CONVERSATION_DONE_MIT_KOSTEN_MIKRO_CENTS = 10_420_301;

function makeCapturingStore({ id, elevenlabsConversationId, answeredAt }) {
  const state = makeDefaultState();
  const call = {
    id,
    tenantId: BOOTSTRAP_TENANT_ID,
    status: "active",
    elevenlabsConversationId,
    answeredAt,
    startedAt: answeredAt,
    endedAt: null,
  };
  state.calls.push(call);
  const captured = {
    transcript: [],
    summary: undefined,
    objectiveAchieved: undefined,
    answeredAtIso: undefined,
    unclearReasons: [],
    failureReasons: [],
    actualSender: undefined,
  };
  const store = {
    getCall: () => call,
    load: () => state,
    addTranscript: (_id, role, message) => captured.transcript.push({ role, message }),
    recordProviderCallResult: (_id, { summary, objectiveAchieved }) => {
      captured.summary = summary;
      captured.objectiveAchieved = objectiveAchieved;
    },
    recordProviderCollectedFields: () => {},
    recordCalleeConfirmedTimezone: () => {},
    recordSipCallId: () => {},
    recordFromRegistrationSource: () => {},
    recordActualSender: (_id, sender) => {
      captured.actualSender = sender;
    },
    trueUpAnsweredAt: (_id, answeredAtIso) => {
      captured.answeredAtIso = answeredAtIso;
    },
    recordAnsweredUnclearReason: (_id, reason) => captured.unclearReasons.push(reason),
    recordFailureReason: (_id, reason) => captured.failureReasons.push(reason),
    endCallRecord: (callId, status) => endCallRecord(state, callId, status).call,
    recordCallCostEvidence: (eingabe) => recordCallCostEvidence(state, eingabe),
    callCostEvidence: (callId) => callCostEvidence(state, callId),
    recordElDetectorCounts: (id, zaehlung) => recordElDetectorCounts(state, id, zaehlung),
  };
  return { call, store, captured, state };
}

async function pollFixtureConversation(fixture) {
  const { call, store, captured, state } = makeCapturingStore({
    id: `call_${fixture.conversation_id}`,
    elevenlabsConversationId: fixture.conversation_id,
    answeredAt: new Date().toISOString(),
  });
  let billed = false;
  const el = makeElevenLabsOutbound({
    store,
    config: withConfigNamespaces({ elevenLabsOutbound: ACCOUNT }),
    terminateAndBillCall,
    billThunk: () => () => {
      billed = true;
    },
    finishCall: () => {},
  });
  await withFetch(
    async (_url, init) =>
      init.method === "GET" ? { ok: true, status: HTTP_OK, json: async () => fixture } : { ok: true, status: HTTP_OK },
    async () => {
      el.rearmActiveConversationPolls();
      await waitUntil(() => billed);
    },
  );
  return { call, captured, state };
}

test("Fixture FAILED (SIP-404 ungueltiges Ziel): analysis:null ueberlebt, KEIN Buchungsanker, der Anbieterfehler traegt seinen eigenen Grund", async () => {
  const { call, captured } = await pollFixtureConversation(CONVERSATION_FAILED_INVALID_DESTINATION);

  assert.equal(call.status, "failed", "Anbieter-Status 'failed' -> unser Status 'failed'");
  assert.deepEqual(captured.transcript, [], "kein gesprochener Inhalt (agent kam nie zu Wort)");
  assert.equal(captured.summary, null, "analysis:null -> keine Zusammenfassung, kein Wurf (Pflicht d)");
  assert.equal(
    captured.objectiveAchieved,
    "unclear",
    "analysis:null -> objectiveAchievedOf faellt auf 'unclear' zurueck, statt zu werfen (Pflicht d)",
  );
  assert.equal(captured.answeredAtIso, null, "ein Anbieterfehler vor jeder Rufannahme setzt keinen Buchungsanker");
  assert.deepEqual(
    captured.unclearReasons,
    ["provider_rejected_before_answer"],
    "ein gemeldeter Anbieterfehler ist der staerkere Beleg als 'Dauer 0' allein",
  );
  assert.deepEqual(
    captured.failureReasons,
    ["unreachable:invite-404-D11"],
    "der Tippfehler eines Nutzers (Ziel existiert nicht) ist NICHT unsere Schuld - anders als ein 403",
  );
  assert.deepEqual(
    captured.actualSender,
    { e164: "***0177#1ca0c7", source: FROM_SOURCE.PROVIDER_MEASURED },
    "recordActualSender muss mit dem GENAUEN Fixture-Token und source=provider_measured gerufen werden",
  );
});

const ERWARTETE_ZUSAMMENFASSUNG =
  'The AI assistant conducted a test call for Jonas Beispiel. The user provided feedback, noting clear audio but slightly off quality, slow pace, and an "American" sounding voice. The user also asked if the AI could perform internet lookups (e.g., weather), to which the AI replied it currently lacks browsing capabilities, its role being limited to the test. The user considered the test a success, finding this version an improvement over the live one, specifically praising the ability to converse indefinitely without interruption. Future enhancements, such as internet browsing tools, were suggested for upcoming tests.';

test("Fixture DONE (149s, call_successful:failure): Transkript+Zusammenfassung kommen WOERTLICH (maskiert) an, Buchungsanker aus echter Dauer", async () => {
  const { call, captured } = await pollFixtureConversation(CONVERSATION_DONE_WITH_ANALYSIS);

  assert.equal(call.status, "completed", "Anbieter-Status 'done' -> unser Status 'completed'");
  assert.deepEqual(
    captured.transcript,
    [
      {
        role: "agent",
        message:
          "Hello, this is an AI assistant calling on behalf of Jonas Beispiel. This conversation will be summarised for the person I represent.",
      },
      { role: "caller", message: "Okay, cool. What do you want?" },
    ],
    "die ECHTEN (maskierten) Transkriptzeilen kommen woertlich am Store an, Rolle uebersetzt",
  );
  assert.equal(captured.summary, ERWARTETE_ZUSAMMENFASSUNG, "die ECHTE Anbieter-Zusammenfassung kommt woertlich an");
  assert.equal(
    captured.objectiveAchieved,
    false,
    "call_successful:'failure' -> objectiveAchieved false (der Anbieter bewertet das AUFTRAGSZIEL, nicht ob das Telefonat gelang)",
  );
  assert.ok(captured.answeredAtIso, "call_duration_secs=149 (positiv) -> ein echter Buchungsanker wird gesetzt");
  assert.equal(
    new Date(call.endedAt).getTime() - new Date(captured.answeredAtIso).getTime(),
    CONVERSATION_DONE_WITH_ANALYSIS.metadata.call_duration_secs * MS_PER_SECOND,
    "der Anker liegt exakt call_duration_secs vor dem Gespraechsende",
  );
  assert.deepEqual(captured.unclearReasons, [], "ein brauchbarer Anker braucht keinen Unklar-Grund");
});

test("Fixture CLOSE-1008 (fehlende dynamische Variable): winziger, aber ECHTER Anker (1s) - kein leerer Wert trotz leerem Transkript", async () => {
  const { call, captured } = await pollFixtureConversation(CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES);

  assert.equal(call.status, "completed");
  assert.deepEqual(captured.transcript, [], "agent_redet:false (gemessen) - kein gesprochener Inhalt");
  assert.equal(captured.summary, null, "analysis:null (plausibel abgeleitet) -> keine Zusammenfassung");
  assert.equal(captured.objectiveAchieved, "unclear");
  assert.ok(captured.answeredAtIso, "eine positive (wenn auch winzige) Dauer ergibt einen echten Anker, keinen Nullwert");
  assert.equal(
    new Date(call.endedAt).getTime() - new Date(captured.answeredAtIso).getTime(),
    CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES.metadata.call_duration_secs * MS_PER_SECOND,
  );
  assert.deepEqual(captured.unclearReasons, []);
});

function mitAufgezeichnetemFehlerlog(run) {
  const orig = console.error;
  const zeilen = [];
  console.error = (...args) => zeilen.push(args.join(" "));
  return run(zeilen).finally(() => {
    console.error = orig;
  });
}

function ohneKlammerMarken(fixture) {
  return {
    ...fixture,
    transcript: fixture.transcript.map((zeile) => ({
      ...zeile,
      message: zeile.message.replace(/\[[^\]\n]{1,40}\]\s*/g, ""),
    })),
  };
}

test("Riegel Klammer-Marken: der echte Anruf-6-Datensatz schlaegt an - vier Marken gemeldet, Transkript unveraendert gespeichert", async () => {
  await mitAufgezeichnetemFehlerlog(async (zeilen) => {
    const { captured } = await pollFixtureConversation(CONVERSATION_MIT_KLAMMER_MARKEN);

    const meldung = zeilen.find((zeile) => zeile.startsWith("[el-tags]"));
    assert.ok(meldung, `keine [el-tags]-Meldung - der Riegel hat nicht angeschlagen. Log: ${zeilen.join(" | ")}`);
    assert.match(meldung, /treffer=4\b/, `erwartet vier Marken, Meldung: ${meldung}`);
    for (const marke of ["[warmly]", "[patient]", "[Curious]", "[confident]"])
      assert.ok(meldung.includes(marke), `die Meldung nennt ${marke} nicht: ${meldung}`);

    const gespeichert = captured.transcript.map((eintrag) => eintrag.message).join("\n");
    for (const marke of ["[warmly]", "[patient]", "[Curious]", "[confident]"])
      assert.ok(gespeichert.includes(marke), `${marke} fehlt im gespeicherten Transkript - still gestrippt statt gemeldet`);
  });
});

test("Riegel Klammer-Marken: derselbe Datensatz ohne Marken schlaegt NICHT an (Positiv-Kontrolle)", async () => {
  await mitAufgezeichnetemFehlerlog(async (zeilen) => {
    const { captured } = await pollFixtureConversation(ohneKlammerMarken(CONVERSATION_MIT_KLAMMER_MARKEN));

    assert.equal(
      zeilen.filter((zeile) => zeile.startsWith("[el-tags]")).length,
      0,
      `der Riegel meldet ohne Marken: ${zeilen.join(" | ")}`,
    );
    assert.ok(
      captured.transcript.length > 0,
      "Positiv-Kontrolle der Kontrolle: es wurde ueberhaupt ein Transkript verarbeitet",
    );
  });
});

const MINIMALE_VOLLSATZ_LAENGE = 20;
const vollsaetzeVon = (transcript) =>
  transcript
    .flatMap((eintrag) => eintrag.message.split(/\n+|(?<=[.!?])\s+/))
    .filter((satz) => satz.length > MINIMALE_VOLLSATZ_LAENGE);

test("[abgenommen AS7] Vorfalls-Fixture 2026-09-02: [el-b1] feuert genau 1x, [el-tags] meldet [fröhlich], Transkript unveraendert gespeichert, Meldung ohne Vollsaetze, Fixture anonymisiert", async () => {
  await mitAufgezeichnetemFehlerlog(async (zeilen) => {
    const { call, captured } = await pollFixtureConversation(CONVERSATION_VORFALL_2026_09_02);

    const b1Zeilen = zeilen.filter((zeile) => zeile.startsWith("[el-b1]"));
    assert.equal(b1Zeilen.length, 1, `erwartet genau eine [el-b1]-Meldung, Log: ${zeilen.join(" | ")}`);
    const b1Meldung = b1Zeilen[0];
    assert.match(b1Meldung, /treffer=1\b/, `erwartet treffer=1, Meldung: ${b1Meldung}`);
    assert.ok(b1Meldung.includes("cues=gut+klar"), `die Meldung nennt die Cues nicht: ${b1Meldung}`);
    assert.ok(b1Meldung.includes("zeilen=2"), `die Meldung nennt den Zeilenindex nicht: ${b1Meldung}`);

    const tagsMeldung = zeilen.find((zeile) => zeile.startsWith("[el-tags]"));
    assert.ok(tagsMeldung, `keine [el-tags]-Meldung. Log: ${zeilen.join(" | ")}`);
    assert.match(tagsMeldung, /treffer=1\b/, `erwartet treffer=1, Meldung: ${tagsMeldung}`);
    assert.ok(tagsMeldung.includes("[fröhlich]"), `die Meldung nennt [fröhlich] nicht: ${tagsMeldung}`);

    assert.deepEqual(
      captured.transcript,
      [
        { role: "agent", message: CONVERSATION_VORFALL_2026_09_02.transcript[0].message },
        { role: "caller", message: CONVERSATION_VORFALL_2026_09_02.transcript[1].message },
        { role: "agent", message: CONVERSATION_VORFALL_2026_09_02.transcript[2].message },
      ],
      "das Vorfall-Transkript muss unveraendert gespeichert werden (MELDEN, NICHT ENTFERNEN)",
    );

    assert.deepEqual(call.elDetectorCounts, { elTags: 1, elB1: 1 });

    for (const satz of vollsaetzeVon(captured.transcript)) {
      assert.ok(!b1Meldung.includes(satz), `Vollsatz geleakt: "${satz}" in "${b1Meldung}"`);
    }

    const fixtureSerialisiert = JSON.stringify(CONVERSATION_VORFALL_2026_09_02);
    assert.ok(!fixtureSerialisiert.includes("Antonio"), "der Eigentuemernamen (Vorname) steht in der Fixture");
    assert.ok(!fixtureSerialisiert.includes("Fotiadis"), "der Eigentuemernamen (Nachname) steht in der Fixture");
    assert.ok(
      !/(\+|")\d{7,}/.test(fixtureSerialisiert),
      "eine Klartext-Rufnummer steht in der Fixture (erlaubt sind nur maskNumber-Token)",
    );
  });
});

test("[abgenommen AS8] Gegenprobe an sauberen Echtfall-Fixtures (Anruf-7/8-Charakter): beide Detektoren still, Zaehlfeld 0", async () => {
  const saubereFixtures = [
    CONVERSATION_DONE_WITH_ANALYSIS,
    CONVERSATION_DONE_MIT_KOSTEN,
    CONVERSATION_DONE_WITH_DATA_COLLECTION,
  ];
  for (const fixture of saubereFixtures) {
    await mitAufgezeichnetemFehlerlog(async (zeilen) => {
      const { call, captured } = await pollFixtureConversation(fixture);
      assert.ok(
        captured.transcript.length > 0,
        "Positivkontrolle: es wurde ueberhaupt ein Transkript verarbeitet",
      );
      assert.deepEqual(
        zeilen.filter((zeile) => zeile.startsWith("[el-tags]") || zeile.startsWith("[el-b1]")),
        [],
        `an einer sauberen Fixture meldet ein Detektor: ${zeilen.join(" | ")}`,
      );
      assert.deepEqual(
        call.elDetectorCounts,
        { elTags: 0, elB1: 0 },
        "der Normalfall {elTags:0, elB1:0} muss gesetzt werden (kein Verschlucken)",
      );
    });
  }

  await mitAufgezeichnetemFehlerlog(async (zeilen) => {
    const { call, captured } = await pollFixtureConversation(CONVERSATION_MIT_KLAMMER_MARKEN);
    assert.ok(captured.transcript.length > 0, "Positivkontrolle: es wurde ueberhaupt ein Transkript verarbeitet");
    assert.equal(
      zeilen.filter((zeile) => zeile.startsWith("[el-b1]")).length,
      0,
      `[el-b1] meldet am Anruf-6-Datensatz (keine Doppelankuendigung): ${zeilen.join(" | ")}`,
    );
    assert.deepEqual(call.elDetectorCounts, { elTags: 4, elB1: 0 });
  });
});

test("F-2a: der Belegweg laeuft mit - die telnyx_sip-Zeile (reife=erwartet) steht nach dem Poll, unabhaengig vom EL-Betrag", async () => {
  const { state } = await pollFixtureConversation(CONVERSATION_DONE_WITH_ANALYSIS);

  const belege = callCostEvidence(state, `call_${CONVERSATION_DONE_WITH_ANALYSIS.conversation_id}`);
  const telnyxSip = belege.find((zeile) => zeile.traeger === KOSTENART.TELNYX_SIP);
  assert.ok(telnyxSip, "die erwartete telnyx_sip-Zeile fehlt - der Belegweg lief NICHT mit");
  assert.equal(telnyxSip.reife, REIFE.ERWARTET, "'wir erwarten einen SIP-Beleg' ist unabhaengig vom EL-Betrag");
});

test("F-2b: CONVERSATION_DONE_MIT_KOSTEN auf dem echten Poll-Pfad - EL-Zeile vorlaeufig mit dem GEMESSENEN Betrag, telnyx_sip erwartet", async () => {
  const { state } = await pollFixtureConversation(CONVERSATION_DONE_MIT_KOSTEN);

  const belege = callCostEvidence(state, `call_${CONVERSATION_DONE_MIT_KOSTEN.conversation_id}`);
  const elZeile = belege.find((zeile) => zeile.traeger === KOSTENART.ELEVENLABS_CONVAI);
  assert.ok(elZeile, "die elevenlabs_convai-Zeile fehlt - der Belegweg lief NICHT mit");
  assert.equal(elZeile.reife, REIFE.VORLAEUFIG);
  assert.equal(elZeile.betragMikroCents, CONVERSATION_DONE_MIT_KOSTEN_MIKRO_CENTS);
  assert.equal(elZeile.belegRef, CONVERSATION_DONE_MIT_KOSTEN.conversation_id);

  const telnyxSip = belege.find((zeile) => zeile.traeger === KOSTENART.TELNYX_SIP);
  assert.ok(telnyxSip, "die erwartete telnyx_sip-Zeile fehlt");
  assert.equal(telnyxSip.reife, REIFE.ERWARTET);
});
