import { test, after } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, tempDataDir, waitUntil } from "../helpers.js";
import { serverImportieren } from "../abrechnung/server-mit-testdatenbank.js";

const MANDANT = "t_lesefehler_nur_abgelaufene";
const CARRIER_ID = "CA_lesefehler_nur_abgelaufene";
const TELNYX_BASIS = "https://telnyx.lesefehler-nur-abgelaufene.invalid";
const FRIST_BIS_BEENDET_MS = 10_000;
const MAX_DAUER_S = 60;
const MINUTE_MS = 60_000;
const CAP_FAILURE_REASON = "max-duration-cap";

Object.assign(process.env, BASE_ENV, {
  DATA_DIR: tempDataDir(),
  STORE_BACKEND: "json",
  SESSION_SECRET: "lesefehler-nur-abgelaufene-signierwert",
  TELNYX_API_KEY: "KEYtest-lesefehler-nur-abgelaufene",
  TELNYX_API_BASE: TELNYX_BASIS,
  TELNYX_ACCOUNT_SID: "AC_lesefehler_nur_abgelaufene",
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
store.load().tenants.push({ id: MANDANT, status: "active", kycLevel: "card", ownerName: "Lesefehler Nur Abgelaufene" });
store.load().numbers.push({
  id: "num_lesefehler_nur_abgelaufene",
  tenantId: MANDANT,
  e164: "+4915799990064",
  provider: "telnyx",
  status: "active",
  providerNumberId: "pnum_lesefehler_nur_abgelaufene",
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

test("Kriterium 7: bei nicht lesbarer Frist endet nur der abgelaufene Anruf, ein noch laufender aktiver bleibt aktiv", async () => {
  const jetzt = Date.now();
  const neu = (sid, vorMs) => {
    const call = store.createCall({
      direction: "inbound",
      from: "+4915799990062",
      to: "+4915799990063",
      tenantId: MANDANT,
      provider: "telnyx",
      twilioSid: sid,
      maxDurationS: MAX_DAUER_S,
    });
    call.status = "active";
    call.answeredAt = new Date(jetzt - vorMs).toISOString();
    call.fristHoechstdauerAt = Symbol("nicht lesbar");
    return call;
  };
  const abgelaufen = neu(CARRIER_ID, 2 * MINUTE_MS);
  const laeuft = neu("CA_laeuft_noch", 1000);
  store.save();
  await waitUntil(() => store.getCall(abgelaufen.id)?.status === "completed", { timeoutMs: FRIST_BIS_BEENDET_MS });
  assert.equal(store.getCall(laeuft.id).status, "active");
  assert.deepEqual(auflegen, [CARRIER_ID]);
});
