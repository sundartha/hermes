// INBOX-P2 (Review-Blocker S1-B): vier neu gebaute Verhalten von ops.takeInboxEntries
// waren bislang von KEINER Assertion gepinnt - reine ops-Tests gegen seedState, ohne
// Server (Muster C3, test/inbox-poll-race.test.js). Jeder Fall deckt genau EIN
// Verhalten, das ein Regress unbemerkt kippen koennte.
import test from "node:test";
import assert from "node:assert/strict";
import { seedState, seedCall } from "./helpers.js";
import * as ops from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const CALLER = "+4915112345678"; // fiktiv, Bestandsstil
const NOW = "2026-08-21T10:00:00.000Z";
const POLL_LIMIT = 2;

test("INBOX-P2 D1: action_items enthaelt nur die OFFENE Nachricht, action_required wird true", () => {
  const call = seedCall({
    id: "call_action_items",
    direction: "inbound",
    from: CALLER,
    status: "completed",
    startedAt: "2026-08-21T09:00:00.000Z",
    inboxEntryAt: NOW,
    inboxSeenAt: null,
  });
  const state = seedState({ calls: [call] });
  ops.addActionItem(state, call.id, "Ruecktruf bis Freitag");
  const { item: erledigt } = ops.addActionItem(state, call.id, "Termin bestaetigt");
  ops.toggleActionItem(state, erledigt.id);

  const { entries } = ops.takeInboxEntries(state, BOOTSTRAP_TENANT_ID, {
    limit: 10,
    includeSeen: false,
  });

  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].action_items, ["Ruecktruf bis Freitag"], "nur die offene Nachricht, richtiges Feld gemappt");
  assert.equal(entries[0].action_required, true);
});

test("INBOX-P2 D2: Call ohne Zusammenfassung liefert summary_unavailable=true", () => {
  const call = seedCall({
    id: "call_ohne_summary",
    direction: "inbound",
    from: CALLER,
    status: "completed",
    startedAt: "2026-08-21T09:00:00.000Z",
    summary: null,
    inboxEntryAt: NOW,
    inboxSeenAt: null,
  });
  const state = seedState({ calls: [call] });

  const { entries } = ops.takeInboxEntries(state, BOOTSTRAP_TENANT_ID, {
    limit: 10,
    includeSeen: false,
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].summary, null);
  assert.equal(entries[0].summary_unavailable, true, "E-2/Pre-Mortem R-1: technisch gescheiterte Zusammenfassung");
});

test("INBOX-P2 D3: limit deckelt die Auslieferung, remaining und marked zaehlen nur das Ausgelieferte", () => {
  const calls = ["call_limit_a", "call_limit_b", "call_limit_c"].map((id, index) =>
    seedCall({
      id,
      direction: "inbound",
      from: CALLER,
      status: "completed",
      startedAt: `2026-08-21T09:0${index}:00.000Z`,
      inboxEntryAt: NOW,
      inboxSeenAt: null,
    }),
  );
  const state = seedState({ calls });

  const { entries, remaining, marked } = ops.takeInboxEntries(state, BOOTSTRAP_TENANT_ID, {
    limit: POLL_LIMIT,
    includeSeen: false,
  });

  assert.equal(entries.length, POLL_LIMIT, "nur 'limit' Eintraege werden ausgeliefert");
  assert.equal(remaining, 1, "der dritte Kandidat bleibt uebrig");
  assert.equal(marked, POLL_LIMIT, "markiert wird NUR, was ausgeliefert wurde");
  const dritter = state.calls.find((call) => call.id === "call_limit_c");
  assert.equal(dritter.inboxSeenAt, null, "der nicht ausgelieferte Call bleibt unmarkiert");
});

test("INBOX-P2 D4: Eintraege kommen aufsteigend nach startedAt, unabhaengig von der Seed-Reihenfolge", () => {
  const spaeter = seedCall({
    id: "call_order_spaeter",
    direction: "inbound",
    from: CALLER,
    status: "completed",
    startedAt: "2026-08-21T09:02:00.000Z",
    inboxEntryAt: NOW,
    inboxSeenAt: null,
  });
  const frueher = seedCall({
    id: "call_order_frueher",
    direction: "inbound",
    from: CALLER,
    status: "completed",
    startedAt: "2026-08-21T09:00:00.000Z",
    inboxEntryAt: NOW,
    inboxSeenAt: null,
  });
  const mitte = seedCall({
    id: "call_order_mitte",
    direction: "inbound",
    from: CALLER,
    status: "completed",
    startedAt: "2026-08-21T09:01:00.000Z",
    inboxEntryAt: NOW,
    inboxSeenAt: null,
  });
  // Seed-Reihenfolge ist bewusst NICHT die Start-Reihenfolge.
  const state = seedState({ calls: [spaeter, frueher, mitte] });

  const { entries } = ops.takeInboxEntries(state, BOOTSTRAP_TENANT_ID, {
    limit: 10,
    includeSeen: false,
  });

  assert.deepEqual(
    entries.map((entry) => entry.call_id),
    ["call_order_frueher", "call_order_mitte", "call_order_spaeter"],
    "aufsteigend nach startedAt, nicht nach Seed- oder inboxEntryAt-Reihenfolge",
  );
});

// Review-Blocker S1-1: die Whitelist ist als FORM (exakter Schluesselsatz) bislang
// UNGEPRUEFT - R6 arbeitet mit einer Substring-Blacklist plus blossen `in`-Praesenz-
// pruefungen, die ein spaeter hinzugefuegtes Feld mit unverfaenglichem Namen passieren
// liessen. Muster: test/al-p11-result-card.test.js:332 (deepEqual auf sortierten Keys).
// Zusaetzlich pinnt dieser Fall die bislang assertionslosen Felder caller/started_at
// gegen ihre Seed-Werte (call.from/call.startedAt) - eine Vertauschung auf call.to bzw.
// call.endedAt blieb bislang unbemerkt gruen.
test("INBOX-P2 S1-1: die Projektion traegt EXAKT die Whitelist-Felder, caller/started_at/summary stimmen mit den Seed-Werten", () => {
  const call = seedCall({
    id: "call_whitelist_pin",
    direction: "inbound",
    from: CALLER,
    to: "+15005550006",
    status: "completed",
    startedAt: "2026-08-21T09:05:00.000Z",
    endedAt: "2026-08-21T09:10:00.000Z",
    summary: "Rueckruf erbeten",
    result: {
      outcome: "Termin vereinbart",
      commitments: ["Unterlagen senden"],
      counterpartyCommitments: ["Rueckruf bis Montag"],
      openPoints: ["Adresse bestaetigen"],
      nextStep: "Termin im Kalender eintragen",
      facts: ["GEHEIM-FACT-PIN"],
    },
    inboxEntryAt: NOW,
    inboxSeenAt: null,
  });
  const state = seedState({ calls: [call] });
  ops.addActionItem(state, call.id, "Ruecktruf bis Freitag");

  const { entries } = ops.takeInboxEntries(state, BOOTSTRAP_TENANT_ID, {
    limit: 10,
    includeSeen: false,
  });

  assert.equal(entries.length, 1);
  assert.deepEqual(
    Object.keys(entries[0]).sort(),
    [
      "action_items",
      "action_required",
      "call_id",
      "caller",
      "commitments",
      "counterparty_commitments",
      "next_step",
      "open_points",
      "outcome",
      "started_at",
      "summary",
      "summary_unavailable",
    ],
    "exakt die Whitelist - kein Feld mehr, keins weniger",
  );
  assert.equal(entries[0].caller, CALLER, "caller kommt von call.from, nicht von call.to");
  assert.equal(
    entries[0].started_at,
    "2026-08-21T09:05:00.000Z",
    "started_at kommt von call.startedAt, nicht von call.endedAt",
  );
  assert.equal(entries[0].summary, "Rueckruf erbeten");
});
