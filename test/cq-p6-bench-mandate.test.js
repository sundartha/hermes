import { test } from "node:test";
import assert from "node:assert/strict";
import { runChecks } from "../scripts/convo-bench/checks.mjs";
import { SCENARIOS, SCENARIO_IDS } from "../scripts/convo-bench/scenarios/index.mjs";

const withActionItems = (actionItems) => ({ storeSnapshot: { actionItems } });

const only = (id, rr, checks = [id]) => runChecks(rr, { checks })[0];

const OWNER_NAME = "Jonas Beispiel";
function fullRunResult(direction) {
  const opening = { turn: 0, sayTexts: [`Ich rufe im Auftrag von ${OWNER_NAME} an. Testanliegen.`] };
  return {
    call: { direction, language: "de" },
    ownerName: OWNER_NAME,
    transcript: [{ role: "agent", text: opening.sayTexts.join(" ") }],
    agentSamples: [opening],
    endedVia: "turn_cap",
    turnCount: 1,
    metricsParsed: [],
    storeSnapshot: { actionItems: [], calendarNewEvents: [] },
  };
}

test("B1 no_message_taken failt bei vorhandenen actionItems, passt bei keinen", () => {
  const failResult = only("no_message_taken", withActionItems([{ id: "a1" }]));
  assert.equal(failResult.pass, false, failResult.detail);
  assert.match(failResult.detail, /1 actionItems trotz Mandat/);

  const passResult = only("no_message_taken", withActionItems([]));
  assert.equal(passResult.pass, true, passResult.detail);
});

test("B2 no_message_taken und message_taken sind exakt komplementaer (gemeinsame Zaehlquelle)", () => {
  for (const actionItems of [[], [{ id: "a1" }], [{ id: "a1" }, { id: "a2" }]]) {
    const rr = withActionItems(actionItems);
    const messageTaken = only("message_taken", rr);
    const noMessageTaken = only("no_message_taken", rr);
    assert.notEqual(
      messageTaken.pass,
      noMessageTaken.pass,
      `actionItems=${actionItems.length}: message_taken=${messageTaken.pass} muss das Gegenteil von no_message_taken=${noMessageTaken.pass} sein`,
    );
  }
});

test("B3 beide neuen Szenarien sind registriert, outbound, mit nicht-leerer checks-Liste", () => {
  for (const id of ["mandat-innerhalb", "mandat-ausserhalb"]) {
    assert.ok(SCENARIO_IDS.includes(id), `${id} fehlt in SCENARIO_IDS`);
    const sc = SCENARIOS[id];
    assert.equal(sc.direction, "outbound", `${id}: direction ist nicht outbound`);
    assert.ok(sc.checks.length > 0, `${id}: checks-Liste ist leer`);
  }
});

test("B4 beide Szenarien tragen ein Mandat mit decide_freely; mandat-innerhalb deklariert no_message_taken, mandat-ausserhalb message_taken", () => {
  const innerhalb = SCENARIOS["mandat-innerhalb"];
  const ausserhalb = SCENARIOS["mandat-ausserhalb"];
  assert.ok(innerhalb.mandate?.decide_freely, "mandat-innerhalb traegt mandate.decide_freely");
  assert.ok(ausserhalb.mandate?.decide_freely, "mandat-ausserhalb traegt mandate.decide_freely");
  assert.ok(
    innerhalb.checks.includes("no_message_taken"),
    "mandat-innerhalb deklariert no_message_taken",
  );
  assert.ok(
    ausserhalb.checks.includes("message_taken"),
    "mandat-ausserhalb deklariert message_taken",
  );
});

test("B5 Registry-Integritaet: beide Mandat-Szenarien referenzieren nur bekannte Checks", () => {
  for (const id of ["mandat-innerhalb", "mandat-ausserhalb"]) {
    const sc = SCENARIOS[id];
    const rr = fullRunResult(sc.direction);
    for (const r of runChecks(rr, sc)) {
      assert.ok(
        !r.detail.startsWith("unbekannter Check"),
        `${id}: Check "${r.id}" ist nicht in der Registry: ${r.detail}`,
      );
    }
  }
});
