import { test } from "node:test";
import assert from "node:assert/strict";
import * as ops from "../../src/store/state-ops.js";

function handState() {
  return { calls: [{ id: "c1", actionItemIds: [] }, { id: "c2", actionItemIds: [] }], actionItems: [] };
}

test("GQ-P4/B1 zweimal dieselbe Nachricht -> ein Item, duplicate:true", () => {
  const s = handState();
  const first = ops.addActionItem(s, "c1", "Rueckruf bei Herrn Meier");
  const second = ops.addActionItem(s, "c1", "Rueckruf bei Herrn Meier");

  assert.equal(s.actionItems.length, 1);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.item.id, first.item.id);
  assert.equal(s.calls[0].actionItemIds.length, 1);
});

test("GQ-P4/B1 belanglose Abweichungen zaehlen als gleich", () => {
  const s = handState();
  ops.addActionItem(s, "c1", "Rueckruf bei Herrn Meier");
  const result = ops.addActionItem(s, "c1", "  rueckruf   bei Herrn Meier.  ");

  assert.equal(s.actionItems.length, 1);
  assert.equal(result.duplicate, true);
});

test("GQ-P4/B1 GEGENBEWEIS: zwei verschiedene Nachrichten -> zwei Items", async () => {
  const s1 = handState();
  ops.addActionItem(s1, "c1", "Rueckruf bei Herrn Meier");
  ops.addActionItem(s1, "c1", "Rueckruf bei Frau Meier");
  assert.equal(s1.actionItems.length, 2);

  const s2 = handState();
  ops.addActionItem(s2, "c1", "Termin am Montag");
  ops.addActionItem(s2, "c1", "Termin am Dienstag");
  assert.equal(s2.actionItems.length, 2);

  const s3 = handState();
  ops.addActionItem(s3, "c1", "Rueckruf");
  ops.addActionItem(s3, "c1", "Rueckruf bei Herrn Meier");
  assert.equal(s3.actionItems.length, 2, "die Regel ist Gleichheit, keine Aehnlichkeit/Praefix");
});

test("GQ-P4/B1 Dedup gilt pro Call", () => {
  const s = handState();
  ops.addActionItem(s, "c1", "Rueckruf bei Herrn Meier");
  ops.addActionItem(s, "c2", "Rueckruf bei Herrn Meier");

  assert.equal(s.actionItems.length, 2);
});

test("GQ-P4/B1 Grenzfaelle", () => {
  const s = handState();
  assert.doesNotThrow(() => ops.addActionItem(s, "c1", null));
  assert.doesNotThrow(() => ops.addActionItem(s, "c1", undefined));
  const r = ops.addActionItem(s, "c1", "");

  assert.equal(s.actionItems.length, 1, "null/undefined/'' normalisieren auf dieselbe leere Nachricht");
  assert.equal(r.duplicate, true);
});
