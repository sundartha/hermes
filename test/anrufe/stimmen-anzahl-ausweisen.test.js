import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import { planProfileFor } from "../../src/plans.ts";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";
import { EL_OUTBOUND_AGENT_ID_BEISPIEL } from "../gemeinsam/erfundene-geheimnisse.js";
import {
  EL_OUTBOUND_BOOT_ENV,
  mcpPost,
  readToolResult,
  seedCall,
  seedState,
  startIdp,
  startServer,
  toolCall,
  waitForStoreState,
} from "../helpers.js";
import { CONVERSATION_DONE_WITH_ANALYSIS } from "../fixtures/elevenlabs-conversations.js";

const HTTP_OK = 200;
const HTTP_FEHLER = 500;
const FRIST_MS = 15000;
const POLL_TAKT_MS = 100;
const META_SCHLUESSEL = "hermes/stimmen_anzahl";
const TENANT = "t_stimmen";
const SUB = "sub-stimmen";
const CALL_ID = "call_stimmen_5004";
const DEUTSCHE_STIMME = "cqPdIo76zSHFDcSZpFov";
const FREMDE_STIMME = "stimme_des_agenten_beim_anbieter";
const EINS = 1;
const ZWEI = 2;
const AGENT_PFAD = `/v1/convai/agents/${EL_OUTBOUND_AGENT_ID_BEISPIEL}`;

const agent = ({ eigene, ueberschreibbar }) => ({
  conversation_config: { tts: { voice_id: eigene } },
  platform_settings: { overrides: { conversation_config_override: { tts: { voice_id: ueberschreibbar } } } },
});

async function starteAnbieter(agentAntwort) {
  const anbieter = { agentGets: 0 };
  const server = http.createServer((req, res) => {
    req.resume();
    if (req.url === AGENT_PFAD) {
      anbieter.agentGets += EINS;
      if (agentAntwort === null) {
        res.writeHead(HTTP_FEHLER, { "content-type": "application/json" });
        return res.end("{}");
      }
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      return res.end(JSON.stringify(agentAntwort));
    }
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(req.method === "DELETE" ? {} : CONVERSATION_DONE_WITH_ANALYSIS));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  anbieter.url = `http://127.0.0.1:${server.address().port}`;
  anbieter.close = () => new Promise((resolve) => server.close(resolve));
  return anbieter;
}

function anrufDerRichtung(richtung) {
  const jetzt = new Date().toISOString();
  const eingehend = richtung === "inbound";
  return seedCall({
    id: CALL_ID,
    tenantId: TENANT,
    direction: richtung,
    provider: "telnyx",
    twilioSid: `v3:${CALL_ID}`,
    from: eingehend ? "+4915112345678" : "+15005550006",
    to: eingehend ? "+15005550006" : "+4915112345678",
    language: "de",
    maxDurationS: 3600,
    costProfile: eingehend ? KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI : KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    answeredAt: jetzt,
    startedAt: jetzt,
    elevenlabsConversationId: CONVERSATION_DONE_WITH_ANALYSIS.conversation_id,
    elBoundAt: jetzt,
    ...(eingehend ? {} : { bridgedAt: jetzt }),
    fristAbfrageAt: jetzt,
    ...(eingehend ? { elNachlaufStartedAt: jetzt } : {}),
  });
}

async function mitAnruf({ richtung, agentAntwort }, lauf) {
  const anbieter = await starteAnbieter(agentAntwort);
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      MULTI_TENANT: "true",
      ...EL_OUTBOUND_BOOT_ENV,
      ELEVENLABS_API_BASE: anbieter.url,
      ELEVENLABS_RESULT_POLL_MS: String(POLL_TAKT_MS),
      FRISTEN_TAKT_MS: "40",
    },
    seed: seedState({
      tenants: [{ id: TENANT, idpSubject: SUB, status: "active", ownerName: "Stimmen Kunde" }],
      profiles: { [TENANT]: planProfileFor("business") },
      calls: [anrufDerRichtung(richtung)],
    }),
  });
  const werkzeug = async (name) =>
    readToolResult(await mcpPost(`${srv.localUrl}/mcp`, await idp.sign({ sub: SUB }), toolCall(name, { call_id: CALL_ID })));
  try {
    await waitForStoreState(srv, (stand) => stand.calls.some((call) => call.id === CALL_ID && call.status === "completed"), FRIST_MS);
    await lauf({ werkzeug, anbieter });
  } finally {
    await srv.stop();
    await idp.close();
    await anbieter.close();
  }
}

const FAELLE = [
  { name: "Agent hat dieselbe Stimme wie der Vorspann: eine Stimme", agentAntwort: agent({ eigene: DEUTSCHE_STIMME, ueberschreibbar: false }), erwartet: EINS },
  { name: "Agent gibt tts.voice_id nicht frei und spricht mit eigener Stimme (Fall 5183): ausgehend zwei Stimmen, eingehend eine Stimme", agentAntwort: agent({ eigene: FREMDE_STIMME, ueberschreibbar: false }), erwartet: ZWEI, erwartetEingehend: EINS },
  { name: "Agent gibt tts.voice_id frei: die angeforderte Stimme gilt, eine Stimme", agentAntwort: agent({ eigene: FREMDE_STIMME, ueberschreibbar: true }), erwartet: EINS },
];

for (const richtung of ["outbound", "inbound"]) {
  for (const fall of FAELLE) {
    test(`get_call_status und get_call_result (${richtung}): ${fall.name}`, async () => {
      await mitAnruf({ richtung, agentAntwort: fall.agentAntwort }, async ({ werkzeug, anbieter }) => {
        assert.ok(anbieter.agentGets >= EINS, "der Agent wird beim Anbieter gelesen");
        const erwartet = richtung === "inbound" ? (fall.erwartetEingehend ?? fall.erwartet) : fall.erwartet;
        const status = await werkzeug("get_call_status");
        const ergebnis = await werkzeug("get_call_result");
        assert.equal(status.structuredContent.status, "completed");
        assert.equal(status._meta[META_SCHLUESSEL], erwartet);
        assert.equal(ergebnis._meta[META_SCHLUESSEL], erwartet);
        assert.equal("stimmen_anzahl" in status.structuredContent, false);
        assert.equal("stimmen_anzahl" in ergebnis.structuredContent, false);
      });
    });
  }
}

test("scheitert die Agentenabfrage, endet der Anruf trotzdem und stimmen_anzahl fehlt", async () => {
  await mitAnruf({ richtung: "outbound", agentAntwort: null }, async ({ werkzeug }) => {
    const status = await werkzeug("get_call_status");
    const ergebnis = await werkzeug("get_call_result");
    assert.equal(status.structuredContent.status, "completed");
    assert.equal("_meta" in status, false);
    assert.equal(META_SCHLUESSEL in ergebnis._meta, false);
  });
});

test("keine voice_id steht in der Ausgabe der Werkzeuge", async () => {
  const antwort = agent({ eigene: FREMDE_STIMME, ueberschreibbar: false });
  await mitAnruf({ richtung: "outbound", agentAntwort: antwort }, async ({ werkzeug }) => {
    for (const name of ["get_call_status", "get_call_result"]) {
      const ausgabe = await werkzeug(name);
      assert.equal(ausgabe._meta[META_SCHLUESSEL], ZWEI);
      const text = JSON.stringify(ausgabe);
      assert.equal(text.includes(FREMDE_STIMME), false);
      assert.equal(text.includes(DEUTSCHE_STIMME), false);
    }
  });
});

for (const [name, antwort] of [
  ["Agent ohne Konfiguration", {}],
  ["Agent ohne Stimme in der Konfiguration", { conversation_config: { tts: {} } }],
  ["Agent mit leerer Stimmenkennung", { conversation_config: { tts: { voice_id: "" } } }],
]) {
  test(`${name}: stimmen_anzahl fehlt, auch wenn das Override freigegeben ist`, async () => {
    const mitFreigabe = { ...antwort, platform_settings: { overrides: { conversation_config_override: { tts: { voice_id: true } } } } };
    for (const agentAntwort of [antwort, mitFreigabe]) {
      await mitAnruf({ richtung: "outbound", agentAntwort }, async ({ werkzeug }) => {
        const status = await werkzeug("get_call_status");
        const ergebnis = await werkzeug("get_call_result");
        assert.equal("_meta" in status, false);
        assert.equal(META_SCHLUESSEL in ergebnis._meta, false);
      });
    }
  });
}

const FRANZOESISCHE_STIMME = "WeAAwKYcS06VmXw086yZ";
const EIGENE_NUMMER = "+15005550006";

async function mitNummerEigenerSprache({ richtung, sprache, agentAntwort }, lauf) {
  const anbieter = await starteAnbieter(agentAntwort);
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      MULTI_TENANT: "true",
      ...EL_OUTBOUND_BOOT_ENV,
      ELEVENLABS_API_BASE: anbieter.url,
      ELEVENLABS_RESULT_POLL_MS: String(POLL_TAKT_MS),
      FRISTEN_TAKT_MS: "40",
    },
    seed: seedState({
      tenants: [{ id: TENANT, idpSubject: SUB, status: "active", ownerName: "Stimmen Kunde" }],
      profiles: { [TENANT]: planProfileFor("business") },
      numbers: [{ id: "num_stimme", e164: EIGENE_NUMMER, tenantId: TENANT, provider: "telnyx", status: "active", providerNumberId: null, language: sprache }],
      calls: [{ ...anrufDerRichtung(richtung), language: undefined }],
    }),
  });
  try {
    await waitForStoreState(srv, (stand) => stand.calls.some((call) => call.id === CALL_ID && call.status === "completed"), FRIST_MS);
    const token = await idp.sign({ sub: SUB });
    const frage = async (name) => readToolResult(await mcpPost(`${srv.localUrl}/mcp`, token, toolCall(name, { call_id: CALL_ID })));
    await frage("get_call_status");
    await lauf((await frage("get_call_result"))._meta[META_SCHLUESSEL]);
  } finally {
    await srv.stop();
    await idp.close();
    await anbieter.close();
  }
}

test("get_call_result (outbound): die Nummer des Absenders mit französischer Sprache fordert die französische Stimme an, eine Stimme", async () => {
  const agentAntwort = agent({ eigene: FRANZOESISCHE_STIMME, ueberschreibbar: false });
  await mitNummerEigenerSprache({ richtung: "outbound", sprache: "fr", agentAntwort }, async (anzahl) => assert.equal(anzahl, ZWEI));
});

test("get_call_result (outbound): die Nummer des Absenders mit deutscher Sprache fordert nicht die französische Stimme an, zwei Stimmen", async () => {
  const agentAntwort = agent({ eigene: FRANZOESISCHE_STIMME, ueberschreibbar: false });
  await mitNummerEigenerSprache({ richtung: "outbound", sprache: "de", agentAntwort }, async (anzahl) => assert.equal(anzahl, ZWEI));
});

test("get_call_result (inbound): die angerufene Nummer mit französischer Sprache gibt eine Stimme aus", async () => {
  const agentAntwort = agent({ eigene: FRANZOESISCHE_STIMME, ueberschreibbar: false });
  await mitNummerEigenerSprache({ richtung: "inbound", sprache: "fr", agentAntwort }, async (anzahl) => assert.equal(anzahl, EINS));
});
