import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { startServer, seedState, seedCall, waitForLog } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import {
  TENANT_TOKEN_VERDICT,
  tenantToolToken,
  tenantTokenVerdict,
} from "../src/elevenlabs/tenant-tool-token.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

const LOOKUP_PATH = "/webhooks/elevenlabs/lookup";
const CONSULT_PATH = "/webhooks/elevenlabs/consult";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";
const TOOL_TOKEN = "sec-p4-plattform-geheim";

const OWN_CALL_ID = "call_p4_eigen";
const OWN_CONVERSATION_ID = "conv_p4_eigen";
const FOREIGN_TENANT_ID = "tenant_p4_fremd";
const FOREIGN_CALL_ID = "call_p4_fremd";
const FOREIGN_CONVERSATION_ID = "conv_p4_fremd";
const LOCKED_TENANT_ID = "tenant_p4_gesperrt";
const LOCKED_CALL_ID = "call_p4_gesperrt";
const LOCKED_CONVERSATION_ID = "conv_p4_gesperrt";
const INVENTED_CONVERSATION_ID = "conv_p4_erfunden";

const QUERY = "opening hours of the town hall in Bremen";
const QUESTION = "Darf ich den Termin am Donnerstag zusagen?";
const FACT_TEXT = "Open Monday to Friday, 8am to 6pm";

const OWN_TENANT_TOKEN = tenantToolToken({
  secret: TOOL_TOKEN,
  tenantId: BOOTSTRAP_TENANT_ID,
});

const P4_ENV = Object.freeze({
  LOOKUP_ENABLED: "true",
  EXA_API_KEY: "exa-test-key",
  ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN,
  MULTI_TENANT: "true",
  SKIP_TWILIO_SIGNATURE_CHECK: "false",
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  CONSULT_WAIT_MS: "200",
  CONSULT_OPEN_MS: "1500",
  EL_CONSULT_DELIVERY_MS: "400",
  EL_CONSULT_ACK_MS: "400",
  EL_CONSULT_ANSWER_MS: "1500",
});

const SCHARF = Object.freeze({ ELEVENLABS_TENANT_TOKEN_REQUIRED: "true" });

const activeCall = (overrides) => seedCall({ status: "active", maxDurationS: 300, ...overrides });

function p4Seed() {
  return seedState({
    calls: [
      activeCall({ id: OWN_CALL_ID, elevenlabsConversationId: OWN_CONVERSATION_ID }),
      activeCall({
        id: FOREIGN_CALL_ID,
        tenantId: FOREIGN_TENANT_ID,
        elevenlabsConversationId: FOREIGN_CONVERSATION_ID,
      }),
      activeCall({
        id: LOCKED_CALL_ID,
        tenantId: LOCKED_TENANT_ID,
        elevenlabsConversationId: LOCKED_CONVERSATION_ID,
      }),
    ],
    profiles: {
      [FOREIGN_TENANT_ID]: { allowLookup: true, allowConsult: true, maxCallsPerHour: null },
    },
  });
}

async function startExaFake() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      requests.push(JSON.parse(raw || "{}"));
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          results: [{ title: "Rathaus", url: "https://x.invalid", highlights: [FACT_TEXT] }],
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function withP4Server({ env = {} } = {}, run) {
  const exa = await startExaFake();
  const srv = await startServer({
    env: { ...P4_ENV, EXA_API_BASE: exa.url, ...env },
    seed: p4Seed(),
  });
  try {
    return await run({ srv, exa });
  } finally {
    await srv.stop();
    await exa.close();
  }
}

const werkzeugAufruf = (srv, pfad, body) =>
  fetch(`${srv.localUrl}${pfad}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [TOOL_TOKEN_HEADER]: TOOL_TOKEN },
    body: JSON.stringify(body),
  });

const lookupBody = (conversationId, tenantToken) => ({
  conversation_id: conversationId,
  query: QUERY,
  tenant_token: tenantToken,
});

const consultBody = (conversationId, tenantToken) => ({
  conversation_id: conversationId,
  question: QUESTION,
  tenant_token: tenantToken,
});

const antwortVon = async (res) => ({ status: res.status, body: await res.json() });

async function logSchranke(srv) {
  const res = await fetch(`${srv.localUrl}/voice/status`, { method: "POST" });
  assert.equal(res.status, HTTP_FORBIDDEN, "Log-Schranke: /voice/status ohne Signatur = 403");
  await waitForLog(srv, /\[voice-signature\][^\n]*provider=unknown/);
}

test("SEC-P4-1: erfundene Kennung und GEBUNDENER fremder Anruf sind in Status UND Rumpf ununterscheidbar", async () => {
  await withP4Server({}, async ({ srv, exa }) => {
    const erfunden = await antwortVon(
      await werkzeugAufruf(srv, LOOKUP_PATH, lookupBody(INVENTED_CONVERSATION_ID)),
    );
    const gebunden = await antwortVon(
      await werkzeugAufruf(srv, LOOKUP_PATH, lookupBody(LOCKED_CONVERSATION_ID)),
    );

    assert.deepEqual(gebunden, erfunden);
    assert.equal(erfunden.status, HTTP_NOT_FOUND);
    assert.equal(exa.requests.length, 0, "keiner der beiden Aufrufe erreicht den Suchdienst");
  });
});

test("SEC-P4-2: die HEUTIGE Anbieter-Form ohne tenant_token laeuft am berechtigten Anruf durch", async () => {
  await withP4Server({}, async ({ srv, exa }) => {
    const res = await werkzeugAufruf(srv, LOOKUP_PATH, lookupBody(OWN_CONVERSATION_ID));
    assert.equal(res.status, HTTP_OK);
    const antwort = await res.json();
    assert.equal(antwort.status, "ok");
    assert.ok(antwort.answer.includes(FACT_TEXT), `Auskunft traegt den Fakt: ${antwort.answer}`);
    assert.equal(exa.requests.length, 1, "genau EIN Suchdienst-Aufruf");
  });
});

test("SEC-P4-3: mit Riegel scheitert der Aufruf fuer Mandant A am Anruf des FAEHIGEN Mandanten B - an der Bindung, nicht an dessen Konfiguration", async () => {
  await withP4Server({ env: SCHARF }, async ({ srv, exa }) => {
    const res = await werkzeugAufruf(
      srv,
      LOOKUP_PATH,
      lookupBody(FOREIGN_CONVERSATION_ID, OWN_TENANT_TOKEN),
    );
    assert.equal(res.status, HTTP_NOT_FOUND);
    assert.deepEqual(await res.json(), { error: "kein_laufender_anruf" });
    assert.equal(exa.requests.length, 0, "die Query hat den Server NIE verlassen");

    await waitForLog(srv, /\[el-lookup\] abgelehnt grund=mandant_fremd/);
    assert.ok(
      !srv.stdout.includes("grund=kanal_nicht_freigegeben"),
      "der Aufruf ist an der BINDUNG gescheitert, nicht an der Faehigkeit des Opfers",
    );
  });
});

test("SEC-P4-3b (ROTPROBE): im HEUTIGEN Zustand ist derselbe fremde Anruf ansprechbar", async () => {
  await withP4Server({}, async ({ srv, exa }) => {
    const res = await werkzeugAufruf(srv, LOOKUP_PATH, lookupBody(FOREIGN_CONVERSATION_ID));
    assert.equal(res.status, HTTP_OK, "ohne den Riegel ist der fremde Anruf ansprechbar");
    assert.equal(exa.requests.length, 1, "und der Suchdienst laeuft auf fremde Rechnung");
  });
});

test("SEC-P4-4: mit Riegel laeuft der Aufruf am EIGENEN Anruf des Mandanten durch (Positiv-Kontrolle)", async () => {
  await withP4Server({ env: SCHARF }, async ({ srv, exa }) => {
    const res = await werkzeugAufruf(
      srv,
      LOOKUP_PATH,
      lookupBody(OWN_CONVERSATION_ID, OWN_TENANT_TOKEN),
    );
    assert.equal(res.status, HTTP_OK);
    assert.equal((await res.json()).status, "ok");
    assert.equal(exa.requests.length, 1);
  });
});

test("SEC-P4-5: mit Riegel wird ein Aufruf GANZ OHNE tenant_token abgelehnt (fail-closed)", async () => {
  await withP4Server({ env: SCHARF }, async ({ srv, exa }) => {
    const res = await werkzeugAufruf(srv, LOOKUP_PATH, lookupBody(OWN_CONVERSATION_ID));
    assert.equal(res.status, HTTP_NOT_FOUND);
    assert.deepEqual(await res.json(), { error: "kein_laufender_anruf" });
    assert.equal(exa.requests.length, 0);
    await waitForLog(srv, /\[el-lookup\] abgelehnt grund=mandant_fehlt/);
  });
});

test("SEC-P4-6: ein VORGELEGTER falscher Wert wird auch bei AUSgeschaltetem Riegel abgelehnt", async () => {
  await withP4Server({}, async ({ srv, exa }) => {
    const res = await werkzeugAufruf(
      srv,
      LOOKUP_PATH,
      lookupBody(OWN_CONVERSATION_ID, "voellig-anderer-wert"),
    );
    assert.equal(res.status, HTTP_NOT_FOUND);
    assert.deepEqual(await res.json(), { error: "kein_laufender_anruf" });
    assert.equal(exa.requests.length, 0);
  });
});

test("SEC-P4-7: der Rueckfrage-Webhook bindet ueber dieselbe Funktion - gleiche Ergebnisse", async (ctx) => {
  await withP4Server({ env: SCHARF }, async ({ srv }) => {
    await ctx.test("fremder Anruf mit dem Token von Mandant A -> 404 uniform", async () => {
      const res = await werkzeugAufruf(
        srv,
        CONSULT_PATH,
        consultBody(FOREIGN_CONVERSATION_ID, OWN_TENANT_TOKEN),
      );
      assert.equal(res.status, HTTP_NOT_FOUND);
      assert.deepEqual(await res.json(), { error: "kein_laufender_anruf" });
      await waitForLog(srv, /\[el-consult\] abgelehnt grund=mandant_fremd/);
    });

    await ctx.test("erfundene Kennung -> derselbe Rumpf", async () => {
      const res = await werkzeugAufruf(
        srv,
        CONSULT_PATH,
        consultBody(INVENTED_CONVERSATION_ID, OWN_TENANT_TOKEN),
      );
      assert.equal(res.status, HTTP_NOT_FOUND);
      assert.deepEqual(await res.json(), { error: "kein_laufender_anruf" });
    });

    await ctx.test("eigener Anruf mit eigenem Token passiert die Bindung", async () => {
      const res = await werkzeugAufruf(
        srv,
        CONSULT_PATH,
        consultBody(OWN_CONVERSATION_ID, OWN_TENANT_TOKEN),
      );
      assert.notEqual(res.status, HTTP_NOT_FOUND);
      await waitForLog(srv, new RegExp(`\\[el-consult\\] call=${OWN_CALL_ID} ergebnis=`));
    });

    await ctx.test("keine Protokollzeile traegt den abgeleiteten Wert oder das Geheimnis", async () => {
      await logSchranke(srv);
      assert.ok(!srv.stdout.includes(OWN_TENANT_TOKEN), "abgeleiteter Token im Log");
      assert.ok(!srv.stdout.includes(TOOL_TOKEN), "Plattform-Geheimnis im Log");
    });
  });
});

const PIN_SECRET = "s";
const PIN_TENANT = "t";
const PIN_ANDERER_TENANT = "t2";
const PIN_TOKEN = "86e46dc5249308799605ff9fbb05ed0060d1832bdcbbc1080e61015e7361629a";

test("SEC-P4-8: die Ableitung ist gepinnt, mandanten-trennend und fail-closed", async (ctx) => {
  await ctx.test("Algorithmus-Pin", () => {
    assert.equal(tenantToolToken({ secret: PIN_SECRET, tenantId: PIN_TENANT }), PIN_TOKEN);
  });

  await ctx.test("verschiedene Mandanten ergeben verschiedene Werte", () => {
    assert.notEqual(
      tenantToolToken({ secret: PIN_SECRET, tenantId: PIN_ANDERER_TENANT }),
      PIN_TOKEN,
    );
  });

  await ctx.test("nicht ableitbar ergibt die EINE Leerform", () => {
    assert.equal(tenantToolToken({ secret: "", tenantId: PIN_TENANT }), "");
    assert.equal(tenantToolToken({ secret: PIN_SECRET, tenantId: "" }), "");
    assert.equal(tenantToolToken({ secret: PIN_SECRET, tenantId: null }), "");
  });

  await ctx.test("das Urteil ist fail-closed: ohne ableitbaren Sollwert nie PASSEND", () => {
    assert.equal(
      tenantTokenVerdict({ secret: "", tenantId: PIN_TENANT, presented: PIN_TOKEN }),
      TENANT_TOKEN_VERDICT.FREMD,
    );
    assert.equal(
      tenantTokenVerdict({ secret: PIN_SECRET, tenantId: "", presented: "" }),
      TENANT_TOKEN_VERDICT.FEHLT,
    );
  });

  await ctx.test("passend nur fuer den eigenen Mandanten", () => {
    assert.equal(
      tenantTokenVerdict({ secret: PIN_SECRET, tenantId: PIN_TENANT, presented: PIN_TOKEN }),
      TENANT_TOKEN_VERDICT.PASSEND,
    );
    assert.equal(
      tenantTokenVerdict({ secret: PIN_SECRET, tenantId: PIN_ANDERER_TENANT, presented: PIN_TOKEN }),
      TENANT_TOKEN_VERDICT.FREMD,
    );
  });
});
