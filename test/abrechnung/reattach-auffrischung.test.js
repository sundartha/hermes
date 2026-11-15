import { after, test } from "node:test";
import assert from "node:assert/strict";

import { BASE_ENV, OWNER_TEST_NUMBER, tempDataDir, waitUntil } from "../helpers.js";
import { neuePglite } from "../pglite-helfer.js";
import { poolAufPglite, serverImportieren } from "./server-mit-testdatenbank.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const WARTE_MS = 5000;
const KURZE_HOECHSTDAUER_S = 8;

Object.assign(process.env, BASE_ENV, {
  DATA_DIR: tempDataDir(),
  STORE_BACKEND: "pg",
  DATABASE_URL: "postgres://reattach-auffrischung.invalid/hermes",
  SESSION_SECRET: "x",
});

const pglite = await neuePglite();
const db = { query: (text, params) => pglite.query(text, params), exec: (sql) => pglite.exec(sql) };
poolAufPglite(db);
const { BOOTSTRAP_TENANT_ID, makePgStore } = await import("../pg-helpers.js");
const store = await import("../../src/store.js");
await store.oeffneSpeicher();
store.load().numbers.push({ id: "num_reattach", ...OWNER_TEST_NUMBER, tenantId: BOOTSTRAP_TENANT_ID, status: "active", providerNumberId: null });
store.save();
await store.drainFlushes();

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
  assert.equal(store.getCall(anruf.id), null);
  return anruf.id;
}

test("Ein Anruf unter der Kostendecke endet nach der Wiederanbindung ueber /voice/status nicht als Guthaben erschoepft", async () => {
  const callId = await aktiverAnrufDerAnderenInstanz();
  const antwort = await abrufMitFrist(`${basis}/voice/status?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ CallStatus: "completed" }).toString(),
  });
  assert.equal(antwort.status, HTTP_OK);
  await waitUntil(() => store.getCall(callId)?.status === "completed", { timeoutMs: WARTE_MS });
  assert.notEqual(store.getCall(callId).failureReason, "budget-exhausted");
});
