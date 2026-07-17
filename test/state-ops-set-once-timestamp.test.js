// PA-5 (S2-setonce, G5): der geteilte setOnceTimestamp-Helfer speist die drei strukturell
// identischen Marker-Setter markAnswered/markSummarySmsSent/markBilled. Dieser Test nagelt
// die drei OEFFENTLICHEN Setter (nicht den privaten Helfer) fest und assertiert je auf
// call[fieldName] - so faengt er einen vertauschten Feldnamen (PM-6: markBilled schriebe
// faelschlich summarySmsSentAt), den ein reiner changed-Flag-Check durchrutschen liesse.
// Reiner Refactor: die bestehenden Idempotenz-Tests (store-pg-billing-idempotent,
// f2-p9-dedup-persist) bleiben UNVERAENDERT gruen; dieser Test deckt zusaetzlich markAnswered
// und die Feldnamen-Zuordnung aller drei Setter ab. Offline/F.I.R.S.T. (kein Netz, kein IO).
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

// Alle drei set-once-ISO-Marker-Felder: das erwartete Feld je Setter + die beiden anderen,
// die beim Aufruf UNBERUEHRT (null) bleiben muessen (Feldnamen-Vertausch-Wachhund, PM-6).
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
    // Feldnamen-Vertausch-Wachhund (PM-6): NUR das Ziel-Feld wurde gesetzt.
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
