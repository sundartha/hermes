import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { OWNER_TEST_FIRST_NAME, makeTelnyxSigner, nowSeconds, seedCall, seedState, startServer, waitUntil as wartebis } from "./helpers.js";
import { elInboundInitSpawnEnv } from "./_iel-inbound-harness.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";
import { echtWarten } from "./echt-warten.js";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const WARTE_FRIST_MS = 5_000;
const RUHE_MS = 150;
const EINMAL = 1;
const AUDIO_BYTES = 200_000;
const FERTIG = "completed";

const waitUntil = (bedingung, timeoutMs = WARTE_FRIST_MS) => wartebis(bedingung, { timeoutMs });
const koerper = (anfrage) => JSON.parse(anfrage.roh);
const istEl = (anfrage) => koerper(anfrage).command_id.endsWith("-el");
const calleeVon = (callId) => `cc_callee_${callId}`;
const elVon = (callId) => `cc_el_${callId}`;
const aktionen = (attrappe, bein, aktion) => attrappe.anfragen.filter((anfrage) => anfrage.path === `/v2/calls/${bein}/actions/${aktion}`);
const aufleger = (attrappe, callId) => [aktionen(attrappe, calleeVon(callId), "hangup").length, aktionen(attrappe, elVon(callId), "hangup").length];
const bruecken = (attrappe, callId) => aktionen(attrappe, calleeVon(callId), "bridge");

function beantworte({ req, res }, anfrage) {
  if (req.url.startsWith("/v1/text-to-speech/")) {
    res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
    return res.end(Buffer.alloc(AUDIO_BYTES, 1));
  }
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  if (req.url === "/v2/calls") {
    const kennung = koerper(anfrage).command_id.replace(/^vorspann-/, "").replace(/-el$/, "");
    return res.end(JSON.stringify({ data: { call_control_id: istEl(anfrage) ? elVon(kennung) : calleeVon(kennung) } }));
  }
  res.end(JSON.stringify({ data: { sid: "v3:ob-3365-3b", result: "ok" } }));
}

async function starteAttrappe() {
  const anfragen = [];
  const server = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", () => {
      const anfrage = { method: req.method, path: req.url, roh };
      anfragen.push(anfrage);
      beantworte({ req, res }, anfrage);
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

const umgebung = {};

before(async () => {
  umgebung.attrappe = await starteAttrappe();
  umgebung.signer = makeTelnyxSigner();
  const env = {
    ...elInboundInitSpawnEnv("agent_3365_h3b"),
    ELEVENLABS_OUTBOUND_ENABLED: "true",
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    TELNYX_CALL_CONTROL_APP_ID: "cc_app_3365_3b",
    ELEVENLABS_API_KEY: "test-key-3365",
    ELEVENLABS_API_BASE: umgebung.attrappe.url,
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_3365_3b",
    ELEVENLABS_RESULT_POLL_MS: "60000",
    TELNYX_API_BASE: umgebung.attrappe.url,
    TELNYX_API_KEY: "KEYtest-3365",
    TELNYX_CONNECTION_ID: "conn_3365",
    TELNYX_ACCOUNT_SID: "acct_3365",
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: umgebung.signer.publicKeyBase64,
    PUBLIC_URL: "https://agent.test",
  };
  const seed = seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] });
  umgebung.srv = await startServer({ env, seed });
});

after(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

let zaehler = 0;
const server = () => umgebung.srv;
const anrufIn = (id) => server().readStore().calls.find((eintrag) => eintrag.id === id);
const sprachAnfragen = (ab) => anfragenDerAttrappe().slice(ab).filter((anfrage) => anfrage.path.startsWith("/v1/text-to-speech/"));
const anfragenDerAttrappe = () => umgebung.attrappe.anfragen;
const log = (zeile) => server().stdout.includes(zeile);

function sende(callId, typ, { bein = calleeVon(callId), status } = {}) {
  const payload = { call_control_id: bein, ...(status ? { status } : {}) };
  const roh = JSON.stringify({ data: { id: `evt-3b-${(zaehler += EINMAL)}`, event_type: typ, payload } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": umgebung.signer.sign(zeit, roh) },
    body: roh,
  });
}
const wiedergabeEnde = (callId, status = FERTIG) => sende(callId, "call.playback.ended", { status });
const elAngenommen = (callId) => sende(callId, "call.answered", { bein: elVon(callId) });

async function waehleAnruf() {
  const antwort = await abrufMitFrist(`${umgebung.srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: `+4915112390${String((zaehler += EINMAL)).padStart(3, "0")}`, objective: "Termin am Donnerstag vereinbaren" }),
  });
  return (await antwort.json()).callId;
}

async function angenommenerAnruf() {
  const callId = await waehleAnruf();
  assert.equal((await sende(callId, "call.answered")).status, HTTP_OK);
  await waitUntil(() => aktionen(umgebung.attrappe, calleeVon(callId), "playback_start").length === EINMAL);
  await waitUntil(() => umgebung.attrappe.anfragen.some((anfrage) => anfrage.path === "/v2/calls" && koerper(anfrage).command_id === `vorspann-${callId}-el`));
  return callId;
}

test("3365-K22: Messzeilen mit Abstand seit Abheben und seit Vorspann-Ende, je Anruf mit Kennung", async () => {
  const callId = await angenommenerAnruf();
  await waitUntil(() => log(`[el-vorspann] playback_start ms_seit_abheben=`));
  await wiedergabeEnde(callId);
  await elAngenommen(callId);
  await waitUntil(() => bruecken(umgebung.attrappe, callId).length === EINMAL);
  await waitUntil(() => new RegExp(`bridge ms_seit_vorspann_ende=\\d+ call=${callId}`).test(server().stdout));
  const werte = [...server().stdout.matchAll(new RegExp(`\\[el-vorspann\\] (playback_start|el_angenommen|bridge) ms_seit_\\w+=(\\d+) call=${callId}`, "g"))];
  assert.deepEqual(werte.map((treffer) => treffer[1]).sort(), ["bridge", "el_angenommen", "playback_start"]);
  for (const treffer of werte) assert.ok(Number(treffer[2]) < WARTE_FRIST_MS * 2, `Messwert ${treffer[2]}`);
  assert.match(server().stdout, new RegExp(`el_angenommen ms_seit_abheben=\\d+ call=${callId}`));
});

test("3365-K22: zweites call.answered des EL-Beins -> el_angenommen wird nur einmal gemessen", async () => {
  const callId = await angenommenerAnruf();
  await elAngenommen(callId);
  await waitUntil(() => log(`[el-vorspann] el_angenommen ms_seit_abheben=`));
  await elAngenommen(callId);
  await echtWarten(RUHE_MS);
  const messungen = server().stdout.split("\n").filter((zeile) => zeile.includes("el_angenommen ms_seit_abheben=") && zeile.endsWith(` call=${callId}`));
  assert.equal(messungen.length, EINMAL);
});

test("3365-K15: abgespielter Vorspann steht als erste Agent-Zeile im Transkript, Logzeile offenlegung_abgespielt", async () => {
  const davor = anfragenDerAttrappe().length;
  const callId = await angenommenerAnruf();
  assert.equal(anrufIn(callId).transcript.length, 0);
  assert.ok(!log(`offenlegung_abgespielt call=${callId}`));
  await wiedergabeEnde(callId);
  await waitUntil(() => anrufIn(callId).transcript.length === EINMAL);
  const [zeile] = anrufIn(callId).transcript;
  assert.equal(zeile.role, "agent");
  const gesprochen = sprachAnfragen(davor);
  assert.equal(gesprochen.length, EINMAL);
  assert.ok(zeile.text.length > 0);
  assert.equal(zeile.text, koerper(gesprochen[0]).text);
  await waitUntil(() => log(`[el-vorspann] offenlegung_abgespielt call=${callId}`));
  await wiedergabeEnde(callId);
  await echtWarten(RUHE_MS);
  assert.equal(anrufIn(callId).transcript.length, EINMAL);
});

test("3365-K15: nicht vollstaendig abgespielter Vorspann steht nicht im Transkript", async () => {
  const callId = await angenommenerAnruf();
  await wiedergabeEnde(callId, "file_not_found");
  await waitUntil(() => aufleger(umgebung.attrappe, callId).join() === "1,1");
  assert.equal(anrufIn(callId).transcript.length, 0);
  assert.ok(!log(`offenlegung_abgespielt call=${callId}`));
});

test("3365-K15: Wiedergabe-Ende nach dem Abbruch -> weder Transkriptzeile noch Logzeile offenlegung_abgespielt", async () => {
  const callId = await angenommenerAnruf();
  await wiedergabeEnde(callId, "file_not_found");
  await waitUntil(() => aufleger(umgebung.attrappe, callId).join() === "1,1");
  await wiedergabeEnde(callId);
  await echtWarten(RUHE_MS);
  assert.equal(anrufIn(callId).transcript.length, 0);
  assert.ok(!log(`offenlegung_abgespielt call=${callId}`));
});
