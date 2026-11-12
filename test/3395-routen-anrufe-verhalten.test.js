import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { startServer, seedState, seedCall } from "./helpers.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const PEER = "+4915112345678";
const STATE_CALLS_LIMIT = 30;
const OVER_LIMIT = 33;

const BASE_ENV = {
  ALLOWED_COUNTRY_CODES: "+49",
  FAKE_ORIGINATE: "true",
  ELEVENLABS_OUTBOUND_ENABLED: "false",
  PRECALL_BRIEFING_ENABLED: "false",
};

const json = (url, method, body) =>
  abrufMitFrist(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const post = (srv, path, body) => json(`${srv.localUrl}${path}`, "POST", body);

test("3395-R1: POST /api/calls lehnt unvollstaendige und falsch formatierte Anfragen mit genauem Text ab", async () => {
  const srv = await startServer({ env: BASE_ENV, seed: seedState() });
  try {
    const pflicht = { error: "to und objective sind Pflicht" };
    for (const body of [{ objective: "x" }, { to: PEER }, {}, { to: "", objective: "x" }]) {
      const res = await post(srv, "/api/calls", body);
      assert.equal(res.status, HTTP_BAD_REQUEST, JSON.stringify(body));
      assert.deepEqual(await res.json(), pflicht, JSON.stringify(body));
    }
    const nullNachVorwahl = await post(srv, "/api/calls", { to: "+4901511234567", objective: "x" });
    assert.equal(nullNachVorwahl.status, HTTP_BAD_REQUEST);
    assert.deepEqual(await nullNachVorwahl.json(), {
      error: "'to' must be E.164, e.g. +4917212345678",
    });
  } finally {
    await srv.stop();
  }
});

test("3395-R2: Sprachwahl - unbekannte Sprache nennt die erlaubten, bekannte ohne ElevenLabs-Weg ist nicht verfuegbar", async () => {
  const srv = await startServer({ env: BASE_ENV, seed: seedState() });
  try {
    const unbekannt = await post(srv, "/api/calls", { to: PEER, objective: "x", language: "xx" });
    assert.equal(unbekannt.status, HTTP_BAD_REQUEST);
    const body = await unbekannt.json();
    assert.equal(body.code, "unsupported_language");
    assert.ok(body.supported.includes("de"));
    assert.equal(body.error, `unsupported_language: language must be one of ${body.supported.join(", ")}`);

    const nichtVerfuegbar = await post(srv, "/api/calls", { to: PEER, objective: "x", language: "de" });
    assert.equal(nichtVerfuegbar.status, HTTP_BAD_REQUEST);
    assert.deepEqual(await nichtVerfuegbar.json(), {
      error:
        "language_unavailable: this deployment cannot separate the spoken language from the " +
        "mandatory AI disclosure - omit language",
      code: "language_unavailable",
    });
  } finally {
    await srv.stop();
  }
});

test("3395-R3: Anruf anlegen - goal gilt als objective, Antwort ist vollstaendig, zweiter Aufruf liefert denselben Anruf", async () => {
  const srv = await startServer({ env: BASE_ENV, seed: seedState() });
  try {
    const erst = await post(srv, "/api/calls", { to: PEER, goal: "Tisch reservieren" });
    assert.equal(erst.status, HTTP_OK);
    const erstBody = await erst.json();
    assert.equal(erstBody.ok, true);
    assert.equal(erstBody.status, "dialing");
    assert.equal(erstBody.deduplicated, false);
    assert.deepEqual(erstBody.context_received, {
      active: false,
      summary: false,
      key_facts_count: 0,
      recipient_relationship: false,
      desired_outcome: false,
    });
    const gespeichert = srv.readStore().calls.find((c) => c.id === erstBody.callId);
    assert.equal(gespeichert.goal, "Tisch reservieren");
    assert.equal(gespeichert.to, PEER);
    assert.equal(gespeichert.direction, "outbound");

    const zweit = await post(srv, "/api/calls", { to: PEER, objective: "anderes Ziel" });
    assert.equal(zweit.status, HTTP_OK);
    const zweitBody = await zweit.json();
    assert.equal(zweitBody.deduplicated, true);
    assert.equal(zweitBody.callId, erstBody.callId);
    const zumZiel = srv.readStore().calls.filter((c) => c.to === PEER);
    assert.equal(zumZiel.length, 1);
  } finally {
    await srv.stop();
  }
});

test("3395-R4: Abbrechen - unbekannter Anruf 404, aktiver wird beendet, schon beendeter meldet nur den Status", async () => {
  const seed = seedState({
    calls: [
      seedCall({ id: "call_aktiv", status: "active" }),
      seedCall({ id: "call_fertig", status: "completed", to: "+4915199999999" }),
    ],
  });
  const srv = await startServer({ env: BASE_ENV, seed });
  try {
    const unbekannt = await post(srv, "/api/calls/call_gibtsnicht/cancel");
    assert.equal(unbekannt.status, HTTP_NOT_FOUND);
    assert.deepEqual(await unbekannt.json(), { error: "not found" });

    const fertig = await post(srv, "/api/calls/call_fertig/cancel");
    assert.deepEqual(await fertig.json(), { status: "completed" });

    const aktiv = await post(srv, "/api/calls/call_aktiv/cancel");
    assert.equal(aktiv.status, HTTP_OK);
    assert.deepEqual(await aktiv.json(), { status: "cancelled" });
    const beendet = srv.readStore().calls.find((c) => c.id === "call_aktiv");
    assert.equal(beendet.status, "cancelled");
  } finally {
    await srv.stop();
  }
});

test("3395-R5: Konsultation - ohne Freigabe 403, unbekannter Anruf 404, mit Freigabe pruefen Event-ID und Status", async () => {
  const seed = seedState({ calls: [seedCall({ id: "call_k" })] });
  const aus = await startServer({ env: BASE_ENV, seed });
  try {
    const verboten = await post(aus, "/api/calls/call_k/consult/answer", { event_id: "c0", answers: ["a"] });
    assert.equal(verboten.status, HTTP_FORBIDDEN);
    assert.deepEqual(await verboten.json(), {
      error: "Consult-Kanal ist fuer diesen Tenant nicht freigegeben.",
    });
    const gelesen = await abrufMitFrist(`${aus.localUrl}/api/calls/call_k/consult`);
    assert.equal(gelesen.status, HTTP_NOT_FOUND);
    const unbekannt = await post(aus, "/api/calls/call_x/consult/answer", { event_id: "c0" });
    assert.equal(unbekannt.status, HTTP_NOT_FOUND);
  } finally {
    await aus.stop();
  }

  const an = await startServer({
    env: { ...BASE_ENV, CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" },
    seed: seedState({
      calls: [seedCall({ id: "call_k" })],
      profiles: { [BOOTSTRAP_TENANT_ID]: { allowConsult: true } },
    }),
  });
  try {
    const faelle = [
      [{ event_id: 7, answers: ["a"] }, "event_id ist ungueltig"],
      [{ event_id: "c0", answers: ["a"], status: "fertig" }, "status ist ungueltig"],
      [{ event_id: "c0", answers: [] }, "answers ist Pflicht"],
      [{ event_id: "c0" }, "answers ist Pflicht"],
    ];
    for (const [body, fehler] of faelle) {
      const res = await post(an, "/api/calls/call_k/consult/answer", body);
      assert.equal(res.status, HTTP_BAD_REQUEST, JSON.stringify(body));
      assert.equal((await res.json()).error, fehler, JSON.stringify(body));
    }
  } finally {
    await an.stop();
  }
});

test("3395-R6: Lesewege - Zustand kappt Anrufe, fremder oder unbekannter Anruf ist 404, Export liefert Anrufe", async () => {
  const calls = Array.from({ length: OVER_LIMIT }, (_, i) =>
    seedCall({ id: `call_l${i}`, status: "completed", to: `+49151100000${String(i).padStart(2, "0")}` }),
  );
  const srv = await startServer({ env: BASE_ENV, seed: seedState({ calls }) });
  try {
    const state = await (await abrufMitFrist(`${srv.localUrl}/api/state`)).json();
    assert.equal(state.calls.length, STATE_CALLS_LIMIT);
    assert.equal(state.agent.model, "claude-haiku-4-5");

    const eins = await abrufMitFrist(`${srv.localUrl}/api/calls/call_l1`);
    assert.equal(eins.status, HTTP_OK);
    assert.equal((await eins.json()).id, "call_l1");
    const nein = await abrufMitFrist(`${srv.localUrl}/api/calls/call_nein`);
    assert.equal(nein.status, HTTP_NOT_FOUND);
    assert.deepEqual(await nein.json(), { error: "not found" });

    const export_ = await (await abrufMitFrist(`${srv.localUrl}/api/tenant-data/export`)).json();
    assert.equal(export_.calls.length, OVER_LIMIT);
  } finally {
    await srv.stop();
  }
});
