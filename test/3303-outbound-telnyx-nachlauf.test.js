import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";

import { KOSTENART, KOSTENPROFIL, pflichtTraegerFuerProfil } from "../src/billing/kostenarten.js";
import { nachlaufPolitikFuer } from "../src/elevenlabs/nachlauf-politik.js";
import { makeVoiceRoutes } from "../src/routes/voice.js";
import { hangup } from "../src/telephony/directives.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { seedCall, seedState, startServer, startTelnyxProvisioningMock, waitForStoreState, waitUntil } from "./helpers.js";
import { CONV_ID, isoVor, starteAnbieterAttrappe } from "./_iel-inbound-harness.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";

const OUTBOUND_EL = KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI;
const FRIST_MS = 15000;
const WARTE = { timeoutMs: FRIST_MS, pollIntervalMs: 20 };
const POLL_TAKT_MS = 200;
const LANGER_TAKT_MS = 60000;
const MAX_DAUER_S = 3600;
const FRISCH_S = 5;
const JUNG_GEBUNDEN_S = 1;
const ALT_GEBUNDEN_S = 30;
const EINMAL = 1;
const ZWEIMAL = 2;
const HTTP_OK = 200;
const GRUND_GESCHEITERT = "el_uebergabe_gescheitert";
const ZUSAMMENFASSUNG = "Termin am Donnerstag um 10 Uhr vereinbart.";
const NAECHSTER_SCHRITT = "Termin am Donnerstag um 10 Uhr eintragen";
const ZEILEN = ["Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas Beispiel.", "Donnerstag um zehn passt."];
const EL_KOSTEN_USD = 0.12;
const GESPRAECH_S = 60;

const GESPRAECH_FERTIG = Object.freeze({
  conversation_id: CONV_ID,
  status: "done",
  transcript: [{ role: "agent", message: ZEILEN[0] }, { role: "user", message: ZEILEN[1] }],
  analysis: { call_successful: "success", transcript_summary: ZUSAMMENFASSUNG, data_collection_results: { appointment_date: { value: "Donnerstag" }, next_steps: { value: NAECHSTER_SCHRITT } } },
  metadata: { call_duration_secs: GESPRAECH_S, cost_fiat: EL_KOSTEN_USD, phone_call: { direction: "inbound", call_id: "sip_3303" } },
});

test("3303-K3: Nachlauf-Politik ausgehend = Inbound-EL (Carrier-Ende, kein Anker) plus Zusammenfassung und Aufgaben, klingelnd wie gebunden", () => {
  const inboundEl = nachlaufPolitikFuer({ costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI });
  const soll = { ...inboundEl, anbieterZusammenfassung: true, naechsteSchritteAlsAufgabe: true };
  for (const call of [{ costProfile: OUTBOUND_EL }, { costProfile: OUTBOUND_EL, answeredAt: isoVor(FRISCH_S), elevenlabsConversationId: CONV_ID }])
    assert.deepEqual({ ...nachlaufPolitikFuer(call) }, soll);
  assert.deepEqual(pflichtTraegerFuerProfil(OUTBOUND_EL).sort(), [KOSTENART.ELEVENLABS_CONVAI, KOSTENART.TELNYX_CALL_RECORDS].sort());
});

const ausgehend = (id, extra = {}) =>
  seedCall({ id, provider: "telnyx", twilioSid: `v3:${id}`, maxDurationS: MAX_DAUER_S, costProfile: OUTBOUND_EL, diagnostic: true, ...extra });
const abgehoben = (id, extra = {}) => {
  const answeredAt = isoVor(FRISCH_S);
  return ausgehend(id, { answeredAt, startedAt: answeredAt, ...extra });
};
const gebunden = (id, vorS = FRISCH_S) => abgehoben(id, { elevenlabsConversationId: CONV_ID, elBoundAt: isoVor(vorS) });

async function mitServer({ calls, pollMs = POLL_TAKT_MS }, run) {
  const el = await starteAnbieterAttrappe();
  const telnyx = await startTelnyxProvisioningMock();
  const telnyxEnv = { TELNYX_API_BASE: telnyx.url, TELNYX_API_KEY: "KEYtest-3303", TELNYX_ACCOUNT_SID: "acct_3303" };
  const srv = await startServer({
    env: { ELEVENLABS_API_BASE: el.url, ELEVENLABS_API_KEY: "test-key", ELEVENLABS_RESULT_POLL_MS: String(pollMs), DIAGNOSTIC_RETENTION_DAYS: "7", ...telnyxEnv },
    seed: seedState({ settings: { allowSummaries: false }, calls }),
  });
  try {
    await run({ srv, el, telnyx });
  } finally {
    await srv.stop();
    await telnyx.close();
    await el.close();
  }
}

const anrufIn = (stand, id) => stand.calls.find((eintrag) => eintrag.id === id);
const meldungenFuer = (stand, id) => stand.notifications.filter((meldung) => meldung.callId === id);
const traegerFuer = (stand, id) => (stand.callCostEvidence ?? []).filter((zeile) => zeile.callId === id).map((zeile) => zeile.traeger);
const abgerechnet = (srv, id) => waitForStoreState(srv, (stand) => Boolean(anrufIn(stand, id)?.billedAt), FRIST_MS);
const abgeschlossen = (srv, ids) => waitForStoreState(srv, (stand) => ids.every((id) => anrufIn(stand, id)?.billedAt && meldungenFuer(stand, id).length > 0), FRIST_MS);

const post = (srv, pfad, felder = {}) =>
  abrufMitFrist(`${srv.localUrl}${pfad}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(felder).toString() });
const postStatus = (srv, id, status) => post(srv, `/voice/status?callId=${id}`, { CallStatus: status });
const postRueckfall = async (srv, id, quelle) => (await post(srv, `/voice/el-rueckfall?${new URLSearchParams({ callId: id, quelle })}`)).text();

function pruefeErgebnisWieHeute(stand, id) {
  const call = anrufIn(stand, id);
  assert.equal(call.summary, ZUSAMMENFASSUNG);
  assert.equal(call.objectiveAchieved, "unclear");
  assert.deepEqual(call.transcript.map((zeile) => zeile.text), ZEILEN);
  assert.deepEqual(stand.actionItems.filter((aufgabe) => aufgabe.callId === id).map((aufgabe) => aufgabe.text), [NAECHSTER_SCHRITT]);
  assert.equal(call.sipCallId ?? null, null, "kein telnyx_sip-Join-Schluessel");
  assert.deepEqual(traegerFuer(stand, id), [KOSTENART.ELEVENLABS_CONVAI], "EL-Beleg, kein telnyx_sip");
  assert.equal(meldungenFuer(stand, id).length, EINMAL, "Abschluss genau einmal");
}

test("3303-K3: /voice/status completed eines gebundenen Auftrags -> Ergebnis wie heute, completed, Abschluss genau einmal", async () => {
  const id = "call_3303_k3";
  await mitServer({ calls: [gebunden(id)] }, async ({ srv, el }) => {
    await waitUntil(() => el.gets().length >= EINMAL, WARTE);
    await postStatus(srv, id, "completed");
    await waitUntil(() => srv.stdout.includes("[el-inbound] nachlauf gestartet"), WARTE);
    el.setzeAntwort(GESPRAECH_FERTIG);
    const stand = await abgeschlossen(srv, [id]);
    assert.equal(anrufIn(stand, id).status, "completed");
    pruefeErgebnisWieHeute(stand, id);

    await postStatus(srv, id, "completed");
    await waitUntil(() => srv.stdout.split("[voice/status]").length > ZWEIMAL, WARTE);
    assert.equal(anrufIn(srv.readStore(), id).billedAt, anrufIn(stand, id).billedAt);
    assert.equal(meldungenFuer(srv.readStore(), id).length, EINMAL);
  });
});

test("3303-K10: cancel_call auf einen gebundenen Auftrag -> Telnyx-Leitung 1x beendet, Ergebnis gesichert, cancelled, Abschluss 1x", async () => {
  const id = "call_3303_k10";
  await mitServer({ calls: [gebunden(id)], pollMs: LANGER_TAKT_MS }, async ({ srv, el, telnyx }) => {
    await waitUntil(() => el.gets().length >= EINMAL, WARTE);
    el.setzeAntwort(GESPRAECH_FERTIG);
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls/${id}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.deepEqual(await res.json(), { status: "cancelled" });
    const stand = await abgeschlossen(srv, [id]);
    assert.equal(anrufIn(stand, id).status, "cancelled");
    assert.equal(telnyx.requests.filter((anfrage) => anfrage.method === "POST" && anfrage.path.endsWith(`/Calls/v3:${id}`)).length, EINMAL);
    assert.equal(el.deletes().length, 0);
    pruefeErgebnisWieHeute(stand, id);
  });
});

test("3303-K6: nicht angenommen, besetzt, vor dem Abheben abgebrochen -> failed mit Meldung wie heute, keine [el-uebergabe]-Zeile", async () => {
  const faelle = ["no-answer", "busy", "canceled"].map((status) => ({ status, id: `call_3303_k6_${status}` }));
  await mitServer({ calls: faelle.map(({ id }) => ausgehend(id)) }, async ({ srv }) => {
    for (const { id, status } of faelle) await postStatus(srv, id, status);
    const stand = await abgeschlossen(srv, faelle.map(({ id }) => id));
    for (const { id, status } of faelle) assert.equal(anrufIn(stand, id).status, "failed", status);
    assert.ok(!srv.stdout.includes("[el-uebergabe]"), srv.stdout);
  });
});

test("3303-K2e: Rueckfall eines ausgehenden Auftrags -> nur <Hangup/>, kein Fehlersatz, Anruf endet failed", async () => {
  const faelle = [
    { call: abgehoben("call_3303_k2e_frist"), quelle: "frist" },
    { call: gebunden("call_3303_k2e_jung", JUNG_GEBUNDEN_S), quelle: "dial_ende" },
  ];
  const alt = gebunden("call_3303_k2e_alt", ALT_GEBUNDEN_S);
  await mitServer({ calls: [...faelle.map(({ call }) => call), alt], pollMs: LANGER_TAKT_MS }, async ({ srv }) => {
    for (const { call, quelle } of faelle) {
      const antwort = await postRueckfall(srv, call.id, quelle);
      assert.match(antwort, /<Hangup\s*\/>/, antwort);
      assert.doesNotMatch(antwort, /<Say|<Play|<Gather/, antwort);
      assert.equal(anrufIn(srv.readStore(), call.id).status, "failed", quelle);
      assert.equal(anrufIn(srv.readStore(), call.id).failureReason, GRUND_GESCHEITERT, quelle);
      await postStatus(srv, call.id, "completed");
      assert.equal(anrufIn(await abgerechnet(srv, call.id), call.id).status, "failed", quelle);
    }
    assert.match(await postRueckfall(srv, alt.id, "dial_ende"), /<Hangup\s*\/>/);
    assert.equal(anrufIn(srv.readStore(), alt.id).status, "active", "ein normal beendetes Gespraech bleibt fuer den Nachlauf offen");
  });
});

const nie = (name) => () => { throw new Error(`${name} darf auf diesem Weg nicht laufen`); };
const alsJson = (direktiven) => JSON.stringify(direktiven);

function miniStore(call) {
  const setzeEinmal = (feld) => (_id, wert) => Object.assign(call, { [feld]: call[feld] ?? wert });
  const endCallRecord = (_id, status) => Object.assign(call, { status });
  return { getCall: (id) => (id === call.id ? call : null), markInboundElFallback: setzeEinmal("elFallbackAt"), recordFailureReason: setzeEinmal("failureReason"), endCallRecord, tenantContext: nie("tenantContext") };
}

function einmalWerfend(echt) {
  let geworfen = false;
  return (...args) => {
    if (geworfen) return echt(...args);
    geworfen = true;
    throw new Error("kaputt");
  };
}

async function rueckfallUeberRouter({ store, render = alsJson }, callId) {
  const app = express();
  app.use(
    makeVoiceRoutes({
      store,
      config: withConfigNamespaces({ skipTwilioSignatureCheck: true, publicUrl: "https://agent.test" }),
      voiceRender: { render },
      directiveSynth: { synthesizeDirectiveAudio: nie("synthesizeDirectiveAudio") },
      lifecycle: { reattachActiveCall: async () => ({ call: null, logUnknown: false }) },
      inboundBridges: { clearDeadlines: () => {} },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const res = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/voice/el-rueckfall?callId=${callId}&quelle=frist`, { method: "POST" });
    assert.equal(res.status, HTTP_OK);
    return await res.text();
  } finally {
    server.close();
  }
}

const WURF_FAELLE = [
  { fall: "erstes render wirft", baue: (store) => ({ store, render: einmalWerfend(alsJson) }) },
  { fall: "Ende-Schreiben wirft einmal", baue: (store) => ({ store: { ...store, endCallRecord: einmalWerfend(store.endCallRecord) } }) },
  { fall: "Vermerk wirft immer", baue: (store) => ({ store: { ...store, markInboundElFallback: nie("markInboundElFallback") } }) },
];

for (const { fall, baue } of WURF_FAELLE) {
  test(`3303-K2e: Antwortbildung wirft (${fall}) -> trotzdem nur <Hangup/>, kein Fehlersatz, failed`, async () => {
    const call = { id: "call_3303_wurf", status: "active", provider: "telnyx", costProfile: OUTBOUND_EL, answeredAt: isoVor(FRISCH_S) };
    const antwort = await rueckfallUeberRouter(baue(miniStore(call)), call.id);
    assert.equal(antwort, alsJson([hangup()]));
    assert.equal(call.status, "failed");
  });
}
