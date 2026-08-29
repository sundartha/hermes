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
import { FROM_SOURCE } from "../src/store/state-ops.js";
import { terminateAndBillCall } from "../src/telephony/call-termination.js";
import { MS_PER_SECOND } from "../src/utils/timer.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { waitUntil, withFetch } from "./helpers.js";
import {
  CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES,
  CONVERSATION_DONE_WITH_ANALYSIS,
  CONVERSATION_FAILED_INVALID_DESTINATION,
  CONVERSATION_MIT_KLAMMER_MARKEN,
} from "./fixtures/elevenlabs-conversations.js";

const ACCOUNT = { apiKey: "test-key", apiBase: "https://el.test" };
const HTTP_OK = 200;

// Faengt genau die Werte ab, die persistProviderResult/applyAnsweredAnchor an den Store
// weiterreichen - dieselben Felder, die get_transcript und die Kostendecke lesen. Der Call
// entsteht HIER (statt als Parameter uebergeben zu werden) - sonst waere das Mutieren
// seiner Felder im endCallRecord-Fake unten ein no-param-reassign-Verstoss (P6/F2).
function makeCapturingStore({ id, elevenlabsConversationId, answeredAt }) {
  const call = {
    id,
    status: "active",
    elevenlabsConversationId,
    answeredAt,
    startedAt: answeredAt,
    endedAt: null,
  };
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
    load: () => ({ calls: [call] }),
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
  };
  return { call, store, captured };
}

// EIN Poll-Takt gegen EINEN Gespraechs-Datensatz (Fixture) - der Anbieter antwortet sofort
// mit dem uebergebenen Datensatz, egal welche Kennung angefragt wird (jeder Test hier
// fragt genau eine Kennung ab).
async function pollFixtureConversation(fixture) {
  const { call, store, captured } = makeCapturingStore({
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
  return { call, captured };
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
