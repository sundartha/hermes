import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { keepsTranscriptForCustomer } from "../../src/diagnostic-retention.js";
import { makeSelfServiceRoutes } from "../../src/self-service-routes.js";
import {
  SESSION_COOKIE_NAME,
  makeAccounts,
  makeSessions,
  signValue,
  webAuth,
  webAuthAllowPending,
} from "../../src/web-auth.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import request from "../gemeinsam/testserver-anfrage.mjs";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import {
  mcpPost,
  readToolResult,
  seedCall,
  seedState,
  startServer,
  toolCall,
  waitForStoreState,
} from "../helpers.js";
import { makePgTestStore } from "../pg-helpers.js";

const FRIST_MS = 15000;
const HTTP_OK = 200;
const CALL_ID = "call_3821";
const AUFBEWAHRUNG_TAGE = "30";
const AUS = "0";
const DIAGNOSE_TAGE = "7";
const TAG_MS = 86400000;
const NOCH_IN_DER_FRIST_TAGE = 29;
const UEBER_DER_FRIST_TAGE = 31;
const SITZUNG_S = 3600;
const GEHEIMSATZ = "Mein Termin ist am Dienstag";
const ZUSAMMENFASSUNG = "Termin vereinbart.";
const VERLAUF = Object.freeze([
  { role: "agent", text: "Guten Tag, hier ist Hermes.", at: "2026-11-01T10:00:00.000Z" },
  { role: "caller", text: GEHEIMSATZ, at: "2026-11-01T10:00:05.000Z" },
]);

const tageZurueck = (tage) => new Date(Date.now() - tage * TAG_MS).toISOString();
const inhalte = (transcript) => transcript.map(({ role, text }) => ({ role, text }));

const laufenderAnruf = (extra = {}) =>
  seedCall({
    id: CALL_ID,
    provider: "telnyx",
    twilioSid: `v3:${CALL_ID}`,
    answeredAt: tageZurueck(0),
    summary: ZUSAMMENFASSUNG,
    transcript: [...VERLAUF],
    ...extra,
  });

async function mitDienst({ env, settings, calls }, pruefung) {
  const srv = await startServer({ env, seed: seedState({ settings, calls }) });
  try {
    await pruefung(srv);
  } finally {
    await srv.stop();
  }
}

async function beendeAnruf(srv) {
  const antwort = await abrufMitFrist(`${srv.localUrl}/voice/status?callId=${CALL_ID}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ CallStatus: "completed" }).toString(),
  });
  assert.equal(antwort.status, HTTP_OK);
  const stand = await waitForStoreState(
    srv,
    (zustand) => zustand.notifications.length > 0,
    FRIST_MS,
  );
  return stand.calls.find((call) => call.id === CALL_ID);
}

async function werkzeug(srv, name) {
  const antwort = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall(name, { call_id: CALL_ID }));
  assert.equal(antwort.status, HTTP_OK);
  return readToolResult(antwort);
}

test("3821-1: nach dem Abschluss bleibt der ganze Verlauf neben der Zusammenfassung gespeichert", async () => {
  await mitDienst(
    { env: { RETENTION_DAYS: AUFBEWAHRUNG_TAGE }, calls: [laufenderAnruf()] },
    async (srv) => {
      const call = await beendeAnruf(srv);
      assert.equal(call.status, "completed");
      assert.equal(call.summary, ZUSAMMENFASSUNG);
      assert.deepEqual(inhalte(call.transcript), inhalte(VERLAUF));
    },
  );
});

test("3821-2: der KI-Client bekommt den aufbewahrten Verlauf eines beendeten Anrufs nicht", async () => {
  await mitDienst(
    { env: { RETENTION_DAYS: AUFBEWAHRUNG_TAGE }, calls: [laufenderAnruf()] },
    async (srv) => {
      await beendeAnruf(srv);
      const status = await werkzeug(srv, "get_call_status");
      assert.deepEqual(status.structuredContent.last_transcript_lines, []);
      assert.ok(!JSON.stringify(status).includes(GEHEIMSATZ));
      const ergebnis = await werkzeug(srv, "get_call_result");
      assert.ok(!JSON.stringify(ergebnis).includes(GEHEIMSATZ));
      assert.ok(!JSON.stringify(srv.readStore().notifications).includes(GEHEIMSATZ));
      assert.ok(!srv.stdout.includes(GEHEIMSATZ), "Verlauf steht im Log");
    },
  );
});

test("3821-3: waehrend des Anrufs liefert get_call_status weiter die letzten Zeilen", async () => {
  await mitDienst(
    { env: { RETENTION_DAYS: AUFBEWAHRUNG_TAGE }, calls: [laufenderAnruf()] },
    async (srv) => {
      const status = await werkzeug(srv, "get_call_status");
      assert.equal(status.structuredContent.last_transcript_lines.length, VERLAUF.length);
    },
  );
});

test("3821-4: mit abgeschalteter Zusammenfassung wird der Verlauf beim Abschluss geloescht", async () => {
  await mitDienst(
    {
      env: { RETENTION_DAYS: AUFBEWAHRUNG_TAGE },
      settings: { allowSummaries: false },
      calls: [laufenderAnruf()],
    },
    async (srv) => {
      const call = await beendeAnruf(srv);
      assert.deepEqual(call.transcript, []);
    },
  );
});

test("3821-5: ohne Loeschlauf gibt es keine unbegrenzte Aufbewahrung", async () => {
  await mitDienst({ env: { RETENTION_DAYS: AUS }, calls: [laufenderAnruf()] }, async (srv) => {
    const call = await beendeAnruf(srv);
    assert.deepEqual(call.transcript, []);
  });
});

test("3821-6: Diagnose-Anrufe behalten Verlauf und Sichtbarkeit fuer den KI-Client", async () => {
  await mitDienst(
    {
      env: { RETENTION_DAYS: AUFBEWAHRUNG_TAGE, DIAGNOSTIC_RETENTION_DAYS: DIAGNOSE_TAGE },
      calls: [laufenderAnruf({ diagnostic: true })],
    },
    async (srv) => {
      const call = await beendeAnruf(srv);
      assert.deepEqual(inhalte(call.transcript), inhalte(VERLAUF));
      const status = await werkzeug(srv, "get_call_status");
      assert.equal(status.structuredContent.last_transcript_lines.length, VERLAUF.length);
    },
  );
});

test("3821-7: der Loeschlauf entfernt Anrufe samt Verlauf erst nach der Frist", async () => {
  const beendet = (id, tage) =>
    seedCall({
      id,
      status: "completed",
      startedAt: tageZurueck(tage),
      endedAt: tageZurueck(tage),
      transcript: [...VERLAUF],
    });
  const calls = [
    beendet("call_3821_alt", UEBER_DER_FRIST_TAGE),
    beendet("call_3821_frisch", NOCH_IN_DER_FRIST_TAGE),
  ];
  await mitDienst({ env: { RETENTION_DAYS: AUFBEWAHRUNG_TAGE }, calls }, async (srv) => {
    const stand = await waitForStoreState(srv, (zustand) => zustand.calls.length === 1, FRIST_MS);
    assert.equal(stand.calls[0].id, "call_3821_frisch");
    assert.deepEqual(inhalte(stand.calls[0].transcript), inhalte(VERLAUF));
  });
});

async function kundenbereich() {
  const secret = "verlauf-web-secret-0123456789";
  const sub = "sub-verlauf";
  const tenantId = `t_${sub}`;
  const { store, db } = await makePgTestStore();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);
  const zustand = store.load();
  zustand.tenants.push({
    id: tenantId,
    status: "active",
    idpSubject: sub,
    firstName: "Kunde",
    lastName: sub,
  });
  await accounts.upsertOnFirstLogin({ sub, email: `${sub}@kunde.de` });
  await accounts.setStatus(tenantId, "active");
  const { id } = await sessions.create({ sub, tenantId, ttlSeconds: SITZUNG_S });
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw: webAuth({ secret, sessions, accounts }),
      webAuthPendingMw: webAuthAllowPending({ secret, sessions, accounts }),
      audit: () => {},
      config: withConfigNamespaces({ paymentEnabled: false }),
      billing: {},
      provision: async () => {},
    }),
  );
  const server = await new Promise((fertig) => {
    const laufend = app.listen(0, "127.0.0.1", () => fertig(laufend));
  });
  return {
    store,
    tenantId,
    base: `http://127.0.0.1:${server.address().port}`,
    cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(id, secret))}`,
    close: () => new Promise((fertig) => server.close(fertig)),
  };
}

test("3821-8: das Dashboard bekommt ueber die Route den ganzen Verlauf in Originalreihenfolge", async () => {
  const bereich = await kundenbereich();
  try {
    const call = seedCall({
      id: CALL_ID,
      tenantId: bereich.tenantId,
      status: "completed",
      summary: ZUSAMMENFASSUNG,
      transcript: [...VERLAUF],
    });
    const zustand = bereich.store.load();
    zustand.calls.push(call);
    bereich.store.save();
    const antwort = await request("GET", `${bereich.base}/api/self-service/state`, {
      cookie: bereich.cookie,
    });
    assert.equal(antwort.status, HTTP_OK);
    const gefunden = JSON.parse(antwort.body).calls.find((eintrag) => eintrag.id === CALL_ID);
    assert.equal(gefunden.summary, ZUSAMMENFASSUNG);
    assert.deepEqual(inhalte(gefunden.transcript), inhalte(VERLAUF));
  } finally {
    await bereich.close();
  }
});

test("3821-9: aufbewahrt wird nur mit aktuellen Einstellungen, Zusammenfassung an und Loeschlauf an", () => {
  const an = { allowSummaries: true };
  const frist = { retentionDays: Number(AUFBEWAHRUNG_TAGE) };
  const ohneFrist = { retentionDays: Number(AUS) };
  const anruf = {};
  assert.equal(keepsTranscriptForCustomer({ call: anruf, settings: an, privacy: frist }), true);
  assert.equal(keepsTranscriptForCustomer({ call: anruf, settings: an, privacy: frist, settingsCurrent: false }), false, "Einstellungen nicht lesbar: im Zweifel loeschen");
  assert.equal(keepsTranscriptForCustomer({ call: anruf, settings: { allowSummaries: false }, privacy: frist }), false);
  assert.equal(keepsTranscriptForCustomer({ call: anruf, privacy: frist }), false);
  assert.equal(keepsTranscriptForCustomer({ call: anruf, settings: an, privacy: ohneFrist }), false);
  assert.equal(keepsTranscriptForCustomer({ call: { transcriptDeclined: true }, settings: an, privacy: frist }), false, "Widerspruch geht vor");
});

const FREMDE_NUMMER = "+491729999001";
const anrufStarten = (srv, felder) =>
  abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objective: "Test", to: FREMDE_NUMMER, ...felder }),
  });

test("3821-10: place_call mit diagnostic=false speichert den Widerspruch, auch fuer fremde Nummern", async () => {
  const env = { RETENTION_DAYS: AUFBEWAHRUNG_TAGE, ALLOWED_COUNTRY_CODES: "+49", FAKE_ORIGINATE: "true" };
  await mitDienst({ env }, async (srv) => {
    const antwortAbgelehnt = await anrufStarten(srv, { diagnostic: false });
    const abgelehnt = await antwortAbgelehnt.json();
    const antwortNormal = await anrufStarten(srv, { to: "+491729999002" });
    const normal = await antwortNormal.json();
    const { calls } = srv.readStore();
    const gespeichert = (id) => calls.find((call) => call.id === id);
    assert.equal(gespeichert(abgelehnt.callId).transcriptDeclined, true);
    assert.equal(gespeichert(normal.callId).transcriptDeclined, false);
  });
});

test("3821-11: mit Widerspruch wird der Verlauf beim Abschluss geloescht", async () => {
  const calls = [laufenderAnruf({ transcriptDeclined: true })];
  await mitDienst({ env: { RETENTION_DAYS: AUFBEWAHRUNG_TAGE }, calls }, async (srv) => {
    const call = await beendeAnruf(srv);
    assert.deepEqual(call.transcript, []);
  });
});

test("3821-12: mit Widerspruch wird auch der Verlauf eines gescheiterten Anrufs geloescht", async () => {
  const calls = [laufenderAnruf({ transcriptDeclined: true, summary: null })];
  await mitDienst({ env: { RETENTION_DAYS: AUFBEWAHRUNG_TAGE }, calls }, async (srv) => {
    await abrufMitFrist(`${srv.localUrl}/voice/status?callId=${CALL_ID}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallStatus: "failed" }).toString(),
    });
    const stand = await waitForStoreState(srv, ({ calls: [anruf] }) => anruf.transcript.length === 0, FRIST_MS);
    assert.equal(stand.calls[0].status, "failed");
  });
});

test("3821-14: ein Widerspruch auf einen zusammengefassten Doppelauftrag gilt fuer den laufenden Anruf", async () => {
  const env = { RETENTION_DAYS: AUFBEWAHRUNG_TAGE, ALLOWED_COUNTRY_CODES: "+49", FAKE_ORIGINATE: "true" };
  await mitDienst({ env }, async (srv) => {
    const antwortErst = await anrufStarten(srv, {});
    const erst = await antwortErst.json();
    const antwortZweit = await anrufStarten(srv, { diagnostic: false });
    const zweit = await antwortZweit.json();
    assert.equal(zweit.callId, erst.callId, "Doppelauftrag wurde zusammengefasst");
    const stand = await waitForStoreState(srv, ({ calls: [anruf] }) => anruf.transcriptDeclined === true, FRIST_MS);
    assert.equal(stand.calls.length, 1);
  });
});

test("3821-15: mit Widerspruch loescht auch cancel_call den Verlauf", async () => {
  const calls = [laufenderAnruf({ transcriptDeclined: true, summary: null })];
  await mitDienst({ env: { RETENTION_DAYS: AUFBEWAHRUNG_TAGE }, calls }, async (srv) => {
    await abrufMitFrist(`${srv.localUrl}/api/calls/${CALL_ID}/cancel`, { method: "POST" });
    const stand = await waitForStoreState(srv, ({ calls: [anruf] }) => anruf.transcript.length === 0, FRIST_MS);
    assert.equal(stand.calls[0].status, "cancelled");
  });
});
