import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  startServer,
  seedState,
  mcpPost,
  toolCall,
  readToolResult,
  makeTelnyxSigner,
  nowSeconds,
  waitForStoreState,
} from "../helpers.js";
import { starteAufzeichnendeAttrappe } from "../helpers/aufzeichnende-attrappe.js";
import { makePgTestStore, BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_SERVICE_UNAVAILABLE = 503;
const NUR_LESEN = 0o555;
const LESEN_SCHREIBEN = 0o755;
const DEPLOY_TOKEN = "v6-anrufpause-deploy-token-mindestens-32";
const FALSCHES_TOKEN = "v6-anrufpause-falsches-token-mindestens-32";
const BESTAETIGUNGS_SECRET = "v6-anrufpause-bestaetigung-mindestens-32-zeichen";
const TELNYX_NR = "+13125550100";
const ZIEL = "+4917312345678";
const START_PFAD = "/v2/texml/calls/";
const PAUSE_PFAD = "/intern/anrufpause";
const LAUFEND_PFAD = "/intern/anrufe-laufend";
const ZWEI_MINUTEN_MS = 120_000;
const PAUSENTEXT =
  "Outbound calls are temporarily paused by the Hermes operator. No call was placed. Please try again later.";
const AUFTRAG = { to: ZIEL, objective: "Termin vereinbaren" };
const REST_PAUSENFEHLER = { error: "Ausgehende Anrufe sind pausiert (Anrufpause).", reason: "frozen" };

const telnyxEnv = (attrappenUrl) => ({
  HERMES_DEPLOY_TOKEN: DEPLOY_TOKEN,
  CALL_CONFIRMATION_SECRET: BESTAETIGUNGS_SECRET,
  TELNYX_API_KEY: "KEYtest-secret",
  TELNYX_CONNECTION_ID: "conn_test",
  TELNYX_ACCOUNT_SID: "acct_test",
  TELNYX_API_BASE: attrappenUrl,
});

const TELNYX_OWNER = { e164: TELNYX_NR, provider: "telnyx" };

async function starteTelnyxAttrappe() {
  const attrappe = await starteAufzeichnendeAttrappe(() => ({
    status: HTTP_OK,
    koerper: { sid: "tnx_v6_call_1" },
  }));
  return { ...attrappe, starts: () => attrappe.anfragen.filter((anfrage) => anfrage.pfad.startsWith(START_PFAD)).length };
}

function pauseAnfrage(srv, { methode = "GET", token = DEPLOY_TOKEN, koerper } = {}) {
  return fetch(`${srv.localUrl}${PAUSE_PFAD}`, {
    method: methode,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(koerper === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(koerper === undefined ? {} : { body: koerper }),
  });
}

async function pauseLesen(srv) {
  const res = await pauseAnfrage(srv);
  assert.equal(res.status, HTTP_OK);
  assert.equal(res.headers.get("cache-control"), "no-store");
  return (await res.json()).an;
}

async function pauseSetzen(srv, an) {
  const res = await pauseAnfrage(srv, { methode: "POST", koerper: JSON.stringify({ an }) });
  assert.equal(res.status, HTTP_OK);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), { an });
  assert.equal(srv.readStore().anrufpause, an, "die Antwort kommt erst nach dem Schreiben");
}

async function bestaetigungsCode(srv) {
  const bestaetigung = await fetch(`${srv.localUrl}/api/call-confirmations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(AUFTRAG),
  });
  const code = (await bestaetigung.json()).confirmation?.code;
  assert.ok(code, "Bestaetigungscode erhalten");
  return code;
}

async function placeCallUeberMcp(srv) {
  const code = await bestaetigungsCode(srv);
  const res = await mcpPost(
    `${srv.localUrl}/mcp`,
    null,
    toolCall("place_call", { ...AUFTRAG, confirmation_code: code }),
  );
  return readToolResult(res);
}

function assertPausiert(result) {
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, PAUSENTEXT);
}

async function mitTelnyx(lauf) {
  const attrappe = await starteTelnyxAttrappe();
  const servers = [];
  const starte = async (optionen = {}) => {
    const srv = await startServer({ env: telnyxEnv(attrappe.url), ownerNumber: TELNYX_OWNER, ...optionen });
    servers.push(srv);
    return srv;
  };
  try {
    await lauf({ attrappe, starte });
  } finally {
    for (const srv of servers) await srv.stop();
    await attrappe.schliesse();
  }
}

test("V6 Anrufpause: an sperrt place_call vor dem Anbieter, aus laesst genau einen Start durch", async () => {
  await mitTelnyx(async ({ attrappe, starte }) => {
    const srv = await starte();
    assert.equal(await pauseLesen(srv), false, "Standard ist aus");
    await pauseSetzen(srv, true);
    assert.equal(await pauseLesen(srv), true);
    const vorher = srv.readStore().calls.length;
    assertPausiert(await placeCallUeberMcp(srv));
    assert.equal(attrappe.starts(), 0, "kein Anrufstart beim Anbieter");
    assert.equal(srv.readStore().calls.length, vorher, "kein Anruf-Datensatz");
    await pauseSetzen(srv, false);
    const erlaubt = await placeCallUeberMcp(srv);
    assert.notEqual(erlaubt.isError, true, JSON.stringify(erlaubt));
    assert.equal(attrappe.starts(), 1, "genau ein Anrufstart beim Anbieter");
    assert.equal(srv.readStore().calls.length, vorher + 1);
  });
});

test("V6 Anrufpause: ohne, mit falschem oder zu kurzem Token 401 und der Wert bleibt", async () => {
  await mitTelnyx(async ({ starte }) => {
    const srv = await starte();
    const koerper = JSON.stringify({ an: true });
    for (const token of [null, FALSCHES_TOKEN, DEPLOY_TOKEN.slice(1)]) {
      for (const methode of ["GET", "POST"]) {
        const res = await pauseAnfrage(srv, { methode, token, koerper: methode === "POST" ? koerper : undefined });
        assert.equal(res.status, HTTP_UNAUTHORIZED, `${methode} mit ${token}`);
        assert.equal(res.headers.get("cache-control"), "no-store");
        assert.deepEqual(await res.json(), { error: "unauthorized" });
      }
    }
    assert.equal(await pauseLesen(srv), false);
    assert.match(srv.stdout, /\[audit\] auth_failed .*path=\/intern\/anrufpause grund=deploy_token/);
    assert.doesNotMatch(srv.stdout, /anrufpause_gesetzt/);
  });
});

test("V6 Anrufpause: ungueltiger Koerper 400 und der Wert bleibt", async () => {
  await mitTelnyx(async ({ starte }) => {
    const srv = await starte();
    await pauseSetzen(srv, true);
    const ungueltig = [
      undefined,
      "",
      "null",
      "[]",
      "{}",
      JSON.stringify({ an: "false" }),
      JSON.stringify({ an: 0 }),
      JSON.stringify({ an: null }),
      JSON.stringify({ an: false, grund: "x" }),
      JSON.stringify({ aus: true }),
    ];
    for (const koerper of ungueltig) {
      const res = await pauseAnfrage(srv, { methode: "POST", koerper });
      assert.equal(res.status, HTTP_BAD_REQUEST, `Koerper ${koerper}`);
    }
    assert.equal(await pauseLesen(srv), true);
    assert.match(srv.stdout, /\[audit\] anrufpause_gesetzt ip=system an=true/);
  });
});

test("V6 Anrufpause: die Pause uebersteht einen Neustart mit demselben Datenordner", async () => {
  await mitTelnyx(async ({ attrappe, starte }) => {
    const erster = await starte();
    await pauseSetzen(erster, true);
    await erster.stop();
    const zweiter = await starte({ dataDir: erster.dataDir });
    assert.equal(await pauseLesen(zweiter), true);
    assertPausiert(await placeCallUeberMcp(zweiter));
    assert.equal(attrappe.starts(), 0);
    assert.equal(zweiter.readStore().calls.length, 0);
  });
});

function auflegenMelden(srv, signer, callId) {
  const zeitstempel = String(nowSeconds());
  const rumpf = new URLSearchParams({ CallSid: "tnx_v6_laufend", CallStatus: "completed" }).toString();
  return fetch(`${srv.localUrl}/voice/status?callId=${callId}`, {
    method: "POST",
    body: rumpf,
    headers: {
      "telnyx-timestamp": zeitstempel,
      "telnyx-signature-ed25519": signer.sign(zeitstempel, rumpf),
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
}

test("V6 Anrufpause: ein laufender Anruf bleibt unberuehrt und sein Auflegen wird verarbeitet", async () => {
  const laufender = {
    id: "call_v6_laufend",
    tenantId: BOOTSTRAP_TENANT_ID,
    direction: "outbound",
    provider: "telnyx",
    twilioSid: "tnx_v6_laufend",
    from: TELNYX_NR,
    to: ZIEL,
    status: "active",
    startedAt: new Date(Date.now() - ZWEI_MINUTEN_MS).toISOString(),
  };
  const signer = makeTelnyxSigner();
  await mitTelnyx(async ({ attrappe, starte }) => {
    const srv = await starte({
      seed: seedState({ calls: [laufender] }),
      env: {
        ...telnyxEnv(attrappe.url),
        SKIP_TWILIO_SIGNATURE_CHECK: "false",
        TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
      },
    });
    const laufend = () =>
      fetch(`${srv.localUrl}${LAUFEND_PFAD}`, { headers: { Authorization: `Bearer ${DEPLOY_TOKEN}` } }).then(
        (antwort) => antwort.json(),
      );
    assert.deepEqual(await laufend(), { laufend: 1 });
    const anfragenVorher = attrappe.anfragen.length;
    await pauseSetzen(srv, true);
    assert.deepEqual(await laufend(), { laufend: 1 });
    const call = srv.readStore().calls.find((anruf) => anruf.id === laufender.id);
    assert.equal(call.status, "active");
    assert.equal(attrappe.anfragen.length, anfragenVorher, "kein Anbieteraufruf beim Umschalten");
    const res = await auflegenMelden(srv, signer, laufender.id);
    assert.equal(res.status, HTTP_OK);
    const nachher = await waitForStoreState(srv, (zustand) =>
      zustand.calls.some((anruf) => anruf.id === laufender.id && anruf.status === "completed"),
    );
    assert.ok(nachher.calls.find((anruf) => anruf.id === laufender.id).endedAt, "Ende vermerkt");
    assert.deepEqual(await laufend(), { laufend: 0 });
    assert.equal(await pauseLesen(srv), true, "die Pause bleibt nach dem Auflegen an");
  });
});

test("V6 Anrufpause: REST nennt die Anrufpause statt OUTBOUND_FROZEN, Audit mit quelle", async () => {
  await mitTelnyx(async ({ attrappe, starte }) => {
    const srv = await starte();
    await pauseSetzen(srv, true);
    const res = await fetch(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...AUFTRAG, confirmation_code: await bestaetigungsCode(srv) }),
    });
    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.deepEqual(await res.json(), REST_PAUSENFEHLER);
    assert.equal(attrappe.starts(), 0);
    assert.match(srv.stdout, /\[audit\] place_call_denied ip=\S+ to=\S+ grund=frozen quelle=anrufpause/);
    assert.doesNotMatch(srv.stdout, /OUTBOUND_FROZEN\)/);
    assert.equal(srv.stdout.includes(ZIEL.slice(1)), false, "keine volle Nummer im Log");
  });
});

test("V6 Anrufpause: scheitert das Schreiben, 503 und der alte Wert gilt weiter", async () => {
  await mitTelnyx(async ({ attrappe, starte }) => {
    const srv = await starte();
    await pauseSetzen(srv, true);
    fs.chmodSync(srv.dataDir, NUR_LESEN);
    let res;
    try {
      res = await pauseAnfrage(srv, { methode: "POST", koerper: JSON.stringify({ an: false }) });
    } finally {
      fs.chmodSync(srv.dataDir, LESEN_SCHREIBEN);
    }
    assert.equal(res.status, HTTP_SERVICE_UNAVAILABLE);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { error: "persist_failed" });
    assert.match(srv.stdout, /\[audit\] anrufpause_fehlgeschlagen ip=system an=false\n/);
    assert.doesNotMatch(srv.stdout, /anrufpause_gesetzt ip=system an=false/);
    assert.equal(await pauseLesen(srv), true, "der Wert im Speicher ist zurueckgesetzt");
    assert.equal(srv.readStore().anrufpause, true);
    assertPausiert(await placeCallUeberMcp(srv));
    assert.equal(attrappe.starts(), 0, "place_call folgt dem alten Wert");
  });
});

test("V6 Anrufpause: pg-Store schreibt die Pause beim Flush und laedt sie neu", async () => {
  const { store } = await makePgTestStore();
  assert.equal(store.load().anrufpause, false);
  store.load().anrufpause = true;
  await store.save();
  store.load().anrufpause = false;
  await store.init();
  assert.equal(store.load().anrufpause, true);
  store.load().anrufpause = false;
  await store.save();
  store.load().anrufpause = true;
  await store.init();
  assert.equal(store.load().anrufpause, false);
});

async function anrufpauseInDb(db) {
  const { rows } = await db.query("SELECT an FROM platform_anrufpause WHERE id = 1");
  return rows[0]?.an;
}

test("V6 Anrufpause: pg-Store - setzeAnrufpause kehrt erst nach dem Schreiben in die DB zurueck", async () => {
  const { store, db } = await makePgTestStore();
  for (const an of [true, false, true]) {
    assert.equal(await store.setzeAnrufpause(an), an);
    assert.equal(await anrufpauseInDb(db), an, `an=${an} steht ohne weiteres Warten in der DB`);
  }
});

test("V6 Anrufpause: pg-Store - scheitert das Schreiben, wirft setzeAnrufpause und der alte Wert bleibt", async () => {
  const { store, db } = await makePgTestStore();
  await db.exec("ALTER TABLE platform_anrufpause RENAME TO platform_anrufpause_weg");
  await assert.rejects(store.setzeAnrufpause(true), /platform_anrufpause/);
  assert.equal(store.load().anrufpause, false, "der Wert im Speicher ist zurueckgesetzt");
  await db.exec("ALTER TABLE platform_anrufpause_weg RENAME TO platform_anrufpause");
  await store.init();
  assert.equal(store.load().anrufpause, false, "der gescheiterte Flush hat nichts geschrieben");
});
