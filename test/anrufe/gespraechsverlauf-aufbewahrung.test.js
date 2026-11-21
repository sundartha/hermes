import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import request from "../gemeinsam/testserver-anfrage.mjs";
import { BOOTSTRAP_TENANT_ID, makePgTestStore } from "../pg-helpers.js";
import { WEB_SITZUNGS_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";
import { SESSION_COOKIE_NAME, webAuth, webAuthAllowPending, makeAccounts, makeSessions, signValue } from "../../src/web-auth.js";
import { makeSelfServiceRoutes } from "../../src/self-service-routes.js";
import { keepsTranscriptForCustomer } from "../../src/diagnostic-retention.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { registerTools } from "../../src/mcp-tools.js";
import { starteMailAttrappe } from "./mail-attrappe.js";
import { starteAttrappe } from "./attrappen-server.js";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";
import { seedCall, seedState, startServer, waitForStoreState, waitUntil } from "../helpers.js";
import { CONV_ID, isoVor, starteAnbieterAttrappe } from "../_iel-inbound-harness.js";

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
  const cookies = {};
  for (const kennung of mandanten) {
    const tenant = `t_sub-gv-${kennung}`;
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


async function beendeterAnruf(store, tenantId, beitraege = zeilen("a")) {
  const call = store.createCall({ direction: "outbound", from: VON, to: ZIEL, goal: "Test", tenantId });
  await store.persistCall(call.id);
  for (const { role, text } of beitraege) await store.addTranscript(call.id, role, text);
  store.endCallRecord(call.id, "completed");
  const gespeichert = store.getCall(call.id);
  gespeichert.summary = "Termin vereinbart.";
  await store.persistCall(call.id);
  return gespeichert;
}

async function stateVon(umgebung, kennung) {
  const res = await request("GET", `${umgebung.base}/api/self-service/state`, { cookie: umgebung.cookies[kennung] });
  assert.equal(res.status, HTTP_OK);
  return JSON.parse(res.body);
}

test("Kriterium 1: der Kundenbereich liefert alle Beiträge in Originalreihenfolge mit Rolle, Text und Zeit, die Zusammenfassung bleibt", async () => {
  await mitUmgebung(["a"], async (umgebung) => {
    const call = await beendeterAnruf(umgebung.store, "t_sub-gv-a");
    const sichtbar = (await stateVon(umgebung, "a")).calls.find((eintrag) => eintrag.id === call.id);
    assert.deepEqual(
      sichtbar.transcript.map(({ role, text }) => ({ role, text })),
      zeilen("a"),
    );
    for (const beitrag of sichtbar.transcript) assert.match(beitrag.at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(sichtbar.summary, "Termin vereinbart.");
  });
});

test("Kriterium 4: Mandanten sehen nur den eigenen Gesprächsverlauf, ohne Sitzung gibt es 401", async () => {
  await mitUmgebung(["a", "b"], async (umgebung) => {
    const anrufA = await beendeterAnruf(umgebung.store, "t_sub-gv-a", zeilen("a"));
    const anrufB = await beendeterAnruf(umgebung.store, "t_sub-gv-b", zeilen("b"));
    const stateA = await stateVon(umgebung, "a");
    const stateB = await stateVon(umgebung, "b");
    assert.deepEqual(stateA.calls.map((eintrag) => eintrag.id), [anrufA.id]);
    assert.deepEqual(stateB.calls.map((eintrag) => eintrag.id), [anrufB.id]);
    const texteVon = ({ calls: [{ transcript }] }) => transcript.map(({ text }) => text);
    const erwartet = (kennung) => zeilen(kennung).map(({ text }) => text);
    assert.deepEqual(texteVon(stateA), erwartet("a"));
    assert.deepEqual(texteVon(stateB), erwartet("b"));
    const ohneSitzung = await request("GET", `${umgebung.base}/api/self-service/state`);
    assert.equal(ohneSitzung.status, HTTP_UNAUTHORIZED);
    assert.doesNotMatch(ohneSitzung.body, new RegExp(MARKER));
  });
});

const FRIST_MS = 15000;
const POLL_TAKT_MS = 100;
const FRISTEN_TAKT_MS = 40;
const MAX_DAUER_S = 3600;
const FRISCH_S = 5;
const GESPRAECH_S = 30;
const ID = "call_4284_abschluss";
const SERVER_ZEILEN = [
  { role: "agent", text: "Guten Tag, hier spricht ein KI-Assistent." },
  { role: "caller", text: `${MARKER} Ja, bitte?` },
  { role: "agent", text: "Danke, einen schönen Tag." },
];
const anbieterZeilen = (zeilenListe) =>
  zeilenListe.map(({ role, text }) => ({ role: role === "caller" ? "user" : role, message: text }));

const gespraech = (status, zeilenListe, zusammenfassung = "Termin vereinbart.") => ({
  conversation_id: CONV_ID,
  status,
  transcript: anbieterZeilen(zeilenListe),
  analysis: status === "done" ? { call_successful: "success", transcript_summary: zusammenfassung } : null,
  metadata: { call_duration_secs: GESPRAECH_S, phone_call: { direction: "outbound", call_id: "sip_4284" } },
});

const anrufIn = (stand) => stand.calls.find((call) => call.id === ID);
const hatBenachrichtigung = (stand) => stand.notifications.some((eintrag) => eintrag.callId === ID);
const istGeleert = (stand) => anrufIn(stand).transcript.length === 0;

async function mitServer({ settings = {}, anruf = {}, env = {}, zeilenImStore = SERVER_ZEILEN, zustand = {} }, lauf) {
  const el = await starteAnbieterAttrappe();
  const answeredAt = isoVor(FRISCH_S);
  const call = seedCall({
    id: ID,
    provider: "telnyx",
    twilioSid: `v3:${ID}`,
    maxDurationS: MAX_DAUER_S,
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    answeredAt,
    startedAt: answeredAt,
    elevenlabsConversationId: CONV_ID,
    elBoundAt: answeredAt,
    fristAbfrageAt: answeredAt,
    transcript: zeilenImStore.map((zeile) => ({ ...zeile, at: answeredAt })),
    ...anruf,
  });
  const srv = await startServer({
    env: {
      ELEVENLABS_API_BASE: el.url,
      ELEVENLABS_API_KEY: "test-key",
      ELEVENLABS_RESULT_POLL_MS: String(POLL_TAKT_MS),
      FRISTEN_TAKT_MS: String(FRISTEN_TAKT_MS),
      RETENTION_DAYS: String(RETENTION_DAYS),
      ...env,
    },
    seed: seedState({ settings, calls: [call], ...zustand }),
  });
  try {
    await lauf({ srv, el });
  } finally {
    await srv.stop();
    await el.close();
  }
}

const texteIn = (stand) => anrufIn(stand).transcript.map((beitrag) => beitrag.text);

test("Kriterium 1: abgeschlossener Anruf mit Zusammenfassung behält den ganzen Gesprächsverlauf nach dem Abschluss", async () => {
  await mitServer({}, async ({ srv, el }) => {
    el.setzeAntwort(gespraech("done", SERVER_ZEILEN));
    const stand = await waitForStoreState(srv, hatBenachrichtigung, FRIST_MS);
    assert.equal(anrufIn(stand).status, "completed");
    assert.deepEqual(texteIn(stand), SERVER_ZEILEN.map((zeile) => zeile.text));
    assert.equal(anrufIn(stand).summary, "Termin vereinbart.");
  });
});

const GELOESCHT_MIT_ZUSAMMENFASSUNG = [
  ["Zusammenfassung abgeschaltet", { settings: { allowSummaries: false } }],
  ["nur ein Redebeitrag", { zeilenImStore: SERVER_ZEILEN.slice(1, 2), anbieter: SERVER_ZEILEN.slice(1, 2) }],
  ["Anruf ohne Mandant", { anruf: { tenantId: null } }],
  ["RETENTION_DAYS 0", { env: { RETENTION_DAYS: "0" } }],
];

for (const [name, fall] of GELOESCHT_MIT_ZUSAMMENFASSUNG) {
  test(`Kriterium 2: ${name} löscht das Transkript beim Abschluss`, async () => {
    await mitServer(fall, async ({ srv, el }) => {
      el.setzeAntwort(gespraech("done", fall.anbieter ?? SERVER_ZEILEN));
      const stand = await waitForStoreState(srv, hatBenachrichtigung, FRIST_MS);
      assert.equal(anrufIn(stand).status, "completed");
      assert.deepEqual(anrufIn(stand).transcript, []);
    });
  });
}

test("Kriterium 2: gescheiterte Zusammenfassung löscht das Transkript beim Abschluss", async () => {
  await mitServer({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:9" } }, async ({ srv, el }) => {
    el.setzeAntwort(gespraech("done", SERVER_ZEILEN, null));
    const stand = await waitForStoreState(srv, istGeleert, FRIST_MS);
    assert.equal(anrufIn(stand).status, "completed");
    assert.equal(anrufIn(stand).summary, null);
  });
});

const GESCHEITERT_GELOESCHT = [
  ["nur ein Redebeitrag", { zeilenImStore: SERVER_ZEILEN.slice(1, 2), anbieter: SERVER_ZEILEN.slice(1, 2) }],
  ["Anruf ohne Mandant", { anruf: { tenantId: null } }],
];

for (const [name, fall] of GESCHEITERT_GELOESCHT) {
  test(`Kriterium 2: gescheiterte Zusammenfassung bei ${name} löscht das Transkript beim Abschluss`, async () => {
    const env = { ANTHROPIC_BASE_URL: "http://127.0.0.1:9" };
    await mitServer({ ...fall, env }, async ({ srv, el }) => {
      el.setzeAntwort(gespraech("done", fall.anbieter ?? SERVER_ZEILEN, null));
      const stand = await waitForStoreState(srv, istGeleert, FRIST_MS);
      assert.equal(anrufIn(stand).status, "completed");
      assert.equal(anrufIn(stand).summary, null);
    });
  });
}

test("Kriterium 2: Status failed löscht das Transkript beim Abschluss", async () => {
  await mitServer({}, async ({ srv, el }) => {
    el.setzeAntwort(gespraech("failed", SERVER_ZEILEN));
    const stand = await waitForStoreState(srv, istGeleert, FRIST_MS);
    assert.equal(anrufIn(stand).status, "failed");
  });
});

test("Kriterium 2: Status cancelled löscht das Transkript beim Abschluss", async () => {
  await mitServer({}, async ({ srv, el }) => {
    el.setzeAntwort(null);
    const antwort = await request("POST", `${srv.localUrl}/api/calls/${ID}/cancel`);
    assert.equal(antwort.status, HTTP_OK);
    const stand = await waitForStoreState(srv, istGeleert, FRIST_MS);
    assert.equal(anrufIn(stand).status, "cancelled");
  });
});

const ZWEI_MELDUNGEN = 2;
const DIAGNOSE_ENV = { DIAGNOSTIC_RETENTION_DAYS: "7", ANTHROPIC_BASE_URL: "http://127.0.0.1:9" };

const DIAGNOSE_FAELLE = [
  ["mit Zusammenfassung und ohne Kundenbereich", gespraech("done", SERVER_ZEILEN), "0", hatBenachrichtigung],
  ["mit gescheiterter Zusammenfassung", gespraech("done", SERVER_ZEILEN, null), "30", null],
  ["mit Status failed", gespraech("failed", SERVER_ZEILEN), "30", hatBenachrichtigung],
];

for (const [name, antwort, retentionDays, abgeschlossen] of DIAGNOSE_FAELLE) {
  test(`Kriterium 3: Diagnose-Anruf ${name} behält das Transkript`, async () => {
    await mitServer(
      { anruf: { diagnostic: true }, env: { ...DIAGNOSE_ENV, RETENTION_DAYS: retentionDays } },
      async ({ srv, el }) => {
        el.setzeAntwort(antwort);
        if (abgeschlossen) await waitForStoreState(srv, abgeschlossen, FRIST_MS);
        else await waitUntil(() => (srv.stdout.match(/\[summary\]/g) ?? []).length >= ZWEI_MELDUNGEN, { timeoutMs: FRIST_MS });
        assert.deepEqual(texteIn(srv.readStore()), SERVER_ZEILEN.map((zeile) => zeile.text));
      },
    );
  });
}

test("Kriterium 3: der Löschlauf entfernt das Transkript eines Diagnose-Anrufs nach der Diagnose-Frist", async () => {
  const alt = (tage) => new Date(Date.now() - tage * 24 * 60 * 60 * 1000).toISOString();
  const abgelaufen = seedCall({ id: "call_diag_alt", status: "completed", diagnostic: true, endedAt: alt(10), transcript: [{ role: "caller", text: "Geheim", at: alt(10) }] });
  const frisch = seedCall({ id: "call_diag_frisch", status: "completed", diagnostic: true, endedAt: alt(1), transcript: [{ role: "caller", text: "Geheim", at: alt(1) }] });
  const srv = await startServer({
    env: { DIAGNOSTIC_RETENTION_DAYS: "7", RETENTION_DAYS: "0" },
    seed: seedState({ calls: [abgelaufen, frisch] }),
  });
  try {
    const stand = srv.readStore();
    assert.deepEqual(stand.calls.find((call) => call.id === "call_diag_alt").transcript, []);
    const frischAngelegt = stand.calls.find((call) => call.id === "call_diag_frisch");
    assert.equal(frischAngelegt.transcript.length, 1);
  } finally {
    await srv.stop();
  }
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
      const modellSichtbar = JSON.stringify({ content: antwort.content, structuredContent: antwort.structuredContent });
      assert.doesNotMatch(modellSichtbar, new RegExp(MARKER), `${tool.name}: kein Transkript`);
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


const MAIL_EMPFAENGER = "freund@kunde.example.test";
const EIGENE_NUMMER = "+4915199998888";
const SMS_ABSENDER = "+4930111222333";
const SMS_PFAD = "/v2/messages";
const HTTP_CREATED = 201;

const mandantMitMailUndSms = () => ({
  tenants: [
    {
      id: BOOTSTRAP_TENANT_ID,
      status: "active",
      ownerName: "Jonas",
      privateNumber: EIGENE_NUMMER,
      newsletterRecipients: [{ email: MAIL_EMPFAENGER, status: "confirmed", unsubToken: "abmelde-4284" }],
    },
  ],
  numbers: [
    { id: "num_sms_4284", e164: SMS_ABSENDER, tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx", status: "active", providerNumberId: null },
  ],
});

function starteSmsAttrappe() {
  const gesendet = [];
  return starteAttrappe((req, res) => {
    let roh = "";
    req.on("data", (stueck) => (roh += stueck));
    req.on("end", () => {
      if (req.method === "POST" && req.url === SMS_PFAD) gesendet.push(JSON.parse(roh));
      res.writeHead(HTTP_CREATED, { "content-type": "application/json" });
      res.end("{}");
    });
  }).then((attrappe) => ({ ...attrappe, gesendet }));
}

test("Kriterium 5: Mail und SMS der Zusammenfassung enthalten den Gesprächsinhalt eines behaltenen Transkripts nicht", async () => {
  const mail = await starteMailAttrappe();
  const sms = await starteSmsAttrappe();
  const { NODE_OPTIONS: umleitung, ...mailUmgebung } = mail.umgebung;
  const nodeOptionen = [process.env.NODE_OPTIONS, umleitung].filter(Boolean);
  const env = {
    ...mailUmgebung,
    NODE_OPTIONS: nodeOptionen.join(" "),
    TELNYX_API_BASE: sms.url,
    TELNYX_API_KEY: "KEYtest-4284",
    SEND_SMS_SUMMARY: "true",
  };
  try {
    await mitServer({ env, zustand: mandantMitMailUndSms() }, async ({ srv, el }) => {
      el.setzeAntwort(gespraech("done", SERVER_ZEILEN));
      const stand = await waitForStoreState(srv, hatBenachrichtigung, FRIST_MS);
      await waitUntil(() => mail.an(MAIL_EMPFAENGER).length > 0 && sms.gesendet.length > 0, { timeoutMs: FRIST_MS });
      assert.deepEqual(texteIn(stand), SERVER_ZEILEN.map((zeile) => zeile.text));
      assert.equal(mail.an(MAIL_EMPFAENGER).length, 1);
      assert.equal(sms.gesendet.length, 1);
      assert.equal(sms.gesendet[0].to, EIGENE_NUMMER);
      assert.match(mail.an(MAIL_EMPFAENGER)[0].text, /Termin vereinbart\./);
      assert.match(sms.gesendet[0].text, /Termin vereinbart\./);
      assert.doesNotMatch(mail.an(MAIL_EMPFAENGER)[0].text, new RegExp(MARKER));
      assert.doesNotMatch(sms.gesendet[0].text, new RegExp(MARKER));
    });
  } finally {
    await mail.schliessen();
    await sms.close();
  }
});

test("Kriterium 5: nur get_call_result trägt im _meta höchstens die Felder transcript und hermes/content_locale, ohne den Gesprächsinhalt; kein anderes Werkzeug trägt ihn irgendwo im Ergebnis", async () => {
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
  const server = new McpServer({ name: "hermes-gv-meta", version: "0.0.0" });
  registerTools(server, { consultAllowed: true, uiHost: { enabled: true }, language: "de" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "hermes-gv-meta-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.some((tool) => tool.name === "get_call_result"));
    for (const tool of tools) {
      const antwort = await client.callTool({ name: tool.name, arguments: WERKZEUG_ARGUMENTE[tool.name] ?? {} });
      if (tool.name !== "get_call_result") {
        assert.doesNotMatch(JSON.stringify(antwort), new RegExp(MARKER), `${tool.name}: kein Transkript im Ergebnis`);
        continue;
      }
      assert.doesNotMatch(JSON.stringify({ content: antwort.content, structuredContent: antwort.structuredContent }), new RegExp(MARKER));
      const meta = antwort._meta ?? {};
      assert.deepEqual(Object.keys(meta).filter((schluessel) => !["transcript", "hermes/content_locale"].includes(schluessel)), []);
      assert.doesNotMatch(JSON.stringify(meta.transcript ?? ""), new RegExp(MARKER));
    }
  } finally {
    if (vorher === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = vorher;
    await client.close();
    await server.close();
    await new Promise((resolve) => gateway.close(resolve));
  }
});
