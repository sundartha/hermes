import { test, after } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, tempDataDir, waitUntil } from "../helpers.js";
import { serverImportieren } from "../abrechnung/server-mit-testdatenbank.js";

const MANDANT = "t_frist_boot_json";
const CARRIER_ID = "CA_frist_boot_json";
const TELNYX_BASIS = "https://telnyx.frist-boot-json.invalid";
const FRIST_BIS_BEENDET_MS = 10_000;
const MAX_DAUER_S = 60;
const MINUTE_MS = 60_000;
const CAP_FAILURE_REASON = "max-duration-cap";

Object.assign(process.env, BASE_ENV, {
  DATA_DIR: tempDataDir(),
  STORE_BACKEND: "json",
  SESSION_SECRET: "frist-boot-json-signierwert",
  TELNYX_API_KEY: "KEYtest-frist-boot-json",
  TELNYX_API_BASE: TELNYX_BASIS,
  TELNYX_ACCOUNT_SID: "AC_frist_boot_json",
  FRISTEN_TAKT_MS: "40",
});

const auflegen = [];
globalThis.fetch = async (url, optionen = {}) => {
  const ziel = new URL(String(url));
  const methode = (optionen.method ?? "GET").toUpperCase();
  if (ziel.origin === TELNYX_BASIS && methode === "POST" && ziel.pathname.includes(`/Calls/${CARRIER_ID}`)) {
    auflegen.push(ziel.pathname.split("/").at(-1));
    return new Response("{}", { status: 200 });
  }
  throw new Error(`Testaufbau: Zugriff nach außen gesperrt (${methode} ${ziel.origin}${ziel.pathname})`);
};

const store = await import("../../src/store.js");
await store.oeffneSpeicher();
store.load().tenants.push({ id: MANDANT, status: "active", kycLevel: "card", ownerName: "Frist Boot Json" });
store.load().numbers.push({
  id: "num_frist_boot_json",
  tenantId: MANDANT,
  e164: "+4915799990044",
  provider: "telnyx",
  status: "active",
  providerNumberId: "pnum_frist_boot_json",
  country: "DE",
  language: "de",
  paymentIntentId: null,
});
store.save();
const server = await serverImportieren();
after(() => {
  server.closeAllConnections();
  server.close();
});

test("Kriterium 9: im JSON-Speicher beendet der Boot-Takt einen aktiven Anruf ohne Timer mit abgelaufener Frist mit Kappungsgrund, abgerechnet und einmal aufgelegt", async () => {
  const jetzt = Date.now();
  const call = store.createCall({
    direction: "inbound",
    from: "+4915799990042",
    to: "+4915799990043",
    tenantId: MANDANT,
    provider: "telnyx",
    twilioSid: CARRIER_ID,
    maxDurationS: MAX_DAUER_S,
  });
  call.status = "active";
  call.answeredAt = new Date(jetzt - 2 * MINUTE_MS).toISOString();
  call.fristHoechstdauerAt = new Date(jetzt - MINUTE_MS).toISOString();
  store.save();
  await waitUntil(() => store.getCall(call.id)?.status === "completed", { timeoutMs: FRIST_BIS_BEENDET_MS });
  await store.drainFlushes();
  const ende = store.getCall(call.id);
  assert.equal(ende.status, "completed");
  assert.equal(ende.failureReason, CAP_FAILURE_REASON);
  assert.notEqual(ende.billedAt, null);
  assert.deepEqual(auflegen, [CARRIER_ID]);
});
