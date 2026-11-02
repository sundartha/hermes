import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { makeTelnyxSigner, placeCall, postTelnyxIncoming, seedState, seedWithTelnyxNumber, startServer, stdioServerTransport, waitForLog } from "../helpers.js";
import { starteJsonAttrappe } from "../anrufe/attrappen-server.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KENNUNG_HEADER = "x-request-id";
const FREMDE_KENNUNG = "von-aussen-1234567890";
const MIT_KENNUNG_IN_LOGS = Object.freeze({ LOG_REQUEST_ID: "true" });

async function ladeKonfigurationMit(wert, lade) {
  const gemerkt = process.env.LOG_REQUEST_ID;
  try {
    if (wert === undefined) delete process.env.LOG_REQUEST_ID;
    else process.env.LOG_REQUEST_ID = wert;
    return await lade();
  } finally {
    if (gemerkt === undefined) delete process.env.LOG_REQUEST_ID;
    else process.env.LOG_REQUEST_ID = gemerkt;
  }
}

async function mitServer(optionen, lauf) {
  const srv = await startServer(optionen);
  try {
    return await lauf(srv);
  } finally {
    await srv.stop();
  }
}

test("Anfrage-ID: jede Antwort traegt X-Request-Id, zwei Anfragen haben zwei verschiedene", async () => {
  await mitServer({}, async (srv) => {
    const erste = await abrufMitFrist(`${srv.localUrl}/healthz`);
    const zweite = await abrufMitFrist(`${srv.localUrl}/healthz`);
    assert.match(erste.headers.get(KENNUNG_HEADER), UUID);
    assert.match(zweite.headers.get(KENNUNG_HEADER), UUID);
    assert.notEqual(erste.headers.get(KENNUNG_HEADER), zweite.headers.get(KENNUNG_HEADER));
  });
});

test("Anfrage-ID: auch eine Antwort auf einen unbekannten Pfad traegt sie", async () => {
  await mitServer({}, async (srv) => {
    const antwort = await abrufMitFrist(`${srv.localUrl}/gibt-es-nicht`);
    assert.equal(antwort.status, 404);
    assert.match(antwort.headers.get(KENNUNG_HEADER), UUID);
  });
});

test("Anfrage-ID: eine vom Aufrufer mitgeschickte X-Request-Id wird nicht uebernommen", async () => {
  await mitServer({}, async (srv) => {
    const antwort = await abrufMitFrist(`${srv.localUrl}/healthz`, { headers: { [KENNUNG_HEADER]: FREMDE_KENNUNG } });
    assert.notEqual(antwort.headers.get(KENNUNG_HEADER), FREMDE_KENNUNG);
    assert.match(antwort.headers.get(KENNUNG_HEADER), UUID);
  });
});

test("Anfrage-ID: mit Schalter steht dieselbe ID vor der Antwortzeile des Webhooks", async () => {
  const optionen = { seed: seedWithTelnyxNumber({ language: "de" }), env: MIT_KENNUNG_IN_LOGS };
  await mitServer(optionen, async (srv) => {
    const antwort = await postTelnyxIncoming(srv, { callSid: "CAkennung" });
    const kennung = antwort.headers.get(KENNUNG_HEADER);
    await waitForLog(srv, /^rid=\S+ \[voice-antwort\] weg=\/voice\/incoming ms=\d+ status=\d+ ende=beendet$/m);
    const zeile = srv.stdout.match(/^rid=(\S+) \[voice-antwort\] weg=\/voice\/incoming/m);
    assert.match(kennung, UUID);
    assert.equal(zeile[1], kennung);
  });
});

test("Anfrage-ID: mit Schalter tragen Logzeilen waehrend der Anfrage die ID, die Startzeilen nicht", async () => {
  const optionen = { seed: seedWithTelnyxNumber({ language: "de" }), env: MIT_KENNUNG_IN_LOGS };
  await mitServer(optionen, async (srv) => {
    await postTelnyxIncoming(srv, { callSid: "CAstart" });
    await waitForLog(srv, /^rid=[0-9a-f-]{36} \[voice-antwort\]/m);
    const startZeilen = srv.stdout.split("\n").filter((zeile) => zeile.includes("laeuft auf http"));
    assert.equal(startZeilen.length, 1);
    assert.ok(!startZeilen[0].startsWith("rid="));
  });
});

test("Anfrage-ID: ohne Schalter bleiben alle Logzeilen unveraendert", async () => {
  const optionen = { seed: seedWithTelnyxNumber({ language: "de" }) };
  await mitServer(optionen, async (srv) => {
    const antwort = await postTelnyxIncoming(srv, { callSid: "CAohneschalter" });
    assert.match(antwort.headers.get(KENNUNG_HEADER), UUID);
    await waitForLog(srv, /^\[voice-antwort\] weg=\/voice\/incoming/m);
    assert.ok(!srv.stdout.includes("rid="));
  });
});

test("Anfrage-ID: maschinenlesbare [metrics]-Zeilen bleiben auch mit Schalter unveraendert", async () => {
  const seed = seedState({
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", firstName: "Jonas", ownerName: "Jonas Beispiel", country: "DE", defaultLanguage: "de" }],
  });
  const env = { ...MIT_KENNUNG_IN_LOGS, METRICS_ENABLED: "true", ALLOWED_COUNTRY_CODES: "+49" };
  await mitServer({ env, seed }, async (srv) => {
    const antwort = await placeCall(srv, "+12025550143");
    assert.equal(antwort.status, 403);
    await waitForLog(srv, /^\[metrics\] call_denied \{.*\}$/m);
    assert.ok(!srv.stdout.split("\n").some((zeile) => zeile.includes("[metrics]") && zeile.includes("rid=")));
  });
});

test("Anfrage-ID: LOG_REQUEST_ID ungesetzt ist aus, ohne dass der Start verweigert wird", async () => {
  const frisch = await ladeKonfigurationMit(undefined, () => import("../../src/config.js?anfrage-kennung-ungesetzt"));
  assert.strictEqual(frisch.config.metrics.logRequestId, false);
  assert.ok(!frisch.configFatalErrors().some((befund) => befund.includes("LOG_REQUEST_ID")));
});

test("Anfrage-ID: LOG_REQUEST_ID=true schaltet die ID in den Logzeilen an", async () => {
  const frisch = await ladeKonfigurationMit("true", () => import("../../src/config.js?anfrage-kennung-an"));
  assert.strictEqual(frisch.config.metrics.logRequestId, true);
});

test("Anfrage-ID: ein ungueltiger LOG_REQUEST_ID-Wert bleibt aus und wird beim Start benannt", async () => {
  const frisch = await ladeKonfigurationMit("vielleicht", () => import("../../src/config.js?anfrage-kennung-ungueltig"));
  assert.strictEqual(frisch.config.metrics.logRequestId, false);
  assert.ok(frisch.configFatalErrors().some((befund) => befund.includes("LOG_REQUEST_ID")));
});

function sammleNurStdout(srv) {
  const nurStdout = { text: "" };
  srv.child.stdout.on("data", (stueck) => (nurStdout.text += stueck.toString()));
  return nurStdout;
}

test("Anfrage-ID: mit Schalter traegt auch die normale stdout-Ausgabe waehrend einer Anfrage die ID", async () => {
  const optionen = { seed: seedWithTelnyxNumber({ language: "de" }), env: MIT_KENNUNG_IN_LOGS };
  await mitServer(optionen, async (srv) => {
    const nurStdout = sammleNurStdout(srv);
    const antwort = await postTelnyxIncoming(srv, { callSid: "CAnurstdout" });
    const kennung = antwort.headers.get(KENNUNG_HEADER);
    await waitForLog(srv, /\[voice-antwort\] weg=\/voice\/incoming ms=\d+ status=\d+ ende=beendet$/m);
    const erwartet = new RegExp(`^rid=${kennung} \\[voice-antwort\\] weg=\\/voice\\/incoming`, "m");
    assert.match(nurStdout.text, erwartet, `Log-Pattern ${erwartet} fehlt auf stdout:\n${nurStdout.text}`);
  });
});

const NUMMER_IM_LOG = "+491701234567";
const MASKIERTE_ZEILE = /^(rid=[0-9a-f-]{36} )?\[voice\/outbound\] unbekannter Call \(callId=\*\*\*4567#[0-9a-f]+\) -> Hangup$/m;
const UNBEKANNTE_ZIELNUMMER = "+491709876543";
const MASKIERTE_STDOUT_ZEILE = /^(rid=[0-9a-f-]{36} )?\[audit\] inbound_unrouted ip=\S+ to=\*\*\*6543#[0-9a-f]{6}$/m;

test("[NIE1] mit Schalter bleibt eine Nummer in einer Logzeile waehrend der Anfrage maskiert", async () => {
  const optionen = { seed: seedWithTelnyxNumber({ language: "de" }), env: MIT_KENNUNG_IN_LOGS };
  await mitServer(optionen, async (srv) => {
    const nurStdout = sammleNurStdout(srv);
    const ziel = `${srv.localUrl}/voice/outbound?callId=${encodeURIComponent(NUMMER_IM_LOG)}`;
    await abrufMitFrist(ziel, { method: "POST" });
    await postTelnyxIncoming(srv, { callSid: "CAunbekannt", to: UNBEKANNTE_ZIELNUMMER });
    await waitForLog(srv, /\[voice\/outbound\] unbekannter Call/);
    await waitForLog(srv, /\[audit\] inbound_unrouted/);
    assert.ok(!srv.stdout.includes(NUMMER_IM_LOG), "die Nummer steht unmaskiert im Log");
    assert.match(srv.stdout, MASKIERTE_ZEILE);
    assert.ok(!nurStdout.text.includes(UNBEKANNTE_ZIELNUMMER), `die Zielnummer steht unmaskiert auf stdout:\n${nurStdout.text}`);
    assert.match(nurStdout.text, MASKIERTE_STDOUT_ZEILE);
  });
});

const NUMMER_IM_WERKZEUG = "+491511234567";

test("[NIE2] mit Schalter liefert der stdio-MCP-Einstieg die Werkzeugantwort auf stdout unmaskiert", async () => {
  const koerper = { agent: { number: NUMMER_IM_WERKZEUG, owner: "Jonas" }, usage: { calls: 1 }, settings: {} };
  const gateway = await starteJsonAttrappe(koerper);
  try {
    const { transport, stderr } = stdioServerTransport({ ...MIT_KENNUNG_IN_LOGS, GATEWAY_URL: gateway.url });
    const client = new Client({ name: "anfrage-kennung-stdio", version: "0.0.0" });
    try {
      await client.connect(transport);
      const ergebnis = await client.callTool({ name: "get_agent_status", arguments: {} });
      assert.equal(ergebnis.structuredContent?.number, NUMMER_IM_WERKZEUG, `stderr: ${stderr.text}`);
    } finally {
      await client.close();
    }
  } finally {
    await gateway.close();
  }
});

const HTTP_FORBIDDEN = 403;

test("[NIE3] mit Schalter weist der Webhook einen unsignierten Anruf weiter ab und legt keinen Anruf an", async () => {
  const signierer = makeTelnyxSigner();
  const env = { ...MIT_KENNUNG_IN_LOGS, SKIP_TWILIO_SIGNATURE_CHECK: "false", TELNYX_PUBLIC_KEY: signierer.publicKeyBase64 };
  await mitServer({ seed: seedWithTelnyxNumber({ language: "de" }), env }, async (srv) => {
    const antwort = await postTelnyxIncoming(srv, { callSid: "CAunsigniert" });
    assert.equal(antwort.status, HTTP_FORBIDDEN);
    assert.equal(srv.readStore().calls.length, 0);
  });
});

function warteAufStderrZeile(srv, stderrText, muster) {
  return new Promise((fertig) => {
    if (muster.test(stderrText.text)) return fertig();
    const pruefe = () => {
      if (!muster.test(stderrText.text)) return;
      srv.child.stderr.off("data", pruefe);
      fertig();
    };
    srv.child.stderr.on("data", pruefe);
  });
}

test("Anfrage-ID: mit Schalter beginnt eine stderr-Zeile waehrend der Anfrage mit rid=<ID> und Leerzeichen", async () => {
  await mitServer({ seed: seedWithTelnyxNumber({ language: "de" }), env: MIT_KENNUNG_IN_LOGS }, async (srv) => {
    const nurStderr = { text: "" };
    srv.child.stderr.on("data", (stueck) => (nurStderr.text += stueck.toString()));
    const ziel = `${srv.localUrl}/voice/outbound?callId=erfundene-kennung-stderr`;
    const antwort = await abrufMitFrist(ziel, { method: "POST" });
    const kennung = antwort.headers.get(KENNUNG_HEADER);
    assert.match(kennung, UUID);
    await warteAufStderrZeile(srv, nurStderr,/\[voice\/outbound\] unbekannter Call/);
    const zeilen = nurStderr.text.split("\n").filter((zeile) => zeile.includes("[voice/outbound] unbekannter Call"));
    assert.equal(zeilen.length, 1, `stderr:\n${nurStderr.text}`);
    assert.ok(zeilen[0].startsWith(`rid=${kennung} `), `stderr-Zeile ohne rid=${kennung} am Anfang:\n${nurStderr.text}`);
  });
});
