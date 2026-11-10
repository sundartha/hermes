import { after, test } from "node:test";
import assert from "node:assert/strict";

import { BASE_ENV, OWNER_TEST_NUMBER, tempDataDir, waitUntil } from "./helpers.js";
import { neuePglite } from "./pglite-helfer.js";
import { poolAufPglite, serverImportieren } from "./abrechnung/server-mit-testdatenbank.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";

const WARTEGRENZE_FEHLER = "timeout exceeded when trying to connect";
const UNBEKANNTE_CALL_ID = "call_gibt_es_nicht_2662";
const IMMER = Number.POSITIVE_INFINITY;
const KEINMAL = 0;
const EINMAL = 1;
const DREIMAL = 3;
const HTTP_OK = 200;
const WARTE_MS = 5000;
const RUHE_DURCHLAEUFE = 5;
const KURZE_HOECHSTDAUER_S = 8;
const VERWORFEN_LOG = "[voice/status] Statusereignis verworfen";
const FEHLGESCHLAGEN_LOG = "[voice/status] Wiederanbindung fehlgeschlagen";
const ANBINDEN_FEHLER_LOG = "[pg] attachActiveCall fehlgeschlagen";
const TURN_UNBEKANNT_LOG = "[voice/turn] kein aktiver Call";

Object.assign(process.env, BASE_ENV, {
  DATA_DIR: tempDataDir(),
  STORE_BACKEND: "pg",
  DATABASE_URL: "postgres://wiederanbindung-2662.invalid/hermes",
  SESSION_SECRET: "x",
});

const protokoll = [];
for (const stufe of ["warn", "error"]) {
  const original = console[stufe].bind(console);
  console[stufe] = (...teile) => {
    protokoll.push(teile.map(String).join(" "));
    original(...teile);
  };
}

const abfragenNachId = new Map();
const pglite = await neuePglite();
const db = {
  query: (text, params) => {
    const id = params?.[0];
    abfragenNachId.set(id, (abfragenNachId.get(id) ?? 0) + 1);
    return pglite.query(text, params);
  },
  exec: (sql) => pglite.exec(sql),
};
const pools = poolAufPglite(db);
const { BOOTSTRAP_TENANT_ID, makePgStore } = await import("./pg-helpers.js");
const store = await import("../src/store.js");
await store.oeffneSpeicher();
store.load().numbers.push({ id: "num_2662", ...OWNER_TEST_NUMBER, tenantId: BOOTSTRAP_TENANT_ID, status: "active", providerNumberId: null });
store.save();
await store.drainFlushes();
const [hauptPool] = pools;
const echteVerbindung = hauptPool.connect.bind(hauptPool);
const datenbank = { abweisungen: 0 };
hauptPool.connect = () => {
  if (datenbank.abweisungen <= 0) return echteVerbindung();
  datenbank.abweisungen -= 1;
  return Promise.reject(new Error(WARTEGRENZE_FEHLER));
};

const server = await serverImportieren();
after(() => {
  server.closeAllConnections();
  server.close();
});
const basis = `http://127.0.0.1:${server.address().port}`;

const andereInstanz = makePgStore({ withClient: (arbeit) => arbeit(db) });
await andereInstanz.init();

async function aktiverAnrufDerAnderenInstanz() {
  const anruf = andereInstanz.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID, maxDurationS: KURZE_HOECHSTDAUER_S });
  andereInstanz.markAnswered(anruf.id);
  await andereInstanz.save();
  await andereInstanz.drainFlushes();
  assert.equal(store.getCall(anruf.id), null, "der Anruf steht nur in der Datenbank, nicht im Spiegel dieser Instanz");
  return anruf.id;
}

function poolWeistAb(anzahl) {
  datenbank.abweisungen = anzahl;
}

function post(pfad, felder) {
  return abrufMitFrist(`${basis}${pfad}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(felder).toString(),
  });
}

const postStatus = (callId, status) => post(`/voice/status?callId=${callId}`, { CallStatus: status });

function neueZeilen() {
  const beginn = protokoll.length;
  return (muster) => protokoll.slice(beginn).filter((zeile) => zeile.includes(muster));
}

const ruhe = async () => {
  for (let i = 0; i < RUHE_DURCHLAEUFE; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

test("2662 Kriterium 1: Pool weist einmal ab, dann gelingt es -> 200 und Anruf ist beendet", async () => {
  const callId = await aktiverAnrufDerAnderenInstanz();
  poolWeistAb(EINMAL);
  const antwort = await postStatus(callId, "completed");
  assert.equal(antwort.status, HTTP_OK);
  await waitUntil(() => store.getCall(callId)?.status === "completed", { timeoutMs: WARTE_MS });
  assert.ok(store.getCall(callId).endedAt, "endedAt gesetzt");
});

test("2662 Kriterium 2: genau eine Fehlschlag-Zeile mit versuch=1, kein Verwerfen", async () => {
  const callId = await aktiverAnrufDerAnderenInstanz();
  const zeilen = neueZeilen();
  poolWeistAb(EINMAL);
  await postStatus(callId, "completed");
  await waitUntil(() => store.getCall(callId)?.status === "completed", { timeoutMs: WARTE_MS });
  const fehlschlaege = zeilen(FEHLGESCHLAGEN_LOG);
  assert.equal(fehlschlaege.length, EINMAL);
  assert.match(fehlschlaege[0], new RegExp(`callId=${callId}, versuch=1/3`));
  assert.equal(zeilen(VERWORFEN_LOG).length, KEINMAL);
});

test("2662 Kriterium 3: Pool weist immer ab -> 200, genau 3 Versuche, genau eine Verwerfen-Zeile mit callId", async () => {
  const callId = await aktiverAnrufDerAnderenInstanz();
  const zeilen = neueZeilen();
  poolWeistAb(IMMER);
  try {
    const antwort = await postStatus(callId, "completed");
    assert.equal(antwort.status, HTTP_OK);
    await waitUntil(() => zeilen(VERWORFEN_LOG).length > 0, { timeoutMs: WARTE_MS });
  } finally {
    poolWeistAb(KEINMAL);
  }
  await ruhe();
  assert.equal(zeilen(ANBINDEN_FEHLER_LOG).length, DREIMAL);
  assert.equal(zeilen(FEHLGESCHLAGEN_LOG).length, DREIMAL);
  assert.deepEqual(zeilen(VERWORFEN_LOG), [`${VERWORFEN_LOG} (callId=${callId})`]);
  assert.equal(store.getCall(callId), null, "der Anruf wurde nicht angebunden");
});

test("2662 Kriterium 4: unbekannte callId bei gesundem Pool -> genau 1 Versuch, keine Wiederholung", async () => {
  const zeilen = neueZeilen();
  const mandanten = store.load().tenants.length;
  const antwort = await postStatus(UNBEKANNTE_CALL_ID, "completed");
  assert.equal(antwort.status, HTTP_OK);
  await waitUntil(() => abfragenNachId.get(UNBEKANNTE_CALL_ID) >= mandanten, { timeoutMs: WARTE_MS });
  await ruhe();
  assert.equal(abfragenNachId.get(UNBEKANNTE_CALL_ID), mandanten, "je Mandant genau eine Abfrage, also ein Versuch");
  assert.equal(zeilen(FEHLGESCHLAGEN_LOG).length, KEINMAL);
  assert.equal(zeilen(VERWORFEN_LOG).length, KEINMAL);
});

test("2662 Statusereignis ohne callId bei abweisendem Pool -> kein Versuch, keine Wiederholung, kein Verwerfen", async () => {
  const zeilen = neueZeilen();
  poolWeistAb(IMMER);
  try {
    const antwort = await post("/voice/status", { CallStatus: "completed" });
    assert.equal(antwort.status, HTTP_OK);
    await ruhe();
  } finally {
    poolWeistAb(KEINMAL);
  }
  assert.equal(zeilen(ANBINDEN_FEHLER_LOG).length, KEINMAL);
  assert.equal(zeilen(FEHLGESCHLAGEN_LOG).length, KEINMAL);
  assert.equal(zeilen(VERWORFEN_LOG).length, KEINMAL);
});

test("2662 /voice/turn bei abweisendem Pool -> Auflegen ohne Meldung 'kein aktiver Call' und ohne Wiederholung", async () => {
  const callId = await aktiverAnrufDerAnderenInstanz();
  const zeilen = neueZeilen();
  poolWeistAb(IMMER);
  try {
    const antwort = await post(`/voice/turn?callId=${callId}`, { SpeechResult: "Hallo" });
    assert.equal(antwort.status, HTTP_OK);
    assert.match(await antwort.text(), /Hangup/i);
  } finally {
    poolWeistAb(KEINMAL);
  }
  assert.equal(zeilen(ANBINDEN_FEHLER_LOG).length, EINMAL);
  assert.equal(zeilen(TURN_UNBEKANNT_LOG).length, KEINMAL);
  assert.equal(zeilen(FEHLGESCHLAGEN_LOG).length, KEINMAL);
});
