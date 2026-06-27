// P3b: pg-Store-Backend gegen pglite (Postgres-in-WASM, offline). Prueft die
// 24 Store-Funktionen auf Shape-/Verhaltens-Parity zum json-Backend UND den
// mutate-then-save()-Vertrag (getCall-Referenz mutieren + save -> persistiert),
// jeweils per Re-Hydrierung aus derselben DB (zweiter makePgStore-Aufbau auf
// derselben pglite-Instanz). pglite = kein Netz, keine externe DB (F.I.R.S.T.).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore, BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";
import { config } from "../src/config.js";
import {
  defaultSettings,
  demoCalendar,
  PROVIDER,
  NUMBER_STATUS,
  PROVISIONING_JOB_STATUS,
  USAGE_EVENT_KIND,
  TENANT_STATUS,
} from "../src/store/defaults.js";
import {
  transitionNumber,
  recordProvisioningJob,
  markProvisioningJob,
} from "../src/store/state-ops.js";
import { makePgTestStore } from "./pg-helpers.js";

const PRICES = { priceInPerMTokUsd: 1.0, priceOutPerMTokUsd: 5.0, usdToEur: 0.93, maxBudgetEur: 8 };

// Baut auf einer BESTEHENDEN pglite-Instanz einen frischen Store (re-hydriert
// den Spiegel aus der DB) - so wird Persistenz statt nur In-Memory geprueft.
async function reopen(db) {
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

test("frischer pg-Zustand == frischer json-Zustand (Defaults)", async () => {
  const { store } = await makePgTestStore();
  const s = store.load();
  // settings/calendar sind seit I2 Maps tenantId -> Bucket; der frische Zustand
  // traegt den Owner-Bucket (byte-identisch zur gemeinsamen Quelle defaults.js).
  assert.deepEqual(s.settings[BOOTSTRAP_TENANT_ID], defaultSettings());
  assert.equal(s.calls.length, 0);
  assert.equal(s.actionItems.length, 0);
  assert.equal(s.notifications.length, 0);
  assert.deepEqual(s.profiles, {});
  // usage ist seit P4 eine Map tenantId -> Bucket; der frische Zustand traegt den Owner-Bucket.
  assert.deepEqual(s.usage[BOOTSTRAP_TENANT_ID], {
    inputTokens: 0,
    outputTokens: 0,
    costEur: 0,
    calls: 0,
  });
  // Demo-Kalender identisch zur gemeinsamen Quelle (defaults.js).
  assert.deepEqual(store.getCalendar(BOOTSTRAP_TENANT_ID), demoCalendar());
});

test("createCall + getCall: Shape inkl. streamToken, leeres transcript/actionItemIds", async () => {
  const { store } = await makePgTestStore();
  const call = store.createCall({
    direction: "outbound",
    from: "+49111",
    to: "+49222",
    goal: "Test",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  assert.match(call.id, /^call_/);
  assert.equal(typeof call.streamToken, "string");
  assert.equal(call.streamToken.length, 32);
  assert.equal(call.status, "active");
  assert.deepEqual(call.transcript, []);
  assert.deepEqual(call.actionItemIds, []);
  assert.equal(store.load().usage[BOOTSTRAP_TENANT_ID].calls, 1);
  assert.equal(store.getCall(call.id).id, call.id);
});

test("createCall persistiert ueber Re-Hydrierung (inkl. usage.calls)", async () => {
  const { store, db } = await makePgTestStore();
  const call = store.createCall({
    direction: "inbound",
    from: "+49333",
    to: "+49444",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  await store.save();
  const reopened = await reopen(db);
  const got = reopened.getCall(call.id);
  assert.ok(got, "Call ueberlebt die Re-Hydrierung");
  assert.equal(got.streamToken, call.streamToken);
  assert.equal(got.direction, "inbound");
  assert.equal(reopened.load().usage[BOOTSTRAP_TENANT_ID].calls, 1);
});

test("createCall: provider ueberlebt die Re-Hydrierung (call.provider, P6a)", async () => {
  const { store, db } = await makePgTestStore();
  const call = store.createCall({
    direction: "inbound",
    from: "+49333",
    to: "+49444",
    provider: PROVIDER.TELNYX,
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  await store.save();
  const reopened = await reopen(db);
  assert.equal(reopened.getCall(call.id).provider, PROVIDER.TELNYX);
});

test("addTranscript rekonstruiert transcript[] in Reihenfolge", async () => {
  const { store, db } = await makePgTestStore();
  const call = store.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  store.addTranscript(call.id, "agent", "erste");
  store.addTranscript(call.id, "caller", "zweite");
  await store.save();
  const reopened = await reopen(db);
  const got = reopened.getCall(call.id);
  assert.deepEqual(
    got.transcript.map((t) => [t.role, t.text]),
    [
      ["agent", "erste"],
      ["caller", "zweite"],
    ],
  );
});

test("addActionItem haengt id an call.actionItemIds + persistiert", async () => {
  const { store, db } = await makePgTestStore();
  const call = store.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  const item = store.addActionItem(call.id, "Rueckruf", "todo");
  assert.deepEqual(store.getCall(call.id).actionItemIds, [item.id]);
  await store.save();
  const reopened = await reopen(db);
  assert.deepEqual(reopened.getCall(call.id).actionItemIds, [item.id]);
  assert.equal(reopened.load().actionItems[0].id, item.id);
});

test("toggleActionItem kippt done und persistiert", async () => {
  const { store, db } = await makePgTestStore();
  const call = store.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  const item = store.addActionItem(call.id, "x");
  assert.equal(item.done, false);
  store.toggleActionItem(item.id);
  await store.save();
  const reopened = await reopen(db);
  assert.equal(reopened.load().actionItems[0].done, true);
});

test("markAnswered + endCallRecord: Statusuebergaenge + Idempotenz", async () => {
  const { store, db } = await makePgTestStore();
  const call = store.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  assert.equal(store.markAnswered(call.id).answeredAt !== null, true);
  const firstAnswered = store.getCall(call.id).answeredAt;
  store.markAnswered(call.id); // zweiter Aufruf aendert answeredAt nicht
  assert.equal(store.getCall(call.id).answeredAt, firstAnswered);
  store.endCallRecord(call.id, "completed");
  assert.equal(store.getCall(call.id).status, "completed");
  store.endCallRecord(call.id, "failed"); // nur aus active -> kein Wechsel mehr
  assert.equal(store.getCall(call.id).status, "completed");
  await store.save();
  const reopened = await reopen(db);
  assert.equal(reopened.getCall(call.id).status, "completed");
  assert.ok(reopened.getCall(call.id).endedAt);
});

test("countOutboundCallsSince mit und ohne requestedBy", async () => {
  const { store } = await makePgTestStore();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const t = BOOTSTRAP_TENANT_ID;
  store.createCall({ direction: "outbound", from: "+49", to: "+49", requestedBy: "a@x", tenantId: t });
  store.createCall({ direction: "outbound", from: "+49", to: "+49", requestedBy: "b@x", tenantId: t });
  store.createCall({ direction: "inbound", from: "+49", to: "+49", tenantId: t });
  assert.equal(store.countOutboundCallsSince(since), 2);
  assert.equal(store.countOutboundCallsSince(since, { requestedBy: "a@x" }), 1);
});

test("trackUsage Kostenformel + budgetExceeded-Schwelle", async () => {
  const { store, db } = await makePgTestStore();
  const usage = store.trackUsage(BOOTSTRAP_TENANT_ID, 1_000_000, 1_000_000, PRICES);
  const expectedUsd = 1.0 + 5.0;
  assert.equal(usage.inputTokens, 1_000_000);
  assert.equal(usage.outputTokens, 1_000_000);
  assert.ok(Math.abs(usage.costEur - expectedUsd * PRICES.usdToEur) < 1e-9);
  assert.equal(store.budgetExceeded(BOOTSTRAP_TENANT_ID, PRICES), false);
  store.trackUsage(BOOTSTRAP_TENANT_ID, 0, 2_000_000, PRICES); // schiebt ueber 8 EUR
  assert.equal(store.budgetExceeded(BOOTSTRAP_TENANT_ID, PRICES), true);
  await store.save();
  const reopened = await reopen(db);
  assert.equal(reopened.budgetExceeded(BOOTSTRAP_TENANT_ID, PRICES), true);
});

test("getCalendar sortiert + addCalendarEvent + findConflict (tenantId-Signatur, I2)", async () => {
  const { store, db } = await makePgTestStore();
  store.addCalendarEvent(
    BOOTSTRAP_TENANT_ID,
    "Termin",
    "2030-01-01T10:00:00.000Z",
    "2030-01-01T11:00:00.000Z",
  );
  const cal = store.getCalendar(BOOTSTRAP_TENANT_ID);
  for (let i = 1; i < cal.length; i++) assert.ok(cal[i - 1].start <= cal[i].start);
  assert.ok(
    store.findConflict(BOOTSTRAP_TENANT_ID, "2030-01-01T10:30:00.000Z", "2030-01-01T10:45:00.000Z"),
  );
  assert.equal(
    store.findConflict(BOOTSTRAP_TENANT_ID, "2030-01-01T12:00:00.000Z", "2030-01-01T13:00:00.000Z"),
    null,
  );
  await store.save();
  // Round-Trip durch flush/hydrate: belegt, dass ops.calendarFor ueber den pg-Pfad
  // erreichbar ist (kein undefined-Drift, R6-pg) - der Owner-Bucket-Termin ueberlebt.
  const reopened = await reopen(db);
  assert.ok(
    reopened.findConflict(BOOTSTRAP_TENANT_ID, "2030-01-01T10:30:00.000Z", "2030-01-01T10:45:00.000Z"),
  );
});

test("addNotification kappt auf 50 (neueste zuerst)", async () => {
  const { store, db } = await makePgTestStore();
  for (let i = 0; i < 55; i++) store.addNotification(`t${i}`, `b${i}`, null);
  assert.equal(store.load().notifications.length, 50);
  assert.equal(store.load().notifications[0].title, "t54");
  await store.save();
  const reopened = await reopen(db);
  assert.equal(reopened.load().notifications.length, 50);
  assert.equal(reopened.load().notifications[0].title, "t54");
});

test("updateSettings Whitelist (unbekannte Keys/Typen ignoriert) + persistiert (tenantId-Signatur, I2)", async () => {
  const { store, db } = await makePgTestStore();
  const { changed } = store.updateSettings(BOOTSTRAP_TENANT_ID, {
    agentName: "Neu",
    allowBooking: false,
    fremd: "x",
    allowCalendar: "kein-bool",
  });
  assert.deepEqual(changed.sort(), ["agentName", "allowBooking"]);
  // settings ist seit I2 eine Map tenantId -> Bucket; Laufzeit liest den Owner-Bucket.
  assert.equal(store.load().settings[BOOTSTRAP_TENANT_ID].agentName, "Neu");
  assert.equal(store.load().settings[BOOTSTRAP_TENANT_ID].allowBooking, false);
  assert.equal("fremd" in store.load().settings[BOOTSTRAP_TENANT_ID], false);
  await store.save();
  // Round-Trip durch flush/hydrate: belegt, dass ops.settingsFor ueber den pg-Pfad
  // erreichbar ist (kein undefined-Drift, R6-pg) - der Owner-Bucket ueberlebt.
  const reopened = await reopen(db);
  assert.equal(reopened.load().settings[BOOTSTRAP_TENANT_ID].agentName, "Neu");
  assert.equal(reopened.load().settings[BOOTSTRAP_TENANT_ID].allowBooking, false);
});

test("Profile: resolveProfile Owner/Default + setProfile/deleteProfile/listProfiles", async () => {
  const { store, db } = await makePgTestStore();
  // leere email -> Owner (permissiv), unbekannt -> Default (restriktiv)
  assert.equal(store.resolveProfile("").allowCalendar, true);
  assert.equal(store.resolveProfile("unbekannt@x").allowCalendar, false);
  store.setProfile("a@x", { unrestricted: true, maxCallsPerHour: 6, fremd: 1 });
  assert.equal(store.resolveProfile("a@x").unrestricted, true);
  assert.equal(store.resolveProfile("a@x").maxCallsPerHour, 6);
  assert.deepEqual(Object.keys(store.listProfiles()), ["a@x"]);
  await store.save();
  const reopened = await reopen(db);
  assert.equal(reopened.resolveProfile("a@x").unrestricted, true);
  assert.equal(store.deleteProfile("a@x"), true);
  assert.equal(store.deleteProfile("a@x"), false);
  await store.save();
  const afterDelete = await reopen(db);
  assert.deepEqual(afterDelete.listProfiles(), {});
});

test("pruneOldData: Keep-Praedikate (aktiv/offen bleiben, alt+beendet weg)", async () => {
  const { store, db } = await makePgTestStore();
  const old = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
  const active = store.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  const doneOld = store.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  store.endCallRecord(doneOld.id, "completed");
  // Alters-Stempel direkt im Spiegel setzen (wie der Retention-Test alte Daten seedet)
  store.getCall(doneOld.id).endedAt = old;
  const openItem = store.addActionItem(doneOld.id, "offen");
  const doneItem = store.addActionItem(doneOld.id, "erledigt");
  store.toggleActionItem(doneItem.id);
  store.load().actionItems.find((a) => a.id === doneItem.id).createdAt = old;
  store.addNotification("alt", "", null);
  store.load().notifications[0].at = old;
  await store.save();

  const removed = store.pruneOldData(30);
  assert.deepEqual(removed, { calls: 1, notifications: 1, actionItems: 1 });
  const ids = store.load().calls.map((c) => c.id);
  assert.ok(ids.includes(active.id), "aktiver Call bleibt");
  assert.ok(!ids.includes(doneOld.id), "alter beendeter Call weg");
  assert.ok(
    store.load().actionItems.some((a) => a.id === openItem.id),
    "offenes Item bleibt",
  );
  await store.save();
  const reopened = await reopen(db);
  assert.ok(!reopened.getCall(doneOld.id), "Loeschung persistiert (samt Transkript per Cascade)");
});

test("pruneOldData() ohne Argument nutzt config.retentionDays (Produktions-Caller server.js:583)", async () => {
  // server.js:583 ruft store.pruneOldData() OHNE Argument. Der Default (=
  // config.retentionDays) MUSS auch unter pg greifen, sonst ist die DSGVO-
  // Retention still abgeschaltet. Default hier deterministisch auf 30 Tage.
  const { store } = await makePgTestStore();
  config.retentionDays = 30;
  const old = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
  const doneOld = store.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  store.endCallRecord(doneOld.id, "completed");
  store.getCall(doneOld.id).endedAt = old;
  const freshDone = store.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  store.endCallRecord(freshDone.id, "completed");
  await store.save();

  const removed = store.pruneOldData(); // KEIN Argument = Produktionspfad
  assert.equal(removed.calls, 1, "alter beendeter Call wird ueber den Default-Pfad geprunt");
  const ids = store.load().calls.map((c) => c.id);
  assert.ok(!ids.includes(doneOld.id), "alter beendeter Call weg");
  assert.ok(ids.includes(freshDone.id), "frischer beendeter Call bleibt");
});

test("mutate-then-save()-Vertrag: getCall-Referenz mutieren + save persistiert", async () => {
  const { store, db } = await makePgTestStore();
  const call = store.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  await store.save();
  // Genau die Bestands-Muster: server.js setzt twilioSid, claude.js summary/objectiveAchieved
  const ref = store.getCall(call.id);
  ref.twilioSid = "CA-test-sid";
  ref.summary = "Gespraech zusammengefasst";
  ref.objectiveAchieved = "true";
  store.save();
  await store.save();
  const reopened = await reopen(db);
  const got = reopened.getCall(call.id);
  assert.equal(got.twilioSid, "CA-test-sid");
  assert.equal(got.summary, "Gespraech zusammengefasst");
  assert.equal(got.objectiveAchieved, "true");
  // getCall findet auch per twilioSid (wie json)
  assert.equal(reopened.getCall("CA-test-sid").id, call.id);
});

test("Re-init ist idempotent: keine Default-Duplikate (Kalender bleibt 3)", async () => {
  const db = new PGlite();
  await reopen(db);
  const second = await reopen(db);
  assert.equal(second.getCalendar(BOOTSTRAP_TENANT_ID).length, demoCalendar().length);
});

test("findTenantByNumber: number ueberlebt Re-Hydrierung, unbekannte To -> null", async () => {
  // number direkt in die DB seeden (deterministisch, ohne config.twilioNumber-
  // Kopplung: der Contract-Test bekommt config nicht ueber BASE_ENV), dann
  // reopen -> Hydrierung+Lookup wie im Inbound-Pfad.
  const { db } = await makePgTestStore();
  const seededE164 = "+15005550006";
  await db.query(
    `INSERT INTO number (id, tenant_id, e164, provider) VALUES ($1, $2, $1, 'twilio')`,
    [seededE164, BOOTSTRAP_TENANT_ID],
  );
  const reopened = await reopen(db);
  assert.equal(reopened.findTenantByNumber(seededE164), BOOTSTRAP_TENANT_ID);
  assert.equal(
    reopened.findTenantByNumber("+490000"),
    null,
    "unbekannte Nummer -> null (kein Default-Tenant)",
  );
});

test("number-Lifecycle (status/provider_number_id/e164=null) ueberlebt Flush+Re-Hydrierung; nur active routet", async () => {
  // Kein config-Auto-Seed mehr (Owner-Nummer kommt ueber seedBootstrapNumber): der
  // frische pg-Store traegt nur die hier selbst gesetzten Nummern.
  {
    const { store, db } = await makePgTestStore();
    const s = store.load();
    // requested (e164=null, kein Kauf) + active (mit providerNumberId + paymentIntentId,
    // Payment-Pfad P6b1) in den Spiegel.
    s.numbers.push({
      id: "num_req",
      e164: null,
      tenantId: BOOTSTRAP_TENANT_ID,
      provider: PROVIDER.TELNYX,
      status: "requested",
      providerNumberId: null,
    });
    s.numbers.push({
      id: "num_act",
      e164: "+4915700000001",
      tenantId: BOOTSTRAP_TENANT_ID,
      provider: PROVIDER.TELNYX,
      status: "active",
      providerNumberId: "ext_1",
      paymentIntentId: "pi_test_1",
    });
    await store.save();

    const r1 = await reopen(db);
    const nums = r1.load().numbers;
    const req = nums.find((n) => n.id === "num_req");
    const act = nums.find((n) => n.id === "num_act");
    assert.equal(req.status, "requested");
    assert.equal(req.e164, null, "requested e164 bleibt null (kein Kauf)");
    assert.equal(req.paymentIntentId, null, "requested ohne PI -> null (kein undefined-Drift)");
    assert.equal(act.status, "active");
    assert.equal(act.providerNumberId, "ext_1", "provider_number_id ueberlebt");
    assert.equal(act.paymentIntentId, "pi_test_1", "payment_intent_id ueberlebt Flush+Hydrate");
    assert.equal(r1.findTenantByNumber("+4915700000001"), BOOTSTRAP_TENANT_ID, "active routet");

    // Suspend -> Flush schreibt status -> Re-Hydrierung -> NICHT mehr routbar (Gate).
    transitionNumber(r1.load(), "num_act", NUMBER_STATUS.SUSPENDED);
    await r1.save();
    const r2 = await reopen(db);
    assert.equal(r2.load().numbers.find((n) => n.id === "num_act").status, "suspended");
    assert.equal(
      r2.findTenantByNumber("+4915700000001"),
      null,
      "suspended -> fail-closed, kein Routing",
    );
  }
});

test("provisioning_job ueberlebt Flush+Re-Hydrierung; markProvisioningJob -> done persistiert (P6b2)", async () => {
  const { store, db } = await makePgTestStore();
  const s = store.load();
  // FK-Voraussetzung: number_id verweist auf number(id) -> erst die Number in den
  // Spiegel (Owner-Scope), dann den Job. status='requested' (kein Kauf), e164=null.
  s.numbers.push({
    id: "num_job1",
    e164: null,
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: PROVIDER.TELNYX,
    status: "requested",
    providerNumberId: null,
  });
  const job = recordProvisioningJob(s, {
    numberId: "num_job1",
    tenantId: BOOTSTRAP_TENANT_ID,
    idempotencyKey: "provision_num_job1",
  });
  await store.save();

  const r1 = await reopen(db);
  const persisted = r1.load().provisioningJobs.find((j) => j.id === job.id);
  assert.ok(persisted, "Job ueberlebt Re-Hydrierung");
  assert.equal(persisted.status, PROVISIONING_JOB_STATUS.QUEUED);
  assert.equal(persisted.idempotencyKey, "provision_num_job1");
  assert.equal(persisted.numberId, "num_job1");
  assert.equal(persisted.kind, "provision_number");
  assert.equal(persisted.attempts, 0);
  assert.equal(persisted.lastError, null, "ohne Fehler -> null (kein undefined-Drift)");

  // Worker-Endzustand: done + attempts hochgezaehlt -> Flush -> Re-Hydrierung.
  markProvisioningJob(r1.load(), job.id, PROVISIONING_JOB_STATUS.DONE);
  await r1.save();
  const r2 = await reopen(db);
  const after = r2.load().provisioningJobs.find((j) => j.id === job.id);
  assert.equal(after.status, PROVISIONING_JOB_STATUS.DONE, "Endstatus persistiert");
  assert.equal(after.attempts, 1, "attempts hochgezaehlt + persistiert");
});

test("purgeTranscript loescht NUR die Segmente des Ziel-Calls; Summary + anderer Call bleiben (#7)", async () => {
  const { store, db } = await makePgTestStore();
  const c1 = store.createCall({ direction: "outbound", from: "+49", to: "+49", goal: "Ziel 1", tenantId: BOOTSTRAP_TENANT_ID });
  const c2 = store.createCall({ direction: "outbound", from: "+49", to: "+49", goal: "Ziel 2", tenantId: BOOTSTRAP_TENANT_ID });
  store.addTranscript(c1.id, "agent", "Hallo");
  store.addTranscript(c1.id, "caller", "Geheim");
  store.addTranscript(c2.id, "caller", "Bleibt");
  // Summary wie der Produktionspfad (claude.js) setzt + persistiert.
  store.getCall(c1.id).summary = "Zusammenfassung 1";
  store.getCall(c1.id).objectiveAchieved = "true";
  await store.save();

  // Beide Calls haben vor dem Purge persistierte Segmente.
  const r1 = await reopen(db);
  assert.equal(r1.getCall(c1.id).transcript.length, 2);
  assert.equal(r1.getCall(c2.id).transcript.length, 1);

  // Purge auf c1 -> Reconcile-on-empty loescht NUR c1-Segmente beim naechsten Flush.
  r1.purgeTranscript(c1.id);
  await r1.save();
  const r2 = await reopen(db);

  const segCount = async (callId) =>
    Number(
      (await db.query(`SELECT count(*) AS n FROM transcript_segment WHERE call_id=$1`, [callId]))
        .rows[0].n,
    );
  assert.equal(await segCount(c1.id), 0, "Ziel-Call: Segmente in der DB geloescht");
  assert.equal(
    await segCount(c2.id),
    1,
    "anderer Call: Segmente unberuehrt (Cross-Call-Dichtheit)",
  );
  assert.deepEqual(
    r2.getCall(c1.id).transcript,
    [],
    "Spiegel: Ziel-Transkript leer nach Re-Hydrierung",
  );
  assert.equal(
    r2.getCall(c1.id).summary,
    "Zusammenfassung 1",
    "Summary-Spalte ueberlebt den Purge",
  );
  assert.equal(r2.getCall(c2.id).transcript.length, 1, "anderer Call: Transkript bleibt");
});

test("tenant_budget ueberlebt Flush+Re-Hydrierung (Money als Ganzzahl Cents, P6b3)", async () => {
  const { store, db } = await makePgTestStore();
  store.setTenantBudget(BOOTSTRAP_TENANT_ID, { budgetCents: 400, hardCapCents: 500 });
  await store.save();
  const r1 = await reopen(db);
  const budget = r1.load().tenantBudgets.find((b) => b.tenantId === BOOTSTRAP_TENANT_ID);
  assert.ok(budget, "tenant_budget-Zeile ueberlebt Re-Hydrierung");
  assert.equal(budget.budgetCents, 400);
  assert.equal(budget.hardCapCents, 500);
  assert.equal(Number.isInteger(budget.hardCapCents), true, "Cents Ganzzahl at rest");
  // Upsert: zweiter setTenantBudget aktualisiert dieselbe Zeile.
  r1.setTenantBudget(BOOTSTRAP_TENANT_ID, { budgetCents: 700, hardCapCents: 900 });
  await r1.save();
  const r2 = await reopen(db);
  const updated = r2.load().tenantBudgets.filter((b) => b.tenantId === BOOTSTRAP_TENANT_ID);
  assert.equal(updated.length, 1, "PK tenant_id -> kein Duplikat");
  assert.equal(updated[0].hardCapCents, 900);
});

test("usage_event ueberlebt Flush+Re-Hydrierung; stripe_meter_sent-Flip persistiert (P6b3)", async () => {
  const { store, db } = await makePgTestStore();
  const ev = store.recordUsageEvent({
    tenantId: BOOTSTRAP_TENANT_ID,
    callId: null,
    kind: USAGE_EVENT_KIND.NUMBER_MONTH,
    quantity: 1,
    costCents: 500,
  });
  await store.save();

  const r1 = await reopen(db);
  const persisted = r1.load().usageEvents.find((e) => e.id === ev.id);
  assert.ok(persisted, "usage_event ueberlebt Re-Hydrierung");
  assert.equal(persisted.kind, USAGE_EVENT_KIND.NUMBER_MONTH);
  assert.equal(persisted.callId, null, "number_month ohne Call -> null (kein undefined-Drift)");
  assert.equal(persisted.quantity, 1);
  assert.equal(persisted.costCents, 500);
  assert.equal(persisted.stripeMeterSent, false, "frisch ungesendet");

  // Flush-Flip: markMeterEventsSent + save -> Re-Hydrierung sieht stripe_meter_sent=true.
  const n = r1.markMeterEventsSent([ev.id]);
  assert.equal(n, 1, "ein Event geflippt");
  await r1.save();
  const r2 = await reopen(db);
  assert.equal(
    r2.load().usageEvents.find((e) => e.id === ev.id).stripeMeterSent,
    true,
    "Flip persistiert",
  );
  assert.equal(r2.pendingMeterEvents().length, 0, "kein pending Event mehr (Idempotenz-Schloss)");
});

// ---- ensureTenant: Signup-Spiegel-Nachzug (Nach-Boot, idempotent, fail-safe) ----
// Der OIDC-Web-Login legt die tenant-Zeile NACH dem Boot in der DB an; der Spiegel wird
// sonst nur bei init() hydriert. ensureTenant zieht GENAU diesen Tenant nach - mit dem
// REALEN DB-status (Regel 1: nie ein hartcodiertes active).

test("ensureTenant: abwesender DB-Tenant wird mit REALEM (suspended) Status nachgezogen", async () => {
  const { store, db } = await makePgTestStore();
  // Web-Login-Pfad simuliert: die tenant-Zeile existiert in der DB (suspended), aber NICHT
  // im Boot-hydrierten Spiegel (kein registerTenant). Direktes INSERT (tenant hat keine RLS).
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'suspended', $2)`, [
    "t_signup",
    "sub-signup",
  ]);
  assert.equal(
    store.load().tenants.find((t) => t.id === "t_signup"),
    undefined,
    "vor dem Nachzug nicht im Spiegel",
  );
  const ok = await store.ensureTenant("t_signup");
  assert.equal(ok, true);
  const tenant = store.load().tenants.find((t) => t.id === "t_signup");
  assert.ok(tenant, "jetzt im Spiegel");
  assert.equal(
    tenant.status,
    TENANT_STATUS.SUSPENDED,
    "REALER DB-Status hydriert, NICHT hardcodiert active (Regel 1)",
  );
  assert.equal(tenant.idpSubject, "sub-signup", "voller Row hydriert (rowToTenant)");
});

test("ensureTenant: vorhandener Spiegel-Tenant -> NUR status-Refresh (suspended -> active), Felder bleiben", async () => {
  const { store, db } = await makePgTestStore();
  await db.query(`INSERT INTO tenant (id, status) VALUES ($1, 'suspended')`, ["t_refresh"]);
  await store.ensureTenant("t_refresh"); // in den Spiegel (suspended)
  store.setTenantStripe("t_refresh", { customerId: "cus_keep" }); // Spiegel-eigenes Feld
  assert.equal(
    store.load().tenants.find((t) => t.id === "t_refresh").status,
    TENANT_STATUS.SUSPENDED,
  );
  // DB-Status wird aktiv (wie accounts.setStatus es taete); ensureTenant zieht NUR ihn nach.
  await db.query(`UPDATE tenant SET status = 'active' WHERE id = $1`, ["t_refresh"]);
  const ok = await store.ensureTenant("t_refresh");
  assert.equal(ok, true);
  const t = store.load().tenants.find((x) => x.id === "t_refresh");
  assert.equal(t.status, TENANT_STATUS.ACTIVE, "status auf den DB-Wert nachgezogen");
  assert.equal(
    t.stripeCustomerId,
    "cus_keep",
    "Spiegel-eigenes Feld nicht geclobbert (refresh ONLY status)",
  );
});

test("ensureTenant: unbekannte Id -> false, fabriziert keinen Tenant", async () => {
  const { store } = await makePgTestStore();
  const before = store.load().tenants.length;
  const ok = await store.ensureTenant("t_nonexistent");
  assert.equal(ok, false);
  assert.equal(store.load().tenants.length, before, "kein Tenant aus dem Nichts");
});
