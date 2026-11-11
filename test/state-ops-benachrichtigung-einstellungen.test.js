import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDefaultState, addNotification } from "../src/store/state-ops.js";
import { benachrichtigungHinzufuegen } from "../src/store/zustand/einstellungen.js";
import { MAX_NOTIFICATIONS } from "../src/store/defaults.js";

test("addNotification: neueste vorn, callId fehlend wird null, id und Zeit gesetzt", () => {
  const s = makeDefaultState();
  addNotification(s, "erste", "a");
  addNotification(s, "zweite", "b", "call_1");
  assert.deepEqual(
    s.notifications.map((n) => [n.title, n.body, n.callId]),
    [
      ["zweite", "b", "call_1"],
      ["erste", "a", null],
    ],
  );
  assert.match(s.notifications[0].id, /^nt_/);
  assert.ok(!Number.isNaN(Date.parse(s.notifications[0].at)));
});

test("addNotification: Puffer wird auf MAX_NOTIFICATIONS gekappt, Aeltestes faellt weg", () => {
  const s = makeDefaultState();
  for (let i = 0; i < MAX_NOTIFICATIONS + 3; i += 1) addNotification(s, `t${i}`, "");
  assert.equal(s.notifications.length, MAX_NOTIFICATIONS);
  assert.equal(s.notifications[0].title, `t${MAX_NOTIFICATIONS + 2}`);
  assert.equal(s.notifications.at(-1).title, "t3");
});

test("benachrichtigungHinzufuegen nimmt ein Objekt und wirkt wie addNotification", () => {
  const s = makeDefaultState();
  benachrichtigungHinzufuegen(s, { title: "t", body: "b", callId: "c" });
  assert.deepEqual(
    s.notifications.map((n) => [n.title, n.body, n.callId]),
    [["t", "b", "c"]],
  );
});
