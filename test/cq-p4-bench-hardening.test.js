import { test } from "node:test";
import assert from "node:assert/strict";
import { runChecks } from "../scripts/convo-bench/checks.mjs";
import { SCENARIOS, SCENARIO_IDS } from "../scripts/convo-bench/scenarios/index.mjs";
import { nextCalleeTurn, personaPromptFor } from "../scripts/convo-bench/persona.mjs";

const OWNER_NAME = "Jonas Beispiel";

function runResult({
  agentSays = [],
  endedVia = "turn_cap",
  actionItems = [],
  language = "de",
  direction = "outbound",
} = {}) {
  const opening = { turn: 0, sayTexts: [`Ich rufe im Auftrag von ${OWNER_NAME} an. Testanliegen.`] };
  const followUps = agentSays.map((text, i) => ({ turn: i + 1, sayTexts: [text] }));
  const agentSamples = [opening, ...followUps];
  return {
    call: { direction, language },
    ownerName: OWNER_NAME,
    transcript: agentSamples.map((s) => ({ role: "agent", text: s.sayTexts.join(" ") })),
    agentSamples,
    endedVia,
    turnCount: agentSamples.length,
    metricsParsed: [],
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

test("T-P4-1 no_transliterated_umlauts_de failt bei ASCII-Transliteration und passt bei echten Umlauten im frei generierten Agententext", () => {
  const failResult = only(
    "no_transliterated_umlauts_de",
    runResult({ agentSays: ["Ich koennte Ihnen spaeter helfen."] }),
    scenario(),
  );
  assert.equal(failResult.pass, false);
  assert.match(failResult.detail, /koenn/);
  assert.match(failResult.detail, /spaet/);

  const passResult = only(
    "no_transliterated_umlauts_de",
    runResult({ agentSays: ["Ich könnte Ihnen später helfen."] }),
    scenario(),
  );
  assert.equal(passResult.pass, true, passResult.detail);
});

test("T-P4-2 Transliteration NUR im LLM-freien Eroeffnungs-Sample faellt nicht durch (Regression F-1)", () => {
  const rr = runResult({ agentSays: [] });
  rr.agentSamples[0].sayTexts = [
    "Ich rufe im Auftrag von Jonas Beispiel an. Naechsten freien Termin fuer einen Herrenhaarschnitt vereinbaren.",
  ];
  const result = only("no_transliterated_umlauts_de", rr, scenario());
  assert.equal(result.pass, true, result.detail);
});

test("T-P4-3 kein Fehlalarm auf legitimen Buchstabenfolgen des korrekten Deutsch", () => {
  const result = only(
    "no_transliterated_umlauts_de",
    runResult({ agentSays: ["Die neue Steuer, Israel, Poet, Feuer, erneuerbar, Alexander."] }),
    scenario(),
  );
  assert.equal(result.pass, true, result.detail);
});

test("T-P4-4 no_transliterated_umlauts_de ist n/a fuer Nicht-Deutsch", () => {
  const result = only(
    "no_transliterated_umlauts_de",
    runResult({ agentSays: ["I could help you later."], language: "fr" }),
    scenario(),
  );
  assert.equal(result.pass, true);
  assert.equal(result.detail, "n/a (language=fr)");
});

test("T-P4-5 no_invented_promise trifft beide Schreibweisen ueber die Umlaut-Faltung (F-2)", () => {
  const withUmlaut = runResult({ agentSays: ["Ich rufe später wieder an."] });
  const hitOnUmlaut = only(
    "no_invented_promise",
    withUmlaut,
    scenario({ mustNotPromiseSubstrings: ["ich rufe spaeter"] }),
  );
  assert.equal(hitOnUmlaut.pass, false, hitOnUmlaut.detail);

  const withAscii = runResult({ agentSays: ["Ich rufe spaeter wieder an."] });
  const hitOnAscii = only(
    "no_invented_promise",
    withAscii,
    scenario({ mustNotPromiseSubstrings: ["ich rufe spaeter"] }),
  );
  assert.equal(hitOnAscii.pass, false, hitOnAscii.detail);

  const naResult = only("no_invented_promise", withUmlaut, scenario());
  assert.equal(naResult.detail, "n/a (keine mustNotPromiseSubstrings)");
});

test("T-P4-6 message_taken hat kein Richtungs-Gate mehr (F-4)", () => {
  const failResult = only(
    "message_taken",
    runResult({ direction: "outbound", actionItems: [] }),
    scenario(),
  );
  assert.equal(failResult.pass, false);
  assert.notEqual(failResult.detail, "n/a (outbound)");

  const passResult = only(
    "message_taken",
    runResult({ direction: "outbound", actionItems: [{ id: "a1" }] }),
    scenario(),
  );
  assert.equal(passResult.pass, true);
});

test("T-P4-7 no_early_agent_hangup respektiert die szenario-eigene Schwelle", () => {
  const tooEarly = runResult({ agentSays: ["Reaktion 1"], endedVia: "agent_hangup" });
  const failResult = only("no_early_agent_hangup", tooEarly, scenario({ minTurnsBeforeAgentHangup: 5 }));
  assert.equal(failResult.pass, false);

  const late = runResult({ agentSays: ["R1", "R2", "R3", "R4"], endedVia: "agent_hangup" });
  const passResult = only("no_early_agent_hangup", late, scenario({ minTurnsBeforeAgentHangup: 5 }));
  assert.equal(passResult.pass, true);

  const noHangup = runResult({ endedVia: "turn_cap" });
  const naResult = only("no_early_agent_hangup", noHangup, scenario({ minTurnsBeforeAgentHangup: 5 }));
  assert.equal(naResult.detail, "n/a (kein Agent-Hangup)");
});

test("T-P4-8 Registry-Integritaet: alle registrierten Szenarien referenzieren nur bekannte Checks", () => {
  for (const id of SCENARIO_IDS) {
    const sc = SCENARIOS[id];
    const rr = runResult({ direction: sc.direction, language: "de" });
    for (const r of runChecks(rr, sc)) {
      assert.ok(
        !r.detail.startsWith("unbekannter Check"),
        `${id}: Check "${r.id}" ist nicht in der Registry: ${r.detail}`,
      );
    }
  }
});

test("T-P4-9 P1b-Konsistenz-Pin: kein Szenario deklariert booked_with_nongeneric_title oder traegt expectBooking", () => {
  for (const id of SCENARIO_IDS) {
    const sc = SCENARIOS[id];
    assert.ok(
      !sc.checks.includes("booked_with_nongeneric_title"),
      `${id}: booked_with_nongeneric_title noch deklariert`,
    );
    assert.ok(!("expectBooking" in sc), `${id}: expectBooking-Property noch vorhanden`);
  }
});

test("T-P4-10 die vier neuen Szenarien sind registriert, outbound, mit nicht-leerer checks-Liste", () => {
  const NEW_SCENARIO_IDS = [
    "hold-warteschleife",
    "personenwechsel",
    "spaeter-nochmal",
    "unerfuellbare-recherche",
  ];
  for (const id of NEW_SCENARIO_IDS) {
    assert.ok(SCENARIO_IDS.includes(id), `${id} fehlt in SCENARIO_IDS`);
    const sc = SCENARIOS[id];
    assert.equal(sc.direction, "outbound", `${id}: direction ist nicht outbound`);
    assert.ok(sc.checks.length > 0, `${id}: checks-Liste ist leer`);
  }
});

test("T-P4-11 nextCalleeTurn liefert stille Turns ohne Netzaufruf, scriptedTurns behalten Vorrang (F-3)", async () => {
  const sc = { silentTurns: [1], scriptedTurns: { 0: "Skript-Antwort" } };

  const silent = await nextCalleeTurn({ apiKey: undefined, scenario: sc, transcript: [], turnIndex: 1 });
  assert.deepEqual(silent, { text: "", silent: true, refused: false, usage: null });

  const scripted = await nextCalleeTurn({ apiKey: undefined, scenario: sc, transcript: [], turnIndex: 0 });
  assert.equal(scripted.text, "Skript-Antwort");
});

test("T-P4-12 personaPromptFor liefert vor dem Wechsel den Erst-Prompt, ab fromTurnIndex den Switch-Prompt", () => {
  const withSwitch = { personaPrompt: "ERST", personaSwitch: { fromTurnIndex: 2, personaPrompt: "ZWEITE" } };
  assert.equal(personaPromptFor(withSwitch, 0), "ERST");
  assert.equal(personaPromptFor(withSwitch, 1), "ERST");
  assert.equal(personaPromptFor(withSwitch, 2), "ZWEITE");
  assert.equal(personaPromptFor(withSwitch, 3), "ZWEITE");

  const withoutSwitch = { personaPrompt: "EINZIG" };
  assert.equal(personaPromptFor(withoutSwitch, 0), "EINZIG");
  assert.equal(personaPromptFor(withoutSwitch, 99), "EINZIG");
});
