import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore } from "../src/store/pg.js";
import { planSummarySms } from "../src/sms-summary.js";
import { publicCall } from "../src/store/views.js";
import { makeDefaultState, createCall, markSummarySmsSent } from "../src/store/state-ops.js";
import { NUMBER_STATUS, PROVIDER, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const PROV = PROVIDER.TELNYX;

async function reopen(db) {
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

test("Marker round-trippt durch flush/hydrate (pg): summarySmsSentAt ueberlebt den Restart", async () => {
  const db = new PGlite();
  const store = await reopen(db);
  const c = store.createCall({
    direction: "inbound",
    from: "+491701234567",
    to: "+4915100000001",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  assert.equal(store.getCall(c.id).summarySmsSentAt, null, "frischer Call hat keinen Marker");

  store.markSummarySmsSent(c.id);
  await store.save();

  const reopened = await reopen(db);
  const sentAt = reopened.getCall(c.id).summarySmsSentAt;
  assert.ok(
    typeof sentAt === "string" && !Number.isNaN(Date.parse(sentAt)),
    "Marker ist eine persistierte ISO-Zeit",
  );
});

test("Guard: persistierter Marker unterdrueckt die zweite SMS (send=false, kein reason)", () => {
  const store = {
    tenantPrivateNumber: () => "+491701234567",
    load: () => ({
      numbers: [
        { tenantId: "A", e164: "+4915100000001", status: NUMBER_STATUS.ACTIVE, provider: PROV },
      ],
    }),
    tenantContext: () => ({ settings: { smsSummaryOptIn: true } }),
    dailySmsCount: () => 0,
  };
  const cfg = withConfigNamespaces({ sendSmsSummary: true, dailySmsCap: 20 });

  const before = planSummarySms(store, cfg, { id: "call_A", tenantId: "A", provider: PROV });
  assert.equal(before.send, true, "ohne Marker wuerde gesendet (Kontroll-Pfad)");

  const after = planSummarySms(store, cfg, {
    id: "call_A",
    tenantId: "A",
    provider: PROV,
    summarySmsSentAt: new Date().toISOString(),
  });
  assert.equal(after.send, false, "mit Marker wird NICHT erneut gesendet");
  assert.equal(
    after.reason,
    null,
    "normaler Dedup -> kein Ziel-Defizit, kein reason zu auditieren",
  );
});

test("publicCall strippt summarySmsSentAt (kein API-Leak)", () => {
  const out = publicCall({
    id: "call_A",
    summary: "ok",
    streamToken: "secret",
    _finished: true,
    summarySmsSentAt: "2026-06-23T10:00:00.000Z",
  });
  assert.equal(out.summarySmsSentAt, undefined, "Marker nicht in der API-View");
  assert.equal(out.streamToken, undefined, "streamToken weiterhin gestrippt");
  assert.equal(out._finished, undefined, "_finished weiterhin gestrippt");
  assert.equal(out.summary, "ok", "Nutzdaten bleiben erhalten");
});

test("markSummarySmsSent ist idempotent: gesetzter Marker gewinnt, kein zweites Schreiben", () => {
  const s = makeDefaultState();
  const c = createCall(s, {
    direction: "inbound",
    from: "+49170",
    to: "+49151",
    tenantId: BOOTSTRAP_TENANT_ID,
  });

  const first = markSummarySmsSent(s, c.id);
  assert.equal(first.changed, true, "erstes Setzen aendert den Record");
  const stamp = first.call.summarySmsSentAt;
  assert.ok(stamp, "Marker gesetzt");

  const second = markSummarySmsSent(s, c.id);
  assert.equal(second.changed, false, "zweites Setzen ist ein No-op (kein Wrapper-save)");
  assert.equal(second.call.summarySmsSentAt, stamp, "Zeitstempel unveraendert (gesetzter gewinnt)");
});

test("markSummarySmsSent fuer unbekannten Call: changed=false, kein Throw", () => {
  const s = makeDefaultState();
  const res = markSummarySmsSent(s, "call_does_not_exist");
  assert.equal(res.changed, false);
  assert.equal(res.call, null);
});
