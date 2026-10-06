import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  createCall,
  markAnswered,
  markSummarySmsSent,
  markBilled,
} from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const TIMESTAMP_FIELDS = ["answeredAt", "summarySmsSentAt", "billedAt"];

const SETTERS = [
  { name: "markAnswered", fn: markAnswered, field: "answeredAt" },
  { name: "markSummarySmsSent", fn: markSummarySmsSent, field: "summarySmsSentAt" },
  { name: "markBilled", fn: markBilled, field: "billedAt" },
];

const isIso = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));

const freshCall = (s) =>
  createCall(s, {
    direction: "outbound",
    from: "+491700000000",
    to: "+491701111111",
    tenantId: BOOTSTRAP_TENANT_ID,
  });

for (const { name, fn, field } of SETTERS) {
  test(`${name}: setzt GENAU ${field} einmalig (ISO), laesst die anderen Marker null`, () => {
    const s = makeDefaultState();
    const c = freshCall(s);
    assert.equal(c[field], null, "frischer Call: Ziel-Marker leer");

    const res = fn(s, c.id);
    assert.equal(res.changed, true, "erstes Setzen aendert den Record");
    assert.equal(res.call, c, "liefert den betroffenen Call zurueck");
    assert.ok(isIso(c[field]), `${field} ist eine ISO-Zeit`);
    for (const other of TIMESTAMP_FIELDS) {
      if (other !== field) assert.equal(c[other], null, `${other} bleibt unberuehrt`);
    }
  });

  test(`${name}: idempotent - zweiter Aufruf No-op, Zeitstempel stabil`, () => {
    const s = makeDefaultState();
    const c = freshCall(s);
    const first = fn(s, c.id);
    const stamp = first.call[field];

    const second = fn(s, c.id);
    assert.equal(second.changed, false, "zweiter Aufruf ist No-op (kein Wrapper-save)");
    assert.equal(second.call[field], stamp, "Zeitstempel unveraendert (gesetzter gewinnt)");
  });

  test(`${name}: unbekannter Call -> changed=false, call=null, kein Throw`, () => {
    const s = makeDefaultState();
    const res = fn(s, "call_does_not_exist");
    assert.equal(res.changed, false);
    assert.equal(res.call, null);
  });
}
