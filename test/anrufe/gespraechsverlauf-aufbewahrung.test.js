import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import request from "../gemeinsam/testserver-anfrage.mjs";
import { makePgTestStore } from "../pg-helpers.js";
import { WEB_SITZUNGS_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";
import { SESSION_COOKIE_NAME, webAuth, webAuthAllowPending, makeAccounts, makeSessions, signValue } from "../../src/web-auth.js";
import { makeSelfServiceRoutes } from "../../src/self-service-routes.js";
import { makeCallFinish } from "../../src/telephony/call-finish.js";
import * as ops from "../../src/store/state-ops.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { keepsTranscriptForCustomer } from "../../src/diagnostic-retention.ts";
import { registerTools } from "../../src/mcp-tools.js";

const SECRET = WEB_SITZUNGS_GEHEIMNIS;
const SESSION_TTL_SECONDS = 3600;
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const RETENTION_DAYS = 30;
const MARKER = "KANARIENVOGEL-4284-Gespraechsinhalt";
const ZIEL = "+4915112349921";
const VON = "+4930555000300";

const cookieFor = (id) => `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(id, SECRET))}`;

const zeilen = (kennung) => [
  { role: "agent", text: `Guten Tag ${kennung}` },
  { role: "caller", text: `${MARKER} ${kennung}` },
  { role: "agent", text: `Danke ${kennung}` },
];

async function neueUmgebung(mandanten) {
  const { store, db } = await makePgTestStore();
  const runner = {
    withClient: (fn) =>
      fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
  };
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);
  const state = store.load();
  const cookies = {};
  for (const kennung of mandanten) {
    const tenant = `t_sub-gv-${kennung}`;
    ops.registerTenant(state, tenant, { firstName: "Kunde", lastName: kennung });
    const row = state.tenants.find((eintrag) => eintrag.id === tenant);
    row.status = "active";
    row.idpSubject = `sub-gv-${kennung}`;
    await accounts.upsertOnFirstLogin({ sub: `sub-gv-${kennung}`, email: `${kennung}@kunde.de` });
    await accounts.setStatus(tenant, "active");
    const { id } = await sessions.create({ sub: `sub-gv-${kennung}`, tenantId: tenant, ttlSeconds: SESSION_TTL_SECONDS });
    cookies[kennung] = cookieFor(id);
  }
  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      webAuthPendingMw: webAuthAllowPending({ secret: SECRET, sessions, accounts }),
      audit: () => {},
      config: withConfigNamespaces({ paymentEnabled: false }),
      billing: {},
      accounts,
      provision: async () => {},
    }),
  );
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  return {
    store,
    cookies,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function mitUmgebung(mandanten, lauf) {
  const umgebung = await neueUmgebung(mandanten);
  try {
    await lauf(umgebung);
  } finally {
    await umgebung.close();
  }
}

function abschluss(store, { retentionDays = RETENTION_DAYS, summarizeCall, gesendet = { mails: [], sms: [] } }) {
  return makeCallFinish({
    store,
    config: {
      billing: { paymentEnabled: false, smsCostCents: 0 },
      privacy: { retentionDays, diagnosticRetentionDays: 0 },
      server: { publicUrl: "https://hermes.example.test" },
    },
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async (nachricht) => gesendet.sms.push(nachricht) }),
    summarizeCall,
    planSummarySms: (_store, _config, call) => ({ send: true, reason: null, smsFrom: { e164: VON }, to: call.to }),
    audit: () => {},
    mailer: { sendMail: async (nachricht) => gesendet.mails.push(nachricht) },
    accountsRef: { current: { accountByTenant: async () => ({ email: "kunde@example.test" }) } },
  });
}

const zusammenfassung = async (call) => {
  call.summary = "Termin vereinbart.";
  return { summary: call.summary, actionItems: [] };
};
const ohneErgebnis = async () => null;
const wirft = async () => {
  throw new Error("llm down");
};

async function beendeterAnruf(store, tenantId, { status = "completed", beitraege = zeilen("a") } = {}) {
  const call = store.createCall({ direction: "outbound", from: VON, to: ZIEL, goal: "Test", tenantId });
  await store.persistCall(call.id);
  for (const { role, text } of beitraege) await store.addTranscript(call.id, role, text);
  store.endCallRecord(call.id, status);
  return store.getCall(call.id);
}

async function anrufImKonto(umgebung, kennung, callId) {
  const res = await request("GET", `${umgebung.base}/api/self-service/state`, { cookie: umgebung.cookies[kennung] });
  assert.equal(res.status, HTTP_OK);
  return JSON.parse(res.body).calls.find((eintrag) => eintrag.id === callId);
}

test("Kriterium 1: abgeschlossener Anruf mit Zusammenfassung zeigt den ganzen Gesprächsverlauf im eigenen Konto", async () => {
  await mitUmgebung(["a"], async (umgebung) => {
    const call = await beendeterAnruf(umgebung.store, "t_sub-gv-a");
    await abschluss(umgebung.store, { summarizeCall: zusammenfassung }).finishCall(call);
    const sichtbar = await anrufImKonto(umgebung, "a", call.id);
    assert.deepEqual(
      sichtbar.transcript.map(({ role, text }) => ({ role, text })),
      zeilen("a"),
    );
    for (const beitrag of sichtbar.transcript) assert.match(beitrag.at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(sichtbar.summary, "Termin vereinbart.");
  });
});

const GELOESCHT = [
  ["Zusammenfassung abgeschaltet", { einstellung: { allowSummaries: false }, summarizeCall: ohneErgebnis }],
  ["Zusammenfassung gescheitert (liefert nichts)", { summarizeCall: ohneErgebnis }],
  ["Zusammenfassung gescheitert (wirft)", { summarizeCall: wirft }],
  ["nur ein Redebeitrag", { beitraege: [{ role: "caller", text: `${MARKER} einzeln` }], summarizeCall: zusammenfassung }],
  ["Status failed", { status: "failed", summarizeCall: zusammenfassung }],
  ["Status cancelled", { status: "cancelled", summarizeCall: zusammenfassung }],
  ["RETENTION_DAYS 0", { retentionDays: 0, summarizeCall: zusammenfassung }],
];

for (const [name, fall] of GELOESCHT) {
  test(`Kriterium 2: ${name} löscht das Transkript beim Abschluss`, async () => {
    await mitUmgebung(["a"], async (umgebung) => {
      if (fall.einstellung) await umgebung.store.updateSettings("t_sub-gv-a", fall.einstellung);
      const call = await beendeterAnruf(umgebung.store, "t_sub-gv-a", fall);
      await abschluss(umgebung.store, fall).finishCall(call);
      const sichtbar = await anrufImKonto(umgebung, "a", call.id);
      assert.deepEqual(sichtbar.transcript, []);
    });
  });
}

test("Kriterium 2: Anruf ohne Mandant löscht das Transkript beim Abschluss", async () => {
  await mitUmgebung(["a"], async (umgebung) => {
    const call = await beendeterAnruf(umgebung.store, "t_sub-gv-a");
    call.tenantId = null;
    await abschluss(umgebung.store, { summarizeCall: zusammenfassung }).finishCall(call);
    assert.deepEqual(umgebung.store.getCall(call.id).transcript, []);
  });
});

test("Kriterium 3: Diagnose-Anruf behält das Transkript, der Löschlauf nach der Diagnose-Frist entfernt es", async () => {
  await mitUmgebung(["a"], async (umgebung) => {
    const call = await beendeterAnruf(umgebung.store, "t_sub-gv-a");
    call.diagnostic = true;
    const finish = makeCallFinish({
      store: umgebung.store,
      config: {
        billing: { paymentEnabled: false, smsCostCents: 0 },
        privacy: { retentionDays: 0, diagnosticRetentionDays: 7 },
      },
      metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
      messaging: () => ({ sendSms: async () => {} }),
      summarizeCall: ohneErgebnis,
      planSummarySms: () => ({ send: false, reason: null }),
      audit: () => {},
    });
    await finish.finishCall(call);
    assert.equal(umgebung.store.getCall(call.id).transcript.length, zeilen("a").length);
    call.endedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(ops.purgeExpiredDiagnosticTranscripts(umgebung.store.load(), 7), 1);
    assert.deepEqual(umgebung.store.getCall(call.id).transcript, []);
  });
});

test("Kriterium 4: Mandanten sehen nur den eigenen Gesprächsverlauf, ohne Sitzung gibt es 401", async () => {
  await mitUmgebung(["a", "b"], async (umgebung) => {
    const anrufA = await beendeterAnruf(umgebung.store, "t_sub-gv-a", { beitraege: zeilen("a") });
    const anrufB = await beendeterAnruf(umgebung.store, "t_sub-gv-b", { beitraege: zeilen("b") });
    const finish = abschluss(umgebung.store, { summarizeCall: zusammenfassung });
    await finish.finishCall(anrufA);
    await finish.finishCall(anrufB);
    const lesen = async (kennung) =>
      JSON.parse((await request("GET", `${umgebung.base}/api/self-service/state`, { cookie: umgebung.cookies[kennung] })).body);
    const stateA = await lesen("a");
    const stateB = await lesen("b");
    assert.deepEqual(stateA.calls.map((eintrag) => eintrag.id), [anrufA.id]);
    assert.deepEqual(stateB.calls.map((eintrag) => eintrag.id), [anrufB.id]);
    assert.equal(stateA.calls[0].transcript.length, zeilen("a").length);
    assert.doesNotMatch(JSON.stringify(stateA), /Guten Tag b|einzeln b| b"/);
    assert.match(JSON.stringify(stateB), /Danke b/);
    assert.doesNotMatch(JSON.stringify(stateB), /Danke a/);
    const ohneSitzung = await request("GET", `${umgebung.base}/api/self-service/state`);
    assert.equal(ohneSitzung.status, HTTP_UNAUTHORIZED);
    assert.doesNotMatch(ohneSitzung.body, new RegExp(MARKER));
  });
});

test("Kriterium 5: Zusammenfassung per Mail und SMS enthält das Transkript nicht", async () => {
  await mitUmgebung(["a"], async (umgebung) => {
    const call = await beendeterAnruf(umgebung.store, "t_sub-gv-a");
    const gesendet = { mails: [], sms: [] };
    await abschluss(umgebung.store, { summarizeCall: zusammenfassung, gesendet }).finishCall(call);
    assert.equal(gesendet.sms.length, 1);
    assert.doesNotMatch(JSON.stringify([gesendet.mails, gesendet.sms]), new RegExp(MARKER));
    assert.equal(umgebung.store.getCall(call.id).transcript.length, zeilen("a").length);
  });
});

const BEENDET = {
  id: "call_gv_canary",
  direction: "outbound",
  status: "completed",
  to: ZIEL,
  startedAt: "2026-11-14T10:00:00.000Z",
  answeredAt: "2026-11-14T10:00:05.000Z",
  endedAt: "2026-11-14T10:03:00.000Z",
  summary: "Termin vereinbart.",
  transcript: zeilen("canary"),
};
const WERKZEUG_ARGUMENTE = {
  place_call: { to: ZIEL, objective: "Termin", confirmation_code: "c" },
  await_call_event: { call_id: BEENDET.id },
  answer_consult: { call_id: BEENDET.id, event_id: "evt_gv", status: "working" },
  get_call_status: { call_id: BEENDET.id },
  get_call_result: { call_id: BEENDET.id },
  cancel_call: { call_id: BEENDET.id },
};

test("Kriterium 5: kein MCP-Werkzeug gibt das Transkript eines beendeten Anrufs aus", async () => {
  const gateway = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    const body = req.url.endsWith("/cancel")
      ? { status: "cancelled" }
      : { ...BEENDET, calls: [BEENDET], callId: BEENDET.id, event: "done", entries: [] };
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const vorher = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = `http://127.0.0.1:${gateway.address().port}`;
  const server = new McpServer({ name: "hermes-gv", version: "0.0.0" });
  registerTools(server, { consultAllowed: true, uiHost: { enabled: true }, language: "de" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "hermes-gv-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.length > 0);
    for (const tool of tools) {
      const antwort = await client.callTool({ name: tool.name, arguments: WERKZEUG_ARGUMENTE[tool.name] ?? {} });
      assert.doesNotMatch(JSON.stringify(antwort), new RegExp(MARKER), `${tool.name}: kein Transkript`);
    }
    const status = await client.callTool({ name: "get_call_status", arguments: { call_id: BEENDET.id } });
    assert.deepEqual(status.structuredContent.last_transcript_lines, []);
  } finally {
    if (vorher === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = vorher;
    await client.close();
    await server.close();
    await new Promise((resolve) => gateway.close(resolve));
  }
});

const VOLLSTAENDIG = {
  call: { status: "completed", tenantId: "t_x", transcript: [{}, {}] },
  settings: { allowSummaries: true },
  privacy: { retentionDays: 30 },
  summaryCreated: true,
};
const ABWEICHUNGEN = [
  ["alle Bedingungen erfüllt", {}, true],
  ["genau zwei Redebeiträge", { call: { ...VOLLSTAENDIG.call, transcript: [{}, {}] } }, true],
  ["ein Redebeitrag", { call: { ...VOLLSTAENDIG.call, transcript: [{}] } }, false],
  ["Status failed", { call: { ...VOLLSTAENDIG.call, status: "failed" } }, false],
  ["Status active", { call: { ...VOLLSTAENDIG.call, status: "active" } }, false],
  ["kein Mandant", { call: { ...VOLLSTAENDIG.call, tenantId: null } }, false],
  ["Mandant leer", { call: { ...VOLLSTAENDIG.call, tenantId: "" } }, false],
  ["Zusammenfassung fehlt", { summaryCreated: false }, false],
  ["Zusammenfassungen aus", { settings: { allowSummaries: false } }, false],
  ["Zusammenfassungen nicht gesetzt", { settings: {} }, false],
  ["Aufbewahrung 0", { privacy: { retentionDays: 0 } }, false],
  ["Aufbewahrung 1", { privacy: { retentionDays: 1 } }, true],
  ["Aufbewahrung nicht gesetzt", { privacy: {} }, false],
];

for (const [name, abweichung, erwartet] of ABWEICHUNGEN) {
  test(`behält das Transkript für den Kundenbereich: ${name} -> ${erwartet}`, () => {
    assert.equal(keepsTranscriptForCustomer({ ...VOLLSTAENDIG, ...abweichung }), erwartet);
  });
}

async function diagnoseAnruf(umgebung, { status, summarizeCall }) {
  const call = await beendeterAnruf(umgebung.store, "t_sub-gv-a", { status });
  call.diagnostic = true;
  const finish = makeCallFinish({
    store: umgebung.store,
    config: {
      billing: { paymentEnabled: false, smsCostCents: 0 },
      privacy: { retentionDays: RETENTION_DAYS, diagnosticRetentionDays: 7 },
    },
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async () => {} }),
    summarizeCall,
    planSummarySms: () => ({ send: false, reason: null }),
    audit: () => {},
  });
  await finish.finishCall(call);
  return umgebung.store.getCall(call.id).transcript.length;
}

for (const [name, fall] of [
  ["Zusammenfassung wirft", { status: "completed", summarizeCall: wirft }],
  ["Zusammenfassung fehlt", { status: "completed", summarizeCall: ohneErgebnis }],
  ["Status failed", { status: "failed", summarizeCall: zusammenfassung }],
]) {
  test(`Kriterium 3: Diagnose-Anruf behält das Transkript trotz ${name}`, async () => {
    await mitUmgebung(["a"], async (umgebung) => {
      assert.equal(await diagnoseAnruf(umgebung, fall), zeilen("a").length);
    });
  });
}
