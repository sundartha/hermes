import { test } from "node:test";
import assert from "node:assert/strict";
import { makeElevenLabsOutbound } from "../../src/elevenlabs/outbound.js";
import {
  FROM_SOURCE,
  makeDefaultState,
  endCallRecord,
  recordCallCostEvidence,
  callCostEvidence,
  recordElDetectorCounts,
} from "../../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { REIFE } from "../../src/begriffe/abrechnung.ts";
import { KOSTENART } from "../../src/billing/kostenarten.js";
import { terminateAndBillCall } from "../../src/telephony/call-termination.ts";
import { MS_PER_SECOND } from "../../src/utils/timer.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { waitUntil, withFetch } from "../helpers.js";
import {
  CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES,
  CONVERSATION_DONE_MIT_KOSTEN,
  CONVERSATION_DONE_WITH_ANALYSIS,
  CONVERSATION_DONE_WITH_DATA_COLLECTION,
  CONVERSATION_FAILED_INVALID_DESTINATION,
  CONVERSATION_MIT_KLAMMER_MARKEN,
  CONVERSATION_VORFALL_2026_09_02,
} from "../fixtures/elevenlabs-conversations.js";

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
    leseCall: async () => call,
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
      await el.abfrageDurchLauf(call.id);
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
    "unclear",
    "call_successful:'failure' -> objectiveAchieved unclear (das Sammelurteil des Anbieters bestimmt das Auftragsziel nicht)",
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

const STIMMEN_AGENT_ID = "agent_stimmen";
const STIMMEN_AGENT_PFAD = `/v1/convai/agents/${STIMMEN_AGENT_ID}`;
const STIMMEN_ZEHN_SEKUNDEN_MS = 10_000;
const STIMME_DE = "cqPdIo76zSHFDcSZpFov";
const STIMME_FR = "WeAAwKYcS06VmXw086yZ";
const STIMME_ANDERS = "stimme_beim_anbieter";
const STIMMEN_HTTP_FEHLER = 500;

const stimmenAgent = (eigene, ueberschreibbar) => ({
  conversation_config: { tts: { voice_id: eigene } },
  platform_settings: { overrides: { conversation_config_override: { tts: { voice_id: ueberschreibbar } } } },
});

async function pollMitAgent({ agentAntwort, richtung = "outbound", sprache = "de", leseCallNull = false }) {
  const { call, store, state } = makeCapturingStore({
    id: "call_stimmen",
    elevenlabsConversationId: CONVERSATION_DONE_WITH_ANALYSIS.conversation_id,
    answeredAt: new Date().toISOString(),
  });
  Object.assign(call, { direction: richtung, from: "+15005550006", to: "+4915112345678", language: sprache });
  const nummernAbfragen = [];
  store.numberRecordByE164 = (e164) => {
    nummernAbfragen.push(e164);
    return null;
  };
  if (leseCallNull) {
    let gelesen = 0;
    store.leseCall = async () => ((gelesen += 1) === 4 ? null : call);
  }
  let billed = false;
  const el = makeElevenLabsOutbound({
    store,
    config: withConfigNamespaces({
      elevenLabsOutbound: { ...ACCOUNT, agentId: STIMMEN_AGENT_ID },
      telnyxElevenLabs: { voiceId: "standard" },
    }),
    terminateAndBillCall,
    billThunk: () => () => {
      billed = true;
    },
    finishCall: () => {},
  });
  const anfragen = [];
  const warnungen = [];
  const warnVorher = console.warn;
  console.warn = (...zeilen) => warnungen.push(zeilen.map(String).join(" "));
  const timeoutVorher = AbortSignal.timeout;
  AbortSignal.timeout = (ms) => {
    anfragen.push({ fristMs: ms });
    return timeoutVorher.call(AbortSignal, ms);
  };
  try {
    await withFetch(
      async (url, init) => {
        anfragen.push({ url, methode: init.method, schluessel: init.headers["xi-api-key"] });
        if (init.method !== "GET") return { ok: true, status: HTTP_OK };
        if (!url.endsWith(STIMMEN_AGENT_PFAD)) return { ok: true, status: HTTP_OK, json: async () => CONVERSATION_DONE_WITH_ANALYSIS };
        if (agentAntwort instanceof Error || typeof agentAntwort === "string") return Promise.reject(agentAntwort);
        if (agentAntwort === null) return { ok: false, status: STIMMEN_HTTP_FEHLER, json: async () => ({}) };
        return { ok: true, status: HTTP_OK, json: async () => agentAntwort };
      },
      async () => {
        await el.abfrageDurchLauf(call.id);
        await waitUntil(() => billed);
      },
    );
  } finally {
    console.warn = warnVorher;
    AbortSignal.timeout = timeoutVorher;
  }
  return { call, state, anfragen, warnungen, nummernAbfragen };
}

const STIMMEN_TABELLE = [
  ["gleiche Stimme", STIMME_DE, stimmenAgent(STIMME_DE, false), 1],
  ["andere Stimme ohne Freigabe", STIMME_DE, stimmenAgent(STIMME_ANDERS, false), 2],
  ["andere Stimme mit Freigabe", STIMME_DE, stimmenAgent(STIMME_ANDERS, true), 1],
  ["Freigabe nur als Text ist keine Freigabe", STIMME_DE, stimmenAgent(STIMME_ANDERS, "true"), 2],
  ["Agent ohne Freigabeangaben", STIMME_DE, { conversation_config: { tts: { voice_id: STIMME_ANDERS } } }, 2],
  ["Agent ohne eigene Stimme", STIMME_DE, stimmenAgent("", true), undefined],
  ["Agent ohne Sprachteil", STIMME_DE, {}, undefined],
];

for (const [name, , agentAntwort, erwartet] of STIMMEN_TABELLE) {
  test(`Stimmen am Anrufdatensatz: ${name}`, async () => {
    const { call } = await pollMitAgent({ agentAntwort });
    assert.equal(call.elDetectorCounts.stimmenAnzahl, erwartet);
    assert.equal(Object.hasOwn(call.elDetectorCounts, "stimmenAnzahl"), erwartet !== undefined);
  });
}

test("Stimmen am Anrufdatensatz: die Stimme folgt der Sprache des Anrufs", async () => {
  const { call } = await pollMitAgent({ agentAntwort: stimmenAgent(STIMME_FR, false), sprache: "fr" });
  assert.equal(call.elDetectorCounts.stimmenAnzahl, 1);
});

test("Stimmen am Anrufdatensatz: die Rufnummer der Sprachwahl ist beim ausgehenden Anruf der Absender, beim eingehenden die gerufene Nummer", async () => {
  const agentAntwort = stimmenAgent(STIMME_ANDERS, false);
  const ausgehend = await pollMitAgent({ agentAntwort, richtung: "outbound" });
  const eingehend = await pollMitAgent({ agentAntwort, richtung: "inbound" });
  assert.deepEqual(ausgehend.nummernAbfragen.filter((nummer) => nummer === "+15005550006" || nummer === "+4915112345678"), ["+15005550006"]);
  assert.deepEqual(eingehend.nummernAbfragen.filter((nummer) => nummer === "+15005550006" || nummer === "+4915112345678"), ["+4915112345678"]);
});

test("Stimmen am Anrufdatensatz: der Agent der Konfiguration wird mit Schluessel und einer Frist von zehn Sekunden gelesen", async () => {
  const { anfragen } = await pollMitAgent({ agentAntwort: stimmenAgent(STIMME_DE, false) });
  const agentGets = anfragen.filter((anfrage) => anfrage.url === `${ACCOUNT.apiBase}${STIMMEN_AGENT_PFAD}`);
  assert.equal(agentGets.length, 1);
  assert.equal(agentGets[0].methode, "GET");
  assert.equal(agentGets[0].schluessel, ACCOUNT.apiKey);
  assert.ok(anfragen.some((anfrage) => anfrage.fristMs === STIMMEN_ZEHN_SEKUNDEN_MS));
});

test("Stimmen am Anrufdatensatz: scheitert die Abfrage, fehlt die Zahl, die Zaehler stehen und die Meldung nennt keine Stimme", async () => {
  for (const [agentAntwort, grund] of [[null, "Agent-Abruf"], [new Error("nicht erreichbar"), "nicht erreichbar"], ["kaputt", "unbekannt"]]) {
    const { call, warnungen } = await pollMitAgent({ agentAntwort });
    assert.equal(call.status, "completed");
    assert.deepEqual(call.elDetectorCounts, { elTags: 0, elB1: 0 });
    const meldungen = warnungen.filter((zeile) => zeile.startsWith("[el-stimmen]"));
    assert.equal(meldungen.length, 1);
    assert.ok(meldungen[0].startsWith("[el-stimmen] nicht ermittelt (call=call_stimmen): "));
    assert.ok(meldungen[0].includes(grund), meldungen[0]);
  }
});

test("Stimmen am Anrufdatensatz: ein Anruf, der beim Lesen fehlt, ergibt keine Zahl und keine Abfrage beim Anbieter", async () => {
  const { call, anfragen, warnungen } = await pollMitAgent({ agentAntwort: stimmenAgent(STIMME_DE, false), leseCallNull: true });
  assert.deepEqual(call.elDetectorCounts, { elTags: 0, elB1: 0 });
  assert.equal(anfragen.some((anfrage) => anfrage.url?.endsWith(STIMMEN_AGENT_PFAD)), false);
  assert.equal(warnungen.some((zeile) => zeile.startsWith("[el-stimmen]")), false);
});

test("Stimmen am Anrufdatensatz: das Auflegen beim Abbruch wartet nicht auf die Agentenabfrage", async () => {
  const { call, store } = makeCapturingStore({
    id: "call_abbruch_stimmen",
    elevenlabsConversationId: CONVERSATION_DONE_WITH_ANALYSIS.conversation_id,
    answeredAt: new Date().toISOString(),
  });
  Object.assign(call, { direction: "outbound", from: "+15005550006", to: "+4915112345678", language: "de" });
  store.numberRecordByE164 = () => null;
  const el = makeElevenLabsOutbound({
    store,
    config: withConfigNamespaces({
      elevenLabsOutbound: { ...ACCOUNT, agentId: STIMMEN_AGENT_ID },
      telnyxElevenLabs: { voiceId: "standard" },
    }),
    terminateAndBillCall,
    billThunk: () => () => {},
    finishCall: () => {},
  });
  const methoden = [];
  await withFetch(
    (url, init) => {
      methoden.push({ url, methode: init.method });
      if (init.method === "GET" && url.endsWith(STIMMEN_AGENT_PFAD)) return new Promise(() => {});
      return Promise.resolve({ ok: true, status: HTTP_OK, json: async () => CONVERSATION_DONE_WITH_ANALYSIS });
    },
    async () => {
      el.endActiveCall(call.id);
      await waitUntil(() => methoden.some((anfrage) => anfrage.methode === "DELETE"));
    },
  );
  assert.equal(methoden.some((anfrage) => anfrage.url.endsWith(STIMMEN_AGENT_PFAD)), false);
  assert.equal(Object.hasOwn(call.elDetectorCounts ?? {}, "stimmenAnzahl"), false);
});
