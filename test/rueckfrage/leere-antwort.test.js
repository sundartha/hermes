import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, seedState, seedCall, anthropicAttrappe, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { captureToolHandlers } from "../gemeinsam/werkzeug-registrierung.js";

const LEERE_ANTWORT_SCHLIESST = "Leere Antwort schließt die Rückfrage";
const ANRUF_LEER = "call_leere_antwort";
const ANRUF_ARBEITET = "call_working_quittung";
const ANRUF_ROUTE = "call_leere_antwort_route";
const RUECKFRAGE = "c0";
const ECHTE_ANTWORT = "Dienstag 10 Uhr passt";
const OFFEN = "open";
const HTTP_BAD_REQUEST = 400;
const HTTP_OK = 200;
const WERKZEUG_GEHEIMNIS = "leere-antwort-werkzeug-geheimnis";
const OFFEN_MS = 20000;

const RUECKFRAGE_AN = Object.freeze({
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  ELEVENLABS_TOOL_TOKEN: WERKZEUG_GEHEIMNIS,
  CONSULT_OPEN_MS: String(OFFEN_MS),
  EL_CONSULT_DELIVERY_MS: String(OFFEN_MS),
  EL_CONSULT_ACK_MS: "0",
  EL_CONSULT_ANSWER_MS: String(OFFEN_MS),
});

const gespraechVon = (id) => `conv_${id}`;

const laufenderAnruf = (id) =>
  seedCall({
    id,
    status: "active",
    direction: "outbound",
    maxDurationS: 600,
    answeredAt: new Date().toISOString(),
    elevenlabsConversationId: gespraechVon(id),
  });

let srv;
let gatewayVorher;
const offeneWebhooks = [];

before(async () => {
  srv = await startServer({
    env: RUECKFRAGE_AN,
    seed: seedState({ calls: [ANRUF_LEER, ANRUF_ARBEITET, ANRUF_ROUTE].map(laufenderAnruf) }),
  });
  gatewayVorher = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = srv.localUrl;
});

after(async () => {
  if (gatewayVorher === undefined) delete process.env.GATEWAY_URL;
  else process.env.GATEWAY_URL = gatewayVorher;
  await srv.stop();
  await Promise.allSettled(offeneWebhooks);
});

const gespeicherterAnruf = (id) => srv.readStore().calls.find((c) => c.id === id);
const rueckfrageStatus = (id) => {
  const [rueckfrage] = gespeicherterAnruf(id)?.consults ?? [];
  return rueckfrage?.status;
};

async function stelleRueckfrage(id) {
  const webhook = abrufMitFrist(
    `${srv.localUrl}/webhooks/elevenlabs/consult`,
    {
      method: "POST",
      headers: { "x-hermes-tool-token": WERKZEUG_GEHEIMNIS, "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: gespraechVon(id), question: "Welcher Termin passt dir?" }),
    },
    { wartezeitMs: OFFEN_MS },
  );
  offeneWebhooks.push(webhook.catch(() => null));
  await waitForStoreState(srv, () => rueckfrageStatus(id) === OFFEN);
}

const answerConsult = () => captureToolHandlers({ consultAllowed: true, language: "de" }).get("answer_consult");

test("answer_consult mit leerer Liste wird abgewiesen, die Rückfrage bleibt offen und nimmt danach die echte Antwort an", async () => {
  await stelleRueckfrage(ANRUF_LEER);
  const leer = await answerConsult()({ call_id: ANRUF_LEER, event_id: RUECKFRAGE, answers: [] });
  assert.equal(leer.structuredContent.accepted, false, LEERE_ANTWORT_SCHLIESST);
  assert.equal(rueckfrageStatus(ANRUF_LEER), OFFEN, LEERE_ANTWORT_SCHLIESST);

  const echt = await answerConsult()({ call_id: ANRUF_LEER, event_id: RUECKFRAGE, answers: [ECHTE_ANTWORT] });
  assert.deepEqual(echt.structuredContent, { accepted: true, merged_facts: 1 });
  assert.ok(gespeicherterAnruf(ANRUF_LEER).context.key_facts.includes(ECHTE_ANTWORT));
});

test("die leere Liste bekommt am Eingang dieselbe 400-Meldung wie ein fehlendes answers", async () => {
  await stelleRueckfrage(ANRUF_ROUTE);
  const antwort = await abrufMitFrist(`${srv.localUrl}/api/calls/${ANRUF_ROUTE}/consult/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_id: RUECKFRAGE, answers: [] }),
  });
  assert.equal(antwort.status, HTTP_BAD_REQUEST, LEERE_ANTWORT_SCHLIESST);
  assert.deepEqual(await antwort.json(), { error: "answers ist Pflicht" });
  assert.equal(rueckfrageStatus(ANRUF_ROUTE), OFFEN);
});

test("answer_consult mit status working ohne answers quittiert weiter und lässt die Rückfrage offen", async () => {
  await stelleRueckfrage(ANRUF_ARBEITET);
  const quittung = await answerConsult()({ call_id: ANRUF_ARBEITET, event_id: RUECKFRAGE, status: "working" });
  assert.equal(quittung.structuredContent.accepted, true);
  assert.equal(rueckfrageStatus(ANRUF_ARBEITET), OFFEN);
});

const ZIEL = "+4915112345678";
const TELNYX_BESITZER = { e164: "+13125550100", provider: "telnyx" };

async function starteSprachAttrappe() {
  const server = http.createServer((anfrage, antwort) => {
    anfrage.resume();
    anfrage.on("end", () => {
      antwort.setHeader("content-type", "application/json");
      antwort.end(JSON.stringify({ sid: "tnx_leere_antwort_1" }));
    });
  });
  await new Promise((bereit) => server.listen(0, "127.0.0.1", bereit));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    stop: () => new Promise((fertig) => server.close(fertig)),
  };
}

async function placeCallMitBriefing(context) {
  const sprache = await starteSprachAttrappe();
  const anrufServer = await startServer({
    env: {
      TELNYX_API_KEY: "KEYtest-secret",
      TELNYX_CONNECTION_ID: "conn_test",
      TELNYX_ACCOUNT_SID: "acct_test",
      TELNYX_API_BASE: sprache.url,
      ASSISTANT_CONTEXT_ENABLED: "true",
      PRECALL_BRIEFING_ENABLED: "true",
    },
    ownerNumber: TELNYX_BESITZER,
  });
  try {
    const briefingVorher = anthropicAttrappe.anfragen();
    const antwort = await abrufMitFrist(`${anrufServer.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: ZIEL, objective: "Termin vereinbaren", ...(context ? { context } : {}) }),
    });
    return { status: antwort.status, body: await antwort.json(), briefings: anthropicAttrappe.anfragen() - briefingVorher };
  } finally {
    await anrufServer.stop();
    await sprache.stop();
  }
}

test("place_call mit summary und key_facts wird angenommen und nennt die Zahl der Fakten", async () => {
  const ergebnis = await placeCallMitBriefing({ summary: "Stammkunde", key_facts: ["Name Mueller", "vormittags"] });
  assert.equal(ergebnis.status, HTTP_OK);
  assert.equal(ergebnis.body.context_received.key_facts_count, 2);
});

test("place_call mit leerer key_facts-Liste ruft das Vorab-Briefing nicht auf", async () => {
  const ergebnis = await placeCallMitBriefing({ key_facts: [] });
  assert.equal(ergebnis.status, HTTP_OK);
  assert.equal(ergebnis.briefings, 0);
  assert.equal(ergebnis.body.context_received.key_facts_count, 0);
});

test("Positivkontrolle: place_call ohne context ruft das Vorab-Briefing auf", async () => {
  const ergebnis = await placeCallMitBriefing(null);
  assert.ok(ergebnis.briefings > 0);
});
