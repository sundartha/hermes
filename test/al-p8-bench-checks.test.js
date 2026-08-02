// AL-P8 ("Der Bench misst den Pfad, der live ist"): deckt die fuenf neuen
// transportunabhaengigen Bench-Checks ab (MEASUREMENT_CHECKS + recap_present) sowie die
// Registry-Integritaet ueber ALLE registrierten Szenarien (inkl. der drei neuen). Rein,
// netz- und spawn-frei (Muster test/cq-p4-bench-hardening.test.js): checks.mjs zieht nur
// src/i18n/locales.js -> src/store/defaults.js (beide rein).
//
// AL-D3: erweitert um die vier Werkzeug-Checks (consult_fired/no_consult_fired/
// lookup_fired/no_lookup_fired) + lookup_turn_not_silent (AL-D3-11..13), die
// Werkzeugnamen-Kopplung an die echten Produkt-Exporte (AL-D3-14) und die
// Apparat-Integritaet ueber ALLE Szenarien inkl. der drei neuen (AL-D3-15). Die
// metricsTurns-Fixture traegt seither Objekte ({roundtrips, tools}) statt nackter
// Zahlen - EINE Form fuer alle Turn-Metrik-Tests dieser Datei (G5), keine zweite,
// abweichende Fixture-Form.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  runChecks,
  MEASUREMENT_CHECKS,
  GET_CONSULT_TOOL_NAME,
  LOOK_UP_TOOL_NAME,
} from "../scripts/convo-bench/checks.mjs";
import { SCENARIOS, SCENARIO_IDS } from "../scripts/convo-bench/scenarios/index.mjs";
import { tempDataDir, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER_NAME = "Jonas Beispiel";

// Vollstaendiges runResult-Geruest (Muster cq-p4-bench-hardening.test.js runResult):
// agentSamples[0] ist immer die LLM-freie Eroeffnung, agentSays fuellt die FREI
// GENERIERTEN Folge-Turns ab agentSamples[1]. metricsTurns: Array<{roundtrips?, tools?}>
// (AL-D3) - EIN Eintrag je Turn-Metrikzeile.
function runResult({
  openingText = `Ich rufe im Auftrag von ${OWNER_NAME} an. Testanliegen.`,
  agentSays = [],
  endedVia = "turn_cap",
  actionItems = [],
  language = "de",
  direction = "outbound",
  metricsTurns = [],
} = {}) {
  const opening = { turn: 0, sayTexts: [openingText] };
  const followUps = agentSays.map((text, i) => ({ turn: i + 1, sayTexts: [text] }));
  const agentSamples = [opening, ...followUps];
  return {
    call: { direction, language },
    ownerName: OWNER_NAME,
    transcript: agentSamples.map((s) => ({ role: "agent", text: s.sayTexts.join(" ") })),
    agentSamples,
    endedVia,
    turnCount: agentSamples.length,
    metricsParsed: metricsTurns.map((payload) => ({ kind: "turn", payload })),
    storeSnapshot: { actionItems, calendarNewEvents: [] },
  };
}

function scenario(overrides = {}) {
  return {
    id: "test-scenario",
    direction: "outbound",
    maxTurns: 8,
    expectDegradation: false,
    mustNotAskSubstrings: [],
    mustNotPromiseSubstrings: [],
    checks: [],
    ...overrides,
  };
}

const only = (id, rr, sc) => runChecks(rr, { ...sc, checks: [id] })[0];

test("AL-P8-1 opening_chars_before_yield liefert die Zeichenzahl der Eroeffnung als value und passt ohne maxOpeningChars (n/a)", () => {
  const result = only("opening_chars_before_yield", runResult({ openingText: "Zwölf Zeichen" }), scenario());
  assert.equal(result.pass, true);
  assert.equal(result.value, "Zwölf Zeichen".length);
  assert.match(result.detail, /n\/a \(kein maxOpeningChars/);
});

test("AL-P8-2 opening_chars_before_yield failt, wenn die Eroeffnung ueber scenario.maxOpeningChars liegt", () => {
  const opening = "Diese Eroeffnung ist definitiv laenger als zehn Zeichen.";
  const failResult = only("opening_chars_before_yield", runResult({ openingText: opening }), scenario({ maxOpeningChars: 10 }));
  assert.equal(failResult.pass, false);
  assert.equal(failResult.value, opening.length);

  const passResult = only("opening_chars_before_yield", runResult({ openingText: "Kurz." }), scenario({ maxOpeningChars: 10 }));
  assert.equal(passResult.pass, true);
});

test("AL-P8-3 handoff_rate zaehlt Weitergabe-Phrasen umlaut-gefaltet und liefert den Anteil als value", () => {
  const rr = runResult({ agentSays: ["Ich gebe das weiter.", "Das melde sich bei Ihnen.", "Alles klar, danke."] });
  const result = only("handoff_rate", rr, scenario());
  assert.equal(result.pass, true); // reine Messung, kein Hard-Gate
  assert.equal(result.value, Math.round((2 / 3) * 1e4) / 1e4); // auf 4 Stellen gerundet

  const foldedRr = runResult({ agentSays: ["Ich gebe das weiter."] });
  const folded = only("handoff_rate", foldedRr, scenario());
  assert.equal(folded.value, 1);
});

test("AL-P8-4 handoff_rate ist n/a bei language!==de (die Phrasenliste ist deutsch)", () => {
  const result = only("handoff_rate", runResult({ agentSays: ["I'll pass it on."], language: "fr" }), scenario());
  assert.equal(result.pass, true);
  assert.equal(result.value, null);
  assert.equal(result.detail, "n/a (language=fr)");
});

test("AL-P8-5 recap_present trifft nur im LETZTEN frei generierten Agenten-Turn", () => {
  const rr = runResult({ agentSays: ["Dienstag 14 Uhr passt, ich notiere das.", "Danke, auf Wiederhören."] });
  const failResult = only("recap_present", rr, scenario({ recapSubstrings: ["ich notiere"] }));
  assert.equal(failResult.pass, false, failResult.detail); // Recap steht NICHT im letzten Turn

  const passResult = only(
    "recap_present",
    runResult({ agentSays: ["Alles klar.", "Ich notiere Dienstag 14 Uhr."] }),
    scenario({ recapSubstrings: ["ich notiere"] }),
  );
  assert.equal(passResult.pass, true, passResult.detail);
  assert.equal(passResult.value, true);
});

// AL-P12: memory_fact_recalled (Muster recap_present/AL-P8-5/6 - Deklaration UEBER ALLE
// frei generierten Turns statt nur den letzten, weil ein genannter Fakt frueh im
// Gespraech genauso zaehlt wie im Abschluss).
test("AL-P12-B1 memory_fact_recalled ist n/a ohne scenario.expectedMemoryPhrases", () => {
  const result = only("memory_fact_recalled", runResult({ agentSays: ["Danke, tschuess."] }), scenario());
  assert.equal(result.pass, true);
  assert.equal(result.value, null);
  assert.equal(result.detail, "n/a (keine expectedMemoryPhrases)");
});

test("AL-P12-B2 memory_fact_recalled: Treffer/kein Treffer ueber ALLE frei generierten Turns", () => {
  const rr = runResult({
    agentSays: ["Ich sehe hier Reklamationsnummer 4711.", "Danke, auf Wiederhören."],
  });
  const passResult = only(
    "memory_fact_recalled",
    rr,
    scenario({ expectedMemoryPhrases: ["4711"] }),
  );
  assert.equal(passResult.pass, true, passResult.detail);
  assert.equal(passResult.value, 1);

  const failResult = only(
    "memory_fact_recalled",
    rr,
    scenario({ expectedMemoryPhrases: ["reklamationsnummer 9999"] }),
  );
  assert.equal(failResult.pass, false, failResult.detail);
  assert.equal(failResult.value, 0);
});

test("AL-P8-6 recap_present ist n/a ohne scenario.recapSubstrings", () => {
  const result = only("recap_present", runResult({ agentSays: ["Danke, tschuess."] }), scenario());
  assert.equal(result.pass, true);
  assert.equal(result.value, null);
  assert.equal(result.detail, "n/a (keine recapSubstrings)");
});

test("AL-P8-7 one_question_per_turn zaehlt Turns mit mehr als einer Frage und failt erst ab maxMultiQuestionTurns", () => {
  const rr = runResult({
    agentSays: ["Passt Ihnen Dienstag? Oder lieber Mittwoch?", "Alles klar.", "Wann genau? Um wieviel Uhr?"],
  });
  const measurementOnly = only("one_question_per_turn", rr, scenario());
  assert.equal(measurementOnly.pass, true); // ohne Schwelle: reine Messung
  assert.equal(measurementOnly.value, 2);

  const failResult = only("one_question_per_turn", rr, scenario({ maxMultiQuestionTurns: 0 }));
  assert.equal(failResult.pass, false);

  const passResult = only(
    "one_question_per_turn",
    runResult({ agentSays: ["Passt Ihnen Dienstag?"] }),
    scenario({ maxMultiQuestionTurns: 0 }),
  );
  assert.equal(passResult.pass, true);
});

test("AL-P8-8 roundtrips_per_turn mittelt die metrics-turn-Zeilen und ist n/a ohne turn-Metriken", () => {
  const rr = runResult({ metricsTurns: [{ roundtrips: 1 }, { roundtrips: 2 }, { roundtrips: 3 }] });
  const result = only("roundtrips_per_turn", rr, scenario());
  assert.equal(result.pass, true);
  assert.equal(result.value, 2);

  const naResult = only("roundtrips_per_turn", runResult({ metricsTurns: [] }), scenario());
  assert.equal(naResult.value, null);
  assert.equal(naResult.detail, "n/a (keine turn-Metriken)");
});

test("AL-P8-9 die Eroeffnung (Sample 0) zaehlt bei keinem der neuen Checks als frei generierter Agententext", () => {
  const rr = runResult({ openingText: "Ich gebe das weiter. Passt Ihnen Dienstag? Oder Mittwoch?", agentSays: [] });
  const handoff = only("handoff_rate", rr, scenario());
  assert.equal(handoff.value, null, "keine frei generierten Turns -> n/a, die Eroeffnung zaehlt nicht mit");

  const oneQuestion = only("one_question_per_turn", rr, scenario());
  assert.equal(oneQuestion.value, 0, "die Mehrfach-Frage steht nur in der Eroeffnung, nicht in einem frei generierten Turn");

  const recap = only("recap_present", rr, scenario({ recapSubstrings: ["ich gebe das weiter"] }));
  assert.equal(recap.value, false, "die Phrase steht nur in der Eroeffnung, zaehlt also nicht als Recap-Treffer");
});

test("AL-P8-10 jede ID in MEASUREMENT_CHECKS existiert in der CHECKS-Registry", () => {
  const rr = runResult();
  for (const r of runChecks(rr, scenario({ checks: MEASUREMENT_CHECKS }))) {
    assert.ok(!r.detail.startsWith("unbekannter Check"), `MEASUREMENT_CHECKS: "${r.id}" ist nicht in der Registry`);
  }
});

test("AL-P8-11 jede von einem Szenario deklarierte Check-ID existiert in der CHECKS-Registry", () => {
  for (const id of SCENARIO_IDS) {
    const sc = SCENARIOS[id];
    const rr = runResult({ direction: sc.direction, language: "de" });
    for (const r of runChecks(rr, sc)) {
      assert.ok(!r.detail.startsWith("unbekannter Check"), `${id}: Check "${r.id}" ist nicht in der Registry: ${r.detail}`);
    }
  }
});

test("AL-P8-12 Bestands-Checks tragen weiterhin kein value-Feld (additiver Vertrag)", () => {
  const BESTANDS_CHECK_IDS = [
    "disclosure_first",
    "no_raw_iso_date_spoken",
    "farewell_before_terminal",
    "no_verbatim_question_repeat",
    "no_redundant_ask_about_briefed_info",
    "no_invented_promise",
    "turn_count_within_budget",
    "no_tool_loop_exhaustion",
    "inbound_no_disclosure_leak",
    "message_taken",
    "no_message_taken",
    "no_hangup_on_unintelligible_reply",
    "no_early_agent_hangup",
    "no_transliterated_umlauts_de",
  ];
  const rr = runResult({ agentSays: ["Testantwort."], actionItems: [{ id: "a1" }] });
  for (const r of runChecks(rr, scenario({ checks: BESTANDS_CHECK_IDS, mandate: undefined }))) {
    assert.equal(r.value, undefined, `Bestands-Check "${r.id}" traegt ueberraschend ein value-Feld`);
  }
});

// ---------- AL-D3: die vier Werkzeug-Checks + der Ruhe-Check ----------

test("AL-D3-11 consult_fired/no_consult_fired lesen tools aus der Turn-Metrik", () => {
  const withConsult = runResult({
    agentSays: ["Ok."],
    metricsTurns: [{ roundtrips: 2, tools: [GET_CONSULT_TOOL_NAME] }],
  });
  assert.equal(only("consult_fired", withConsult, scenario()).pass, true);
  assert.equal(only("no_consult_fired", withConsult, scenario()).pass, false);

  const withoutConsult = runResult({
    agentSays: ["Ok."],
    metricsTurns: [{ roundtrips: 1, tools: ["take_message"] }],
  });
  assert.equal(only("consult_fired", withoutConsult, scenario()).pass, false);
  assert.equal(only("no_consult_fired", withoutConsult, scenario()).pass, true);
});

test("AL-D3-12 lookup_fired/no_lookup_fired lesen tools aus der Turn-Metrik", () => {
  const withLookup = runResult({
    agentSays: ["Einen Moment."],
    metricsTurns: [{ roundtrips: 2, tools: [LOOK_UP_TOOL_NAME] }],
  });
  assert.equal(only("lookup_fired", withLookup, scenario()).pass, true);
  assert.equal(only("no_lookup_fired", withLookup, scenario()).pass, false);

  const withoutLookup = runResult({
    agentSays: ["Alles klar."],
    metricsTurns: [{ roundtrips: 1, tools: ["take_message"] }],
  });
  assert.equal(only("lookup_fired", withoutLookup, scenario()).pass, false);
  assert.equal(only("no_lookup_fired", withoutLookup, scenario()).pass, true);
});

test("AL-D3-13 lookup_turn_not_silent: gruen mit Text, rot bei leerem sayTexts, n/a-gruen ohne look_up, rot bei abweichender Turn-Zaehlung", () => {
  const spoken = runResult({
    agentSays: ["Einen Moment, ich sehe das nach."],
    metricsTurns: [{ roundtrips: 2, tools: [LOOK_UP_TOOL_NAME] }],
  });
  assert.equal(only("lookup_turn_not_silent", spoken, scenario()).pass, true);

  const silent = runResult({
    agentSays: [""],
    metricsTurns: [{ roundtrips: 2, tools: [LOOK_UP_TOOL_NAME] }],
  });
  const silentResult = only("lookup_turn_not_silent", silent, scenario());
  assert.equal(silentResult.pass, false, silentResult.detail);

  const noLookup = runResult({
    agentSays: ["Alles klar."],
    metricsTurns: [{ roundtrips: 1, tools: ["take_message"] }],
  });
  assert.equal(only("lookup_turn_not_silent", noLookup, scenario()).pass, true);

  const mismatched = runResult({
    agentSays: ["Erste.", "Zweite."],
    metricsTurns: [{ roundtrips: 1, tools: [] }],
  });
  const mismatchedResult = only("lookup_turn_not_silent", mismatched, scenario());
  assert.equal(mismatchedResult.pass, false);
  assert.match(mismatchedResult.detail, /Turn-Zaehlung weicht ab/);
});

let productGetConsultToolName, productLookUpToolName;
before(async () => {
  // AL-D3-14: dynamischer Import NACH gesetztem DATA_DIR (Muster al-p10b-lookup.test.js) -
  // src/consult/in-call.js und src/research/in-call.js ziehen config.js/store.js, die
  // eine gueltige DATA_DIR erwarten. Reiner Konstanten-Vergleich, kein Store-Zugriff.
  process.env.DATA_DIR = tempDataDir(
    seedState({ calls: [], tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }] }),
  );
  ({ GET_CONSULT_TOOL_NAME: productGetConsultToolName } = await import("../src/consult/in-call.js"));
  ({ LOOK_UP_TOOL_NAME: productLookUpToolName } = await import("../src/research/in-call.js"));
});

test("AL-D3-14 die lokalen Werkzeug-Konstanten in checks.mjs stimmen mit den Produkt-Exporten ueberein", () => {
  assert.equal(GET_CONSULT_TOOL_NAME, productGetConsultToolName);
  assert.equal(LOOK_UP_TOOL_NAME, productLookUpToolName);
});

test("AL-D3-15 Apparat-Integritaet: jede registrierte SCENARIOS-id ist konsistent (id, direction, checks-Array)", () => {
  for (const id of SCENARIO_IDS) {
    const sc = SCENARIOS[id];
    assert.equal(sc.id, id, `${id}: SCENARIOS[id].id weicht ab`);
    assert.ok(sc.direction, `${id}: direction fehlt`);
    assert.ok(Array.isArray(sc.checks), `${id}: checks ist kein Array`);
  }
});
