import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import { OWNER_TEST_FIRST_NAME, seedCall, seedState, startServer, waitUntil } from "../helpers.js";
import { elInboundInitSpawnEnv } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const HTTP_CONFLICT = 409;
const HTTP_SERVER_ERROR = 500;
const AUDIO_BYTES = 200_000;
const EIGENE_NUMMER = "+4915112484701";
const ZIEL = "+4915112484799";
const AGENT_ID = "agent_4847_h2";
const RESERVE_FRIST_MS = 5_000;
const TARIF_CENTS = "20";

async function starteAttrappe({ ttsFehler = false } = {}) {
  const anfragen = [];
  const server = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", () => {
      anfragen.push(req.url);
      if (req.url.startsWith("/v1/text-to-speech/") && ttsFehler) {
        res.writeHead(HTTP_SERVER_ERROR, { "content-type": "application/json" });
        return res.end("{}");
      }
      if (req.url.startsWith("/v1/text-to-speech/")) {
        res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
        return res.end(Buffer.alloc(AUDIO_BYTES, 1));
      }
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      const kennung = roh.startsWith("{") ? JSON.parse(roh).command_id : "x";
      res.end(JSON.stringify({ data: { call_control_id: `cc_${kennung}`, sid: "v3:ob-4847", result: "ok" } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    anfragen,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

const nummer = (registrierung) => ({
  id: "num_4847",
  e164: EIGENE_NUMMER,
  tenantId: TENANT_ID,
  provider: "telnyx",
  status: "active",
  providerNumberId: null,
  providerAgentPhoneNumberId: registrierung,
});

async function anrufMitServer({ umgebung = {}, numbers, ttsFehler = false, zusatz = {} }) {
  const attrappe = await starteAttrappe({ ttsFehler });
  const srv = await startServer({
    env: {
      ...elInboundInitSpawnEnv(AGENT_ID),
      TELNYX_CALL_CONTROL_APP_ID: "cc_app_4847_h2",
      ELEVENLABS_API_KEY: "test-key-4847",
      ELEVENLABS_API_BASE: attrappe.url,
      ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_4847",
      ELEVENLABS_RESULT_POLL_MS: "60000",
      TELNYX_API_BASE: attrappe.url,
      TELNYX_API_KEY: "KEYtest-4847",
      TELNYX_CONNECTION_ID: "conn_4847",
      TELNYX_ACCOUNT_SID: "acct_4847",
      PUBLIC_URL: "https://agent.test",
      VOICE_TARIFF_DOMESTIC_CENTS: TARIF_CENTS,
      ...umgebung,
    },
    seed: seedState({
      tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }],
      numbers,
    }),
  });
  try {
    const antwort = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: ZIEL, objective: "Termin am Donnerstag vereinbaren", ...zusatz }),
    });
    const koerper = await antwort.json();
    if (antwort.status !== HTTP_OK)
      await waitUntil(() => srv.readStore().calls.some((eintrag) => eintrag.to === ZIEL && eintrag.reserveReleased), {
        timeoutMs: RESERVE_FRIST_MS,
      });
    const anruf = srv.readStore().calls.find((eintrag) => eintrag.to === ZIEL);
    return { status: antwort.status, koerper, anruf, anfragen: attrappe.anfragen, stdout: srv.stdout };
  } finally {
    await srv.stop();
    await attrappe.close();
  }
}

const wahlen = (anfragen) => anfragen.filter((pfad) => pfad === "/v2/calls");

test("ausgehend-nur-vorspann: ohne Schalter waehlt der Anruf ueber den Vorspann-Weg", async () => {
  const ergebnis = await anrufMitServer({ numbers: [nummer("phnum_4847")] });
  assert.equal(ergebnis.status, HTTP_OK);
  assert.equal(wahlen(ergebnis.anfragen).length > 0, true);
  assert.equal(ergebnis.anfragen.some((pfad) => pfad.startsWith("/v1/text-to-speech/")), true);
  assert.equal(ergebnis.anruf.from, EIGENE_NUMMER);
  assert.match(ergebnis.stdout, /^\[el-vorspann\] bereit call=/m);
  assert.doesNotMatch(ergebnis.stdout, /^\[el-vorspann\] rueckfall /m);
  assert.match(ergebnis.stdout, new RegExp(`^\\[el-outbound-weg\\] weg=telnyx_vorspann call=${ergebnis.anruf.id}$`, "m"));
});

test("ausgehend-nur-vorspann: ELEVENLABS_OUTBOUND_ENABLED=false aendert den Weg nicht", async () => {
  const ergebnis = await anrufMitServer({
    umgebung: { ELEVENLABS_OUTBOUND_ENABLED: "false", ELEVENLABS_OUTBOUND_UEBER_TELNYX: "false" },
    numbers: [nummer("phnum_4847")],
  });
  assert.equal(ergebnis.status, HTTP_OK);
  assert.equal(wahlen(ergebnis.anfragen).length > 0, true);
});

test("ausgehend-nur-vorspann: ohne TELNYX_CALL_CONTROL_APP_ID bricht der Anruf mit Grund ab und waehlt nicht", async () => {
  const ergebnis = await anrufMitServer({
    umgebung: { TELNYX_CALL_CONTROL_APP_ID: "" },
    numbers: [nummer("phnum_4847")],
  });
  assert.equal(ergebnis.status, HTTP_CONFLICT);
  assert.equal(ergebnis.koerper.grund, "keine_call_control_app");
  assert.equal(ergebnis.koerper.callId, ergebnis.anruf.id);
  assert.equal(wahlen(ergebnis.anfragen).length, 0);
  assert.equal(ergebnis.anruf.status, "failed");
  assert.equal(ergebnis.anruf.failureReason, "not-placed:keine_call_control_app");
  assert.equal(ergebnis.anruf.reserveReleased, true);
  assert.match(ergebnis.stdout, /^\[el-outbound-weg\] weg=abbruch grund=keine_call_control_app call=/m);
});

test("ausgehend-nur-vorspann: Mandantennummer ohne Registrierung bricht ab, die globale Nummer springt nicht ein", async () => {
  const ergebnis = await anrufMitServer({ numbers: [nummer(null)] });
  assert.equal(ergebnis.status, HTTP_SERVER_ERROR);
  assert.equal(wahlen(ergebnis.anfragen).length, 0);
  assert.equal(ergebnis.anruf.status, "failed");
  assert.equal(ergebnis.anruf.fromRegistrationSource, "abgebrochen:keine_eigene_registrierung");
  assert.equal(ergebnis.anruf.reserveReleased, true);
});

test("ausgehend-nur-vorspann: ist der Vorspann nicht erzeugbar (tts_fehler), bricht der Anruf mit Grund ab und waehlt nicht", async () => {
  const ergebnis = await anrufMitServer({ numbers: [nummer("phnum_4847")], ttsFehler: true });
  assert.equal(ergebnis.status, HTTP_CONFLICT);
  assert.equal(ergebnis.koerper.grund, "tts_fehler");
  assert.equal(wahlen(ergebnis.anfragen).length, 0);
  assert.equal(ergebnis.anruf.status, "failed");
  assert.equal(ergebnis.anruf.failureReason, "not-placed:tts_fehler");
  assert.equal(ergebnis.anruf.reserveReleased, true);
  assert.match(ergebnis.stdout, /^\[el-vorspann\] rueckfall grund=tts_fehler call=/m);
  assert.doesNotMatch(ergebnis.stdout, /^\[el-vorspann\] bereit /m);
});

test("ausgehend-nur-vorspann: ein Sprachwunsch mit ELEVENLABS_OUTBOUND_ENABLED=false antwortet 200 und waehlt ueber den Vorspann", async () => {
  const ergebnis = await anrufMitServer({
    umgebung: { ELEVENLABS_OUTBOUND_ENABLED: "false" },
    numbers: [nummer("phnum_4847")],
    zusatz: { language: "de" },
  });
  assert.equal(ergebnis.status, HTTP_OK);
  assert.equal(wahlen(ergebnis.anfragen).length > 0, true);
});
