// ---- Teil 2 (Owner-Auftrag 15.08.2026, Phase 2, woertlich: "Die Aufzeichnungen werden
// Fixtures. Attrappen antworten ab jetzt mit aufgezeichneten echten Antworten statt mit
// lokalen Konstanten.") ------------------------------------------------------------------
// Faehrt die drei Gespraechs-Datensaetze aus test/fixtures/elevenlabs-conversations.js
// (ECHTE, gegen api.elevenlabs.io gemessene Antworten, Herkunft dort je Fund dokumentiert)
// durch denselben Weg wie ein echter Poll-Takt (makeElevenLabsOutbound#
// rearmActiveConversationPolls -> pollConversationResult -> finishFromConversation), OHNE
// Netz/Server (Attrappen-fetch, Muster test/el-beende-versuch.test.js).
//
// EHRLICHKEIT (Pflicht b): der FAILED-Fund unten ist ein SIP-404 "ungueltiges Ziel", NICHT
// "niemand hat abgenommen" - dieser Fall ist NICHT belegt und wird hier auch nicht
// behauptet. Seit OUTBOUND-E2 traegt der Fall deshalb seinen eigenen Grund
// (provider_rejected_before_answer / failureReason unreachable:invite-404-D11), statt auf
// call_duration_secs_zero_not_answered zu fallen (s. Test unten). Der CLOSE-1008-Fund
// traegt zwei Felder, die fuer GENAU DIESE Kennung nicht gemessen wurden (status, analysis)
// - als AUSGEDACHT gekennzeichnet, s. Fixture-Kommentar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";
import { FROM_SOURCE, makeDefaultState, recordCallCostEvidence, callCostEvidence, recordElDetectorCounts } from "../src/store/state-ops.js";
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
// KV2-4-gepinnter Mikro-Cent-Wert von CONVERSATION_DONE_MIT_KOSTEN.metadata.cost_fiat
// (0,10420301650668388 USD) - EINE Quelle statt eines zweiten, hier getippten Werts.
const CONVERSATION_DONE_MIT_KOSTEN_MIKRO_CENTS = 10_420_301;

// Faengt genau die Werte ab, die persistProviderResult/applyAnsweredAnchor an den Store
// weiterreichen - dieselben Felder, die get_transcript und die Kostendecke lesen. Der Call
// entsteht HIER (statt als Parameter uebergeben zu werden) - sonst waere das Mutieren
// seiner Felder im endCallRecord-Fake unten ein no-param-reassign-Verstoss (P6/F2).
function makeCapturingStore({ id, elevenlabsConversationId, answeredAt }) {
  // F-2 (tasks/kostenv2/befunde-kette.md): NICHT laenger ein Ad-hoc-Objekt. Ein ECHTER
  // state-ops-Zustand (makeDefaultState), damit recordCallCostEvidence/callCostEvidence
  // unten an die ECHTEN state-ops-Funktionen delegieren koennen statt in einem
  // Ad-hoc-'load()' zu landen, das die beiden Methoden nie kannte.
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
    // ABNAHME-D1: additiv NEBEN recordProviderCallResult (persistProviderResult, s.
    // src/elevenlabs/outbound.js) - keine der drei Fixtures dieser Datei traegt
    // data_collection_results, deshalb hier reine No-ops statt eigener Erfassung
    // (die eigene Erfassung deckt test/elevenlabs-data-collection.test.js ab).
    recordProviderCollectedFields: () => {},
    recordCalleeConfirmedTimezone: () => {},
    // Join-Schluessel zur Telefonie-Rechnung (persistProviderResult, s.
    // src/elevenlabs/outbound.js): hier ein No-op - der Sachverhalt dieser Datei
    // haengt nicht an ihm, aber die Attrappe muss die Methode kennen, sonst wirft
    // der Ergebnisweg einen TypeError.
    recordSipCallId: () => {},
    // OUTBOUND-E5: dieselbe Begruendung wie recordSipCallId direkt darueber.
    recordFromRegistrationSource: () => {},
    // E5-02 (Review Runde 2): NICHT laenger ein No-op - der Produktions-Lesepfad
    // (recordAbsenderMessung, src/elevenlabs/outbound.js) war bisher voellig unverifiziert,
    // JEDE EL-Attrappe stubbte diese Methode weg. Der Wert wird hier aufgezeichnet, damit
    // die Tests unten den GENAUEN Feldpfad (metadata.phone_call.agent_number) byte-genau
    // gegen das Fixture-Token pinnen koennen.
    recordActualSender: (_id, sender) => {
      captured.actualSender = sender;
    },
    trueUpAnsweredAt: (_id, answeredAtIso) => {
      captured.answeredAtIso = answeredAtIso;
    },
    recordAnsweredUnclearReason: (_id, reason) => captured.unclearReasons.push(reason),
    // OUTBOUND-E2: der Ergebnisweg ruft recordFailureReason UNBEDINGT (finishFromConversation)
    // - eine unvollstaendige Attrappe soll auffallen (TypeError), nicht stumm bleiben.
    recordFailureReason: (_id, reason) => captured.failureReasons.push(reason),
    // Der ECHTE Store (endCallRecord) liefert den fertig persistierten Call zurueck -
    // answeredAnchorOutcome braucht dessen endedAt (s. outbound.js#finishFromConversation).
    endCallRecord: (_id, status) => {
      call.status = status;
      call.endedAt = new Date().toISOString();
      return call;
    },
    // F-2 (tasks/kostenv2/befunde-kette.md): NICHT laenger weggelassen. Ohne diese zwei
    // Methoden verschluckte der fail-soft-Zweig aus KV2-4 den Belegweg lautlos -
    // ausgerechnet in dem Test, der gegen ECHTE Anbieter-Antworten prueft. Delegiert an
    // die ECHTEN state-ops-Funktionen (kein zweites, vereinfachtes Store-Verhalten).
    recordCallCostEvidence: (eingabe) => recordCallCostEvidence(state, eingabe),
    callCostEvidence: (callId) => callCostEvidence(state, callId),
    // ST3: bewusst DELEGIEREND statt No-op (Muster recordCallCostEvidence direkt darueber)
    // - AS7/AS8 lesen call.elDetectorCounts am ECHTEN state-ops-Zustand.
    recordElDetectorCounts: (id, zaehlung) => recordElDetectorCounts(state, id, zaehlung),
  };
  return { call, store, captured, state };
}

// EIN Poll-Takt gegen EINEN Gespraechs-Datensatz (Fixture) - der Anbieter antwortet sofort
// mit dem uebergebenen Datensatz, egal welche Kennung angefragt wird (jeder Test hier
// fragt genau eine Kennung ab).
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

// ---- FAILED: SIP 404 "Invalid destination number" -------------------------------------
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
  // OUTBOUND-E2 (Ausfall 27.08.2026): bis hier stand "es wurde nie abgenommen". Das war
  // falsch: der Anbieter nennt in metadata.error einen SIP-404 ("Invalid destination
  // number") - das ZIEL existiert nicht, es hat nicht bloss niemand abgenommen. Beide
  // Faelle trugen dasselbe Label, und deshalb war am 27.08. ein Konfigurationsdefekt
  // (SIP-403, unsere Absendernummer war freigegeben worden) drei Tage lang von einer
  // Nichtannahme ununterscheidbar. Der Buchungsanker bleibt in beiden Faellen null - nur
  // das Label wird ehrlich: der Grund heisst jetzt provider_rejected_before_answer, und der
  // Fehlergrund am Call-Record (call.failureReason, EIN Vokabular fuer alle Engines) nennt
  // die konkrete Klasse (unreachable, weil das ZIEL nicht erreichbar ist - nicht wir).
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
  // E5-02 (Review Runde 2): der Produktions-Lesepfad recordAbsenderMessung liest
  // conversation.metadata.phone_call.agent_number - byte-genau gegen das Fixture-Token
  // gepinnt (Vermeidungsliste 3: eine Attrappe, die den Wert ignoriert, beweist nichts).
  // AUCH im abgelehnten Fall befuellt (der Kommentar an recordAbsenderMessung sagt das
  // ausdruecklich - dieser Test ist die eine Fixture, die das belegt).
  assert.deepEqual(
    captured.actualSender,
    { e164: "***0177#1ca0c7", source: FROM_SOURCE.PROVIDER_MEASURED },
    "recordActualSender muss mit dem GENAUEN Fixture-Token und source=provider_measured gerufen werden",
  );
});

// UNABHAENGIG von der Fixture abgetippt (nicht per Referenz auf CONVERSATION_DONE_
// WITH_ANALYSIS.analysis.transcript_summary verglichen) - sonst wuerde eine verfaelschte
// Fixture den Vergleich NICHT rot faerben, weil beide Seiten der Assertion identisch
// mitverfaelscht wuerden (ROTPROBE 2 deckte genau das auf, s. Ruecksprache im Report).
const ERWARTETE_ZUSAMMENFASSUNG =
  'The AI assistant conducted a test call for Jonas Beispiel. The user provided feedback, noting clear audio but slightly off quality, slow pace, and an "American" sounding voice. The user also asked if the AI could perform internet lookups (e.g., weather), to which the AI replied it currently lacks browsing capabilities, its role being limited to the test. The user considered the test a success, finding this version an improvement over the live one, specifically praising the ability to converse indefinitely without interruption. Future enhancements, such as internet browsing tools, were suggested for upcoming tests.';

// ---- DONE: ein technisch gelungenes, inhaltlich erfolgloses Gespraech (149s) -----------
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
      // Der Anbieter nennt die Gegenseite "user", unser Transkript "caller" (roleOf,
      // outbound.js) - der WORTLAUT bleibt unveraendert, nur die Rollen-Bezeichnung wird
      // uebersetzt.
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

// ---- CLOSE-1008: sofortiger WebSocket-Abbruch mangels dynamischer Variable -------------
test("Fixture CLOSE-1008 (fehlende dynamische Variable): winziger, aber ECHTER Anker (1s) - kein leerer Wert trotz leerem Transkript", async () => {
  const { call, captured } = await pollFixtureConversation(CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES);

  // status ist fuer DIESE Kennung nicht gemessen (Fixture-Kommentar, AUSGEDACHT) - der Test
  // pinnt trotzdem das VERHALTEN fuer den Wert, den die Fixture traegt ("done").
  assert.equal(call.status, "completed");
  assert.deepEqual(captured.transcript, [], "agent_redet:false (gemessen) - kein gesprochener Inhalt");
  assert.equal(captured.summary, null, "analysis:null (plausibel abgeleitet) -> keine Zusammenfassung");
  assert.equal(captured.objectiveAchieved, "unclear");
  // call_duration_secs=1 ist GEMESSEN und POSITIV - anders als der FAILED-Fund oben (0)
  // ist das hier kein "niemand hat abgenommen": die Leitung stand kurz, der Agent kam nur
  // nie zu Wort. Ein Anker MUSS gesetzt werden, sonst wuerde ein winziges echtes Gespraech
  // wie eine unbeantwortete Klingel aussehen.
  assert.ok(captured.answeredAtIso, "eine positive (wenn auch winzige) Dauer ergibt einen echten Anker, keinen Nullwert");
  assert.equal(
    new Date(call.endedAt).getTime() - new Date(captured.answeredAtIso).getTime(),
    CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES.metadata.call_duration_secs * MS_PER_SECOND,
  );
  assert.deepEqual(captured.unclearReasons, []);
});

// ---- RIEGEL gegen Klammer-Marken im gesprochenen Text (Befund 3, Anruf 6) --------------
// Gemessen wird an der ECHTEN Anbieter-Antwort von Anruf 6 (18.08.2026), nicht an einer
// ausgedachten: der Agent sprach dort vier Marken ([warmly], [patient], [Curious],
// [confident]), weil tts.suggested_audio_tags sie ihm vorschlug, waehrend der Prompt sie
// verbot. Beide Quellen sind in der Vorlage inzwischen zu - dieser Riegel meldet, wenn sie
// wieder aufgehen (Dashboard, Neuanlage des Agenten, zurueckgedrehte Konfiguration).
//
// GEMELDET, NICHT ENTFERNT: das Transkript ist der Nachweis nach Artikel 50 EU AI Act. Der
// Fall unten prueft deshalb BEIDES - dass die Meldung kommt UND dass die Marken
// unveraendert im Store landen.
function mitAufgezeichnetemFehlerlog(run) {
  const orig = console.error;
  const zeilen = [];
  console.error = (...args) => zeilen.push(args.join(" "));
  return run(zeilen).finally(() => {
    console.error = orig;
  });
}

// Die Marken aus jeder Agenten-Zeile entfernen - die Gegenprobe zur Rotprobe. Bewusst am
// FIXTURE-Objekt abgeleitet statt danebengeschrieben: so misst der Negativfall garantiert
// denselben Datensatz.
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

    // Die andere Haelfte: NICHTS wird stillschweigend entfernt (Artikel 50).
    const gespeichert = captured.transcript.map((eintrag) => eintrag.message).join("\n");
    for (const marke of ["[warmly]", "[patient]", "[Curious]", "[confident]"])
      assert.ok(gespeichert.includes(marke), `${marke} fehlt im gespeicherten Transkript - still gestrippt statt gemeldet`);
  });
});

// ROTPROBE-GEGENSTUECK: derselbe Datensatz OHNE Marken darf NICHT anschlagen. Ohne diesen
// Fall bestuende der Riegel auch dann, wenn er stur bei jedem Anruf meldete - und eine
// Meldung, die immer kommt, wird abgeschaltet statt beachtet.
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

// ---- ST3 (O3): die zwei Detektoren am VORFALL 2026-09-02 (AS7/AS8) -----------------------
// AS7/AS8 leben hier und nicht in test/el-stimme-abnahme.test.js, weil hier der Poll-
// Treiber (pollFixtureConversation, mitAufgezeichnetemFehlerlog, makeCapturingStore)
// steht - Verlagerung statt Duplikation (G5). AS7 misst am ECHTEN Vorfalls-Datensatz:
// BEIDE Defekte derselben Aeusserung ([fröhlich] als B2-Marke, die doppelte Ankuendigung
// als B1) muessen JE GENAU EINMAL melden, das Zaehlfeld beide tragen - und das
// Transkript bleibt unveraendert (Art. 50: das Transkript ist der Nachweis, stilles
// Strippen machte aus dem Nachweis eine Schoenschrift).

// Vollsaetze aus dem gespeicherten Transkript (Satzgrenzen wie die Heuristik) - fuer den
// R8-Leak-Check: keine dieser Zeilen darf in einer [el-b1]-Meldung stehen. Ab dieser
// Laenge gilt ein Satz als Vollsatz (kuerzere Fragment tragen keinen Gespraechsinhalt).
const MINIMALE_VOLLSATZ_LAENGE = 20;
const vollsaetzeVon = (transcript) =>
  transcript
    .flatMap((eintrag) => eintrag.message.split(/\n+|(?<=[.!?])\s+/))
    .filter((satz) => satz.length > MINIMALE_VOLLSATZ_LAENGE);

test("[abgenommen AS7] Vorfalls-Fixture 2026-09-02: [el-b1] feuert genau 1x, [el-tags] meldet [fröhlich], Transkript unveraendert gespeichert, Meldung ohne Vollsaetze, Fixture anonymisiert", async () => {
  await mitAufgezeichnetemFehlerlog(async (zeilen) => {
    const { call, captured } = await pollFixtureConversation(CONVERSATION_VORFALL_2026_09_02);

    // (a) [el-b1]: GENAU EINE Meldung, Trefferzahl 1, die gemessenen Cues, der Zeilenindex
    // der dritten Sprechzeile (0-basiert, inklusive der Anrufer-Zeile - so wie
    // persistProviderResult die Liste sieht).
    const b1Zeilen = zeilen.filter((zeile) => zeile.startsWith("[el-b1]"));
    assert.equal(b1Zeilen.length, 1, `erwartet genau eine [el-b1]-Meldung, Log: ${zeilen.join(" | ")}`);
    const b1Meldung = b1Zeilen[0];
    assert.match(b1Meldung, /treffer=1\b/, `erwartet treffer=1, Meldung: ${b1Meldung}`);
    assert.ok(b1Meldung.includes("cues=gut+klar"), `die Meldung nennt die Cues nicht: ${b1Meldung}`);
    assert.ok(b1Meldung.includes("zeilen=2"), `die Meldung nennt den Zeilenindex nicht: ${b1Meldung}`);

    // (b) [el-tags]: dieselbe Aeusserung, derselbe Treffer - die Marke [fröhlich] (B2).
    const tagsMeldung = zeilen.find((zeile) => zeile.startsWith("[el-tags]"));
    assert.ok(tagsMeldung, `keine [el-tags]-Meldung. Log: ${zeilen.join(" | ")}`);
    assert.match(tagsMeldung, /treffer=1\b/, `erwartet treffer=1, Meldung: ${tagsMeldung}`);
    assert.ok(tagsMeldung.includes("[fröhlich]"), `die Meldung nennt [fröhlich] nicht: ${tagsMeldung}`);

    // (c) Art.-50-Pin: das Transkript kommt WOERTLICH in den Store - Marke, Gedicht-Wortlaut
    // und die doppelte Ankuendigung unveraendert (Rollen wie der Bestandstest uebersetzt).
    assert.deepEqual(
      captured.transcript,
      [
        { role: "agent", message: CONVERSATION_VORFALL_2026_09_02.transcript[0].message },
        { role: "caller", message: CONVERSATION_VORFALL_2026_09_02.transcript[1].message },
        { role: "agent", message: CONVERSATION_VORFALL_2026_09_02.transcript[2].message },
      ],
      "das Vorfall-Transkript muss unveraendert gespeichert werden (MELDEN, NICHT ENTFERNEN)",
    );

    // (d) Zaehlfeld (Owner-Entscheidung 6): beide Detektoren am Call - PII-frei, nur Zaehler.
    assert.deepEqual(call.elDetectorCounts, { elTags: 1, elB1: 1 });

    // (e) R8: KEIN Vollsatz des Transkripts steht in der [el-b1]-Meldung - nur Cues und
    // Indizes duerfen gemeldet werden (PII-/Gespraechsschutz, Absolute Regel 4).
    for (const satz of vollsaetzeVon(captured.transcript)) {
      assert.ok(!b1Meldung.includes(satz), `Vollsatz geleakt: "${satz}" in "${b1Meldung}"`);
    }

    // (f) Anonymisierung der Fixture (Modulkopf-Pflicht): kein Eigentuemernamen, keine
    // Klartext-Rufnummer (Bestandsmuster: Nummern nur als maskNumber-Token).
    const fixtureSerialisiert = JSON.stringify(CONVERSATION_VORFALL_2026_09_02);
    assert.ok(!fixtureSerialisiert.includes("Antonio"), "der Eigentuemernamen (Vorname) steht in der Fixture");
    assert.ok(!fixtureSerialisiert.includes("Fotiadis"), "der Eigentuemernamen (Nachname) steht in der Fixture");
    assert.ok(
      !/(\+|")\d{7,}/.test(fixtureSerialisiert),
      "eine Klartext-Rufnummer steht in der Fixture (erlaubt sind nur maskNumber-Token)",
    );
  });
});

// AS8: Gegenprobe - dieselben Detektoren an den SAUBEREN Echtfall-Fixtures. Ohne diesen
// Fall bestuende auch eine Heuristik, die bei JEDEM Gespraech meldet. Positivkontrolle
// je Runde: es wurde wirklich ein Transkript verarbeitet (Stille ohne Inhalt bewiese
// nichts), und die Klammer-Marken-Runde trennt die Achsen: elTags zaehlt, elB1 bleibt 0.
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

  // Trennschaerfe: der Anruf-6-Datensatz (Klammer-Defekt OHNE Doppelankuendigung) zaehlt
  // NUR auf elTags - feuerte [el-b1] hier auch, messe die Heuristik Marken, nicht B1.
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

// ---- F-2 (tasks/kostenv2/befunde-kette.md): der Belegweg laeuft jetzt wirklich mit -----
// Vorher verschluckte makeCapturingStore#load ("ein Ad-hoc-Objekt ohne
// recordCallCostEvidence/callCostEvidence") den Belegweg lautlos: recordElevenLabsKosten-
// Belege faengt JEDEN Fehler fail-soft ab (KV2-4-Vertrag) - ein TypeError landete darin
// unbemerkt. F-2a/F-2b pruefen den ECHTEN Belegweg auf dem ECHTEN Poll-Pfad.

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
  // 0,10420301650668388 USD -> 10_420_301 Mikro-Cent (bereits in KV2-4 gegen dieselbe
  // Fixture gepinnt) - HIER erstmals auf dem echten Poll-Pfad, nicht nur per Direktaufruf.
  assert.equal(elZeile.betragMikroCents, CONVERSATION_DONE_MIT_KOSTEN_MIKRO_CENTS);
  assert.equal(elZeile.belegRef, CONVERSATION_DONE_MIT_KOSTEN.conversation_id);

  const telnyxSip = belege.find((zeile) => zeile.traeger === KOSTENART.TELNYX_SIP);
  assert.ok(telnyxSip, "die erwartete telnyx_sip-Zeile fehlt");
  assert.equal(telnyxSip.reife, REIFE.ERWARTET);
});
