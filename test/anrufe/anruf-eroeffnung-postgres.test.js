import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import pg from "pg";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { makeVoiceRoutes } from "../../src/routes/voice.js";
import { BOOTSTRAP_TENANT_ID, makePgStore } from "../pg-helpers.js";
import { webhookEvents } from "../../src/telephony/registry.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";

const ZIEL = "+4915112349944";
const SIP_LAENGE = 32;
const ABSENDER = "+4930555000310";

function runnerFuer(pool) {
  return {
    async withClient(arbeit) {
      const client = await pool.connect();
      try {
        return await arbeit({ query: (text, params) => client.query(text, params), exec: (sql) => client.query(sql) });
      } finally {
        client.release();
      }
    },
  };
}

async function mitSpeicher(t, arbeit) {
  const datenbank = await echteDatenbankMitRolle(t);
  if (!datenbank) return;
  await t.test("Ablauf", async (ablauf) => {
    const pool = new pg.Pool({ connectionString: datenbank.adresse });
    ablauf.after(() => pool.end());
    pool.on("error", () => {});
    const store = makePgStore(runnerFuer(pool));
    await store.init();
    await arbeit({ store, pool });
    await store.save();
  });
}

async function legeAn(store, zusatz = {}) {
  const call = store.createCall({
    direction: "outbound",
    from: ABSENDER,
    to: ZIEL,
    goal: "Test",
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: "telnyx",
    ...zusatz,
  });
  await store.persistCall(call.id);
  return call;
}

async function zeile(pool, id) {
  const { rows } = await pool.query(
    `SELECT set_config('app.current_tenant', $1, false)`,
    [BOOTSTRAP_TENANT_ID],
  );
  assert.equal(rows.length, 1);
  const antwort = await pool.query("SELECT status, answered_at, ended_at FROM call WHERE id = $1", [id]);
  return antwort.rows[0];
}

function konfiguration() {
  return withConfigNamespaces({
    skipTwilioSignatureCheck: true,
    machineDetection: { enabled: false, timeoutS: 25 },
    publicUrl: "https://hermes.test",
    elevenLabsInbound: { sipUser: "u", sipPassword: "p".repeat(SIP_LAENGE), begruessungslautEnabled: false },
  });
}

function routen(store) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(
    makeVoiceRoutes({
      store,
      config: konfiguration(),
      audit: () => {},
      voiceRender: { render: () => "<Response/>", turnDirectives: () => [], sayInCallVoice: () => [], followupTurnDirectives: () => [] },
      directiveSynth: { synthesizeDirectiveAudio: async (_call, directives) => directives },
      ttsStore: { takeOnce: async () => null },
      lifecycle: { reattachActiveCall: async () => ({ call: null, logUnknown: false }) },
      finishCall: () => {},
      webhookEvents,
      providerFromHeaders: () => null,
      inboundSignatureVerifier: () => ({ verifyInboundSignature: () => false }),
      terminateAndBillCall: async () => {},
      billThunk: () => () => {},
      startInboundNachlauf: () => {},
      inboundBridges: { armDeadlines: () => {}, clearDeadlines: () => {} },
    }),
  );
  return app;
}

async function mitServer(app, arbeit) {
  const server = await new Promise((fertig) => {
    const srv = app.listen(0, "127.0.0.1", () => fertig(srv));
  });
  try {
    return await arbeit(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((fertig) => server.close(fertig));
  }
}

test("ERÖFFNUNG-1: ein nicht angenommener, abgebrochener Anruf ist danach nicht mehr bewacht und trägt den Endstatus", async (t) => {
  await mitSpeicher(t, async ({ store, pool }) => {
  const call = await legeAn(store);
  assert.equal(store.anrufHierBewacht(call.id), true);
  await store.endCallRecord(call.id, "cancelled");
  assert.equal(store.anrufHierBewacht(call.id), false);
  const gespeichert = await zeile(pool, call.id);
  assert.equal(gespeichert.status, "cancelled");
  assert.equal(gespeichert.answered_at, null);
  assert.notEqual(gespeichert.ended_at, null);
  });
});

test("ERÖFFNUNG-2: ein aktiver Anruf an /voice/outbound wird begrüßt, bleibt aktiv und bekommt answered_at", async (t) => {
  await mitSpeicher(t, async ({ store, pool }) => {
  const call = await legeAn(store);
  await mitServer(routen(store), async (basis) => {
    const antwort = await abrufMitFrist(`${basis}/voice/outbound?callId=${call.id}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallSid: "CA_eroeffnung" }).toString(),
    });
    assert.equal(antwort.status, 200);
    assert.equal(await antwort.text(), "<Response/>");
  });
  assert.equal(store.getCall(call.id).status, "active");
  assert.equal(store.anrufHierBewacht(call.id), true);
  const gespeichert = await zeile(pool, call.id);
  assert.equal(gespeichert.status, "active");
  assert.notEqual(gespeichert.answered_at, null);
  });
});

test("ERÖFFNUNG-3: ein EL-Übergabe-Anruf an /voice/outbound bekommt answered_at und endet mit Endstatus ohne Bewachung", async (t) => {
  await mitSpeicher(t, async ({ store, pool }) => {
  const call = await legeAn(store);
  store.recordCostProfile(call.id, KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI);
  await mitServer(routen(store), async (basis) => {
    const antwort = await abrufMitFrist(`${basis}/voice/outbound?callId=${call.id}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallSid: "CA_eroeffnung_el" }).toString(),
    });
    assert.equal(antwort.status, 200);
    await antwort.text();
  });
  assert.notEqual((await zeile(pool, call.id)).answered_at, null);
  await store.setCallEndedAt(call.id, "completed", "2026-11-16T12:00:00.000Z");
  assert.equal(store.anrufHierBewacht(call.id), false);
  assert.equal((await zeile(pool, call.id)).status, "completed");
  });
});

const LEERLAUF_BEENDEN =
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND usename = current_user AND state = 'idle'";

test("ERÖFFNUNG-4: beendet die Datenbank eine Leerlauf-Verbindung des Pools, bleibt die Datei grün und der Pool arbeitet weiter", async (t) => {
  await mitSpeicher(t, async ({ store, pool }) => {
    const call = await legeAn(store);
    const halter = await pool.connect();
    const leerlauf = await pool.connect();
    leerlauf.release();
    const { rows: beendet } = await halter.query(LEERLAUF_BEENDEN);
    halter.release();
    assert.ok(beendet.length >= 1);
    while (pool.idleCount > 1) await new Promise((weiter) => setImmediate(weiter));
    assert.equal((await zeile(pool, call.id)).status, "active");
  });
});
