import { test } from "node:test";
import assert from "node:assert/strict";

import { KOSTENPROFIL } from "../src/billing/kostenarten.js";
import { EL_CALL_BINDING_SIP_HEADER } from "../src/elevenlabs/inbound-sip-uri.js";
import {
  ELEVENLABS_INIT_PATH,
  INIT_TOKEN_HEADER,
  istInitWebhookAnfrage,
} from "../src/routes/webhooks-elevenlabs-init.js";
import { EL_INBOUND_ACCESS_BOOT_ENV, seedCall, startServer, waitForLog } from "./helpers.js";
import { INBOUND_TO, elInboundInitSpawnEnv, spawnSeedWartenderElCall } from "./_iel-inbound-harness.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const AGENT_ID = "agent_3395_init";
const INIT_TOKEN = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN;
const ABSENDER = "+15005550006";
const ANGERUFENER = "+491737250000";
const TOKEN_BREITE = 32;
const AUSGEHEND_ID = "call_3395_aus";
const EINGEHEND_ID = "call_3395_ein";
const BEENDET_ID = "call_3395_beendet";
const SCHLUESSEL_MAX = 20;
const KEIN_ANRUF = { error: "kein_laufender_anruf" };

const bindungsToken = (nummer) => String(nummer).padStart(TOKEN_BREITE, "0");

const ausgehendeBruecke = (overrides) =>
  seedCall({
    id: AUSGEHEND_ID,
    direction: "outbound",
    from: ABSENDER,
    to: ANGERUFENER,
    answeredAt: new Date().toISOString(),
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    streamToken: bindungsToken(1),
    ...overrides,
  });

function seed() {
  const eingehend = spawnSeedWartenderElCall({ callId: EINGEHEND_ID, bindungsToken: bindungsToken(2), answeredVorS: 1 });
  const beendet = ausgehendeBruecke({ id: BEENDET_ID, streamToken: bindungsToken(3), status: "completed" });
  return { ...eingehend, calls: [...eingehend.calls, ausgehendeBruecke(), beendet] };
}

async function mitServer(run) {
  const srv = await startServer({ env: elInboundInitSpawnEnv(AGENT_ID), seed: seed() });
  try {
    return await run(srv);
  } finally {
    await srv.stop();
  }
}

const sende = (srv, body) =>
  abrufMitFrist(`${srv.localUrl}${ELEVENLABS_INIT_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
    body: JSON.stringify(body),
  });

const koerper = ({ token, calledNumber, conversationId = "conv_3395", agentId = AGENT_ID }) => ({
  agent_id: agentId,
  conversation_id: conversationId,
  called_number: calledNumber,
  sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: token },
});

const zeilen = (srv, anfang) => srv.stdout.split("\n").filter((zeile) => zeile.startsWith(anfang));
const gespeichert = (srv, id) => srv.readStore().calls.find((call) => call.id === id);

test("3395-I1: nur POST auf den exakten Pfad zaehlt als Init-Anfrage", () => {
  const faelle = [
    ["POST", ELEVENLABS_INIT_PATH, true],
    ["GET", ELEVENLABS_INIT_PATH, false],
    ["PUT", ELEVENLABS_INIT_PATH, false],
    ["POST", `${ELEVENLABS_INIT_PATH}/`, false],
    ["POST", "/webhooks/elevenlabs/consult", false],
  ];
  for (const [method, path, erwartet] of faelle)
    assert.equal(istInitWebhookAnfrage({ method, path }), erwartet, `${method} ${path}`);
});

test("3395-I2: abgelehnte Anfrage -> Log mit Grund, bereinigten, sortierten und auf 20 begrenzten Schluesselnamen, ohne Anruf", async () => {
  await mitServer(async (srv) => {
    const viele = Object.fromEntries(Array.from({ length: SCHLUESSEL_MAX + 5 }, (_, nr) => [`s${String(nr).padStart(2, "0")}`, 1]));
    const antwort = await sende(srv, { ...viele, "z-ü x": 1, a: 1 });
    assert.equal(antwort.status, HTTP_NOT_FOUND);
    assert.deepEqual(await antwort.json(), KEIN_ANRUF);
    const sortiert = ["a", ...Object.keys(viele)].sort();
    const erwartet = sortiert.slice(0, SCHLUESSEL_MAX).join(",");
    assert.deepEqual(zeilen(srv, "[el-init] abgelehnt"), [
      `[el-init] abgelehnt grund=kein_wartender_anruf schluessel=${erwartet} sip_headers=fehlt`,
    ]);
    const bereinigt = await sende(srv, { "z-ü x": 1 });
    assert.equal(bereinigt.status, HTTP_NOT_FOUND);
    assert.ok(zeilen(srv, "[el-init] abgelehnt").includes("[el-init] abgelehnt grund=kein_wartender_anruf schluessel=z___x sip_headers=fehlt"));
  });
});

test("3395-I3: falsche agent_id und falsche called_number -> 404 mit Grund und Anruf im Log, keine Bindung", async () => {
  await mitServer(async (srv) => {
    const fremderAgent = await sende(srv, koerper({ token: bindungsToken(2), calledNumber: INBOUND_TO, agentId: "agent_fremd" }));
    assert.equal(fremderAgent.status, HTTP_NOT_FOUND);
    const andereNummer = await sende(srv, koerper({ token: bindungsToken(2), calledNumber: "+491709999999" }));
    assert.equal(andereNummer.status, HTTP_NOT_FOUND);
    assert.deepEqual(await andereNummer.json(), KEIN_ANRUF);
    const zeile = (grund) => zeilen(srv, `[el-init] abgelehnt grund=${grund} `);
    assert.match(zeile("agent")[0], new RegExp(`^\\[el-init\\] abgelehnt grund=agent schluessel=\\S+ sip_headers=objekt call=${EINGEHEND_ID}$`));
    assert.match(zeile("called_number")[0], new RegExp(`^\\[el-init\\] abgelehnt grund=called_number schluessel=\\S+ sip_headers=objekt call=${EINGEHEND_ID}$`));
    assert.equal(gespeichert(srv, EINGEHEND_ID).elevenlabsConversationId, null);
  });
});

test("3395-I4: ausgehende Bruecke - called_number muss die eigene Absendernummer sein, fehlend oder die des Angerufenen -> 404", async () => {
  await mitServer(async (srv) => {
    for (const calledNumber of [undefined, null, "", ANGERUFENER]) {
      const antwort = await sende(srv, koerper({ token: bindungsToken(1), calledNumber }));
      assert.equal(antwort.status, HTTP_NOT_FOUND, String(calledNumber));
    }
    assert.equal(gespeichert(srv, AUSGEHEND_ID).elevenlabsConversationId, null);
    assert.equal(zeilen(srv, "[el-init] abgelehnt grund=called_number ").length, 4);
    const ok = await sende(srv, koerper({ token: bindungsToken(1), calledNumber: "+1 500-555-0006" }));
    assert.equal(ok.status, HTTP_OK);
    assert.equal(gespeichert(srv, AUSGEHEND_ID).elevenlabsConversationId, "conv_3395");
  });
});

test("3395-I5: beendete Bruecke und unbekannte Kennung -> 404 ohne Bindung, Wiederholung derselben Unterhaltung wird als solche protokolliert", async () => {
  await mitServer(async (srv) => {
    const beendet = await sende(srv, koerper({ token: bindungsToken(3), calledNumber: ABSENDER }));
    assert.equal(beendet.status, HTTP_NOT_FOUND);
    assert.equal(gespeichert(srv, BEENDET_ID).elevenlabsConversationId ?? null, null);
    const unbekannt = await sende(srv, koerper({ token: bindungsToken(9), calledNumber: ABSENDER }));
    assert.equal(unbekannt.status, HTTP_NOT_FOUND);

    const erst = await sende(srv, koerper({ token: bindungsToken(1), calledNumber: ABSENDER }));
    const nochmal = await sende(srv, koerper({ token: bindungsToken(1), calledNumber: ABSENDER }));
    assert.equal(erst.status, HTTP_OK);
    assert.equal(nochmal.status, HTTP_OK);
    assert.deepEqual(await nochmal.json(), await erst.json());
    await waitForLog(srv, new RegExp(`\\[el-init\\] wiederholung call=${AUSGEHEND_ID}\\n`));
    assert.equal(zeilen(srv, `[el-init] gebunden call=${AUSGEHEND_ID} `).length, 1);
    assert.equal(zeilen(srv, "[el-init] wiederholung").length, 1);
  });
});
