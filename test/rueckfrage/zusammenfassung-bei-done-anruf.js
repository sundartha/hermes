import http from "node:http";

import { startServer, seedState, seedCall, nowSeconds } from "../helpers.js";
import { abrufMitFrist, mitAntwortfrist } from "../gemeinsam/antwortfrist.mjs";
import { registerTools } from "../../src/mcp-tools.js";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";

export const ENV = Object.freeze({
  CONSULT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
});

export const ABGELAUFEN = Symbol("abgelaufen");
const MS_JE_S = 1000;

export async function vorFrist(fristMs, arbeit) {
  const frist = new Promise((fertig) => {
    AbortSignal.timeout(fristMs).addEventListener("abort", () => fertig(ABGELAUFEN), { once: true });
  });
  return Promise.race([arbeit, frist]);
}

const MCP_TENANT = seedCall().tenantId;
const MCP_ANRUF = "call_4065_zusammenfassung";
export const MCP_SUMMARY = "Der Termin am Donnerstag um zehn Uhr ist vereinbart.";
const POLL_TAKT_MS = 300;
const HOECHSTDAUER_S = 120;
export const HALTEZEIT_MS = 22000;
export const GATEWAY_ABBRUCH_MS = 25000;
export const LANGSAMER_START_MS = 5000;
export const FRIST_REST_MS = 1000;
const SERVER_RUNDEN = 10;

const gespraech = (status) => ({
  conversation_id: "conv_4065",
  status,
  transcript: [
    { role: "agent", message: "Passt Donnerstag um zehn?" },
    { role: "user", message: "Ja, passt." },
  ],
  analysis: { call_successful: "success" },
  metadata: { call_duration_secs: 2, phone_call: { direction: "outbound", call_id: "otb_4065" } },
});

const modellAntwort = (text) => ({
  id: "msg_4065",
  type: "message",
  role: "assistant",
  model: "claude-haiku-4-5",
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 20, output_tokens: 30 },
});

function lausche(handler) {
  const server = http.createServer(handler);
  return new Promise((bereit) => server.listen(0, "127.0.0.1", () => bereit(server)));
}

function neuesTor() {
  let oeffnen;
  const offen = new Promise((fertig) => {
    oeffnen = fertig;
  });
  return { offen, oeffnen };
}

export async function mitEndendemAnruf({ startVerzoegerungMs = 0 }, run) {
  const urteilBegonnen = neuesTor();
  const urteilTor = neuesTor();
  const modell = await lausche((req, res) => {
    req.on("data", () => {});
    req.on("end", async () => {
      urteilBegonnen.oeffnen();
      await urteilTor.offen;
      res.setHeader("content-type", "application/json");
      const urteil = { summary: MCP_SUMMARY, actionItems: [], objective_achieved: true };
      res.end(JSON.stringify(modellAntwort(JSON.stringify(urteil))));
    });
  });
  let beendet = false;
  const elevenLabs = await lausche((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(gespraech(beendet ? "done" : "processing")));
  });
  const angelegtAm = new Date(nowSeconds() * MS_JE_S - startVerzoegerungMs).toISOString();
  const srv = await startServer({
    env: {
      ...ENV,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${modell.address().port}`,
      ANTHROPIC_API_KEY: "test-4065-key",
      ELEVENLABS_API_BASE: `http://127.0.0.1:${elevenLabs.address().port}`,
      ELEVENLABS_API_KEY: "test-key",
      ELEVENLABS_RESULT_POLL_MS: String(POLL_TAKT_MS),
      FRISTEN_TAKT_MS: String(POLL_TAKT_MS),
    },
    seed: seedState({
      calls: [
        seedCall({
          id: MCP_ANRUF,
          costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
          goal: "Termin am Donnerstag vereinbaren",
          elevenlabsConversationId: "conv_4065",
          answeredAt: angelegtAm,
          fristAbfrageAt: angelegtAm,
          maxDurationS: HOECHSTDAUER_S,
        }),
      ],
    }),
  });
  let abrufAngekommen = neuesTor();
  const weiterleiter = await lausche((req, res) => {
    const istAbruf = req.url.includes("/consult");
    const nach = mitAntwortfrist(
      http.request(
        { hostname: "localhost", port: srv.port, path: req.url, method: req.method, headers: req.headers },
        (antwort) => {
          res.writeHead(antwort.statusCode, antwort.headers);
          antwort.pipe(res);
        },
      ),
      { wartezeitMs: GATEWAY_ABBRUCH_MS },
    );
    if (istAbruf) nach.on("finish", abrufAngekommen.oeffnen);
    req.pipe(nach);
  });
  const vorher = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = `http://127.0.0.1:${weiterleiter.address().port}`;
  const handlers = new Map();
  registerTools(
    { registerTool: (name, _config, handler) => handlers.set(name, handler), registerResource() {} },
    { identity: null, scopedTenant: MCP_TENANT, consultAllowed: true, language: "de" },
  );
  const abfrage = async () => {
    const ergebnis = await handlers.get("await_call_event")({ call_id: MCP_ANRUF, after_event_id: undefined });
    return { data: ergebnis.structuredContent };
  };
  const beendeAnruf = async () => {
    beendet = true;
    await urteilBegonnen.offen;
    abrufAngekommen = neuesTor();
  };
  const gibUrteilFrei = async () => {
    await abrufAngekommen.offen;
    for (let runde = 0; runde < SERVER_RUNDEN; runde++) await abrufMitFrist(`${srv.localUrl}/healthz`);
    setImmediate(urteilTor.oeffnen);
  };
  try {
    return await run({ abfrage, beendeAnruf, gibUrteilFrei });
  } finally {
    if (vorher === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = vorher;
    await srv.stop();
    weiterleiter.closeAllConnections();
    await new Promise((fertig) => weiterleiter.close(fertig));
    await new Promise((fertig) => modell.close(fertig));
    await new Promise((fertig) => elevenLabs.close(fertig));
  }
}
