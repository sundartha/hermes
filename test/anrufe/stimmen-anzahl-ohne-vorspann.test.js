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

function anrufDerRichtung(richtung, vorspannGespielt) {
  const { startedAt: jetzt } = seedCall({});
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
    fristAbfrageAt: jetzt,
    ...(eingehend ? { elNachlaufStartedAt: jetzt } : {}),
    ...(vorspannGespielt ? { bridgedAt: jetzt } : {}),
  });
}

async function mitAnruf({ richtung, agentAntwort, vorspannGespielt = false }, lauf) {
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
      calls: [anrufDerRichtung(richtung, vorspannGespielt)],
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

const OHNE_FREIGABE = agent({ eigene: FREMDE_STIMME, ueberschreibbar: false });
const MIT_FREIGABE = agent({ eigene: FREMDE_STIMME, ueberschreibbar: true });

const FAELLE = [
  { name: "ausgehend, Vorspann gespielt, Agent ohne Freigabe: zwei Stimmen", richtung: "outbound", vorspannGespielt: true, agentAntwort: OHNE_FREIGABE, erwartet: ZWEI },
  { name: "ausgehend, Vorspann nicht gespielt, Agent ohne Freigabe: eine Stimme", richtung: "outbound", vorspannGespielt: false, agentAntwort: OHNE_FREIGABE, erwartet: EINS },
  { name: "eingehend ohne Vorspann, Agent ohne Freigabe: eine Stimme", richtung: "inbound", vorspannGespielt: false, agentAntwort: OHNE_FREIGABE, erwartet: EINS },
  { name: "ausgehend, Vorspann gespielt, Agent mit Freigabe: eine Stimme", richtung: "outbound", vorspannGespielt: true, agentAntwort: MIT_FREIGABE, erwartet: EINS },
  { name: "ausgehend, Vorspann nicht gespielt, Agent mit Freigabe: eine Stimme", richtung: "outbound", vorspannGespielt: false, agentAntwort: MIT_FREIGABE, erwartet: EINS },
  { name: "eingehend, Agent mit Freigabe: eine Stimme", richtung: "inbound", vorspannGespielt: false, agentAntwort: MIT_FREIGABE, erwartet: EINS },
];

for (const fall of FAELLE) {
  test(`get_call_status und get_call_result: ${fall.name}`, async () => {
    await mitAnruf(fall, async ({ werkzeug }) => {
      const status = await werkzeug("get_call_status");
      const ergebnis = await werkzeug("get_call_result");
      assert.equal(status._meta[META_SCHLUESSEL], fall.erwartet);
      assert.equal(ergebnis._meta[META_SCHLUESSEL], fall.erwartet);
      const text = JSON.stringify([status, ergebnis]);
      assert.equal(text.includes(FREMDE_STIMME), false);
      assert.equal(text.includes("bridgedAt"), false);
    });
  });
}

test("scheitert die Agentenabfrage, fehlt stimmen_anzahl auch bei gespieltem Vorspann", async () => {
  await mitAnruf({ richtung: "outbound", vorspannGespielt: true, agentAntwort: null }, async ({ werkzeug }) => {
    const ergebnis = await werkzeug("get_call_result");
    assert.equal(META_SCHLUESSEL in ergebnis._meta, false);
  });
});
