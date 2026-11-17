import { after } from "node:test";
import { BASE_ENV, tempDataDir } from "../helpers.js";
import { serverImportieren } from "../abrechnung/server-mit-testdatenbank.js";

const MANDANT = "t_geld_boot_json";
const TELNYX_BASIS = "https://telnyx.geld-boot-json.invalid";
const MAX_DAUER_S = 60;
const MINUTE_MS = 60_000;

export async function geldBootJsonStarten(umgebung) {
  Object.assign(process.env, BASE_ENV, {
    DATA_DIR: tempDataDir(),
    STORE_BACKEND: "json",
    SESSION_SECRET: "geld-boot-json-signierwert",
    TELNYX_API_KEY: "KEYtest-geld-boot-json",
    TELNYX_API_BASE: TELNYX_BASIS,
    TELNYX_ACCOUNT_SID: "AC_geld_boot_json",
    FRISTEN_TAKT_MS: "40",
    DEFAULT_TENANT_BUDGET_CENTS: "100",
    VOICE_TARIFF_INBOUND_CENTS: "20",
    ...umgebung,
  });
  const aufgelegt = [];
  globalThis.fetch = async (url, optionen = {}) => {
    const ziel = new URL(String(url));
    const methode = (optionen.method ?? "GET").toUpperCase();
    if (ziel.origin === TELNYX_BASIS && methode === "POST" && ziel.pathname.includes("/Calls/CA_geld_boot_json")) {
      aufgelegt.push(ziel.pathname.split("/").at(-1));
      return new Response("{}", { status: 200 });
    }
    throw new Error(`Testaufbau: kein Zugriff nach außen (${methode} ${ziel.origin}${ziel.pathname})`);
  };
  const store = await import("../../src/store.js");
  await store.oeffneSpeicher();
  store.load().tenants.push({ id: MANDANT, status: "active", kycLevel: "card", ownerName: "Geld Boot Json" });
  store.load().numbers.push({
    id: "num_geld_boot_json",
    tenantId: MANDANT,
    e164: "+4915799990054",
    provider: "telnyx",
    status: "active",
    providerNumberId: "pnum_geld_boot_json",
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
  const aktiverAnruf = (kennung, { hoechstdauerInMinuten }) => {
    const jetzt = Date.now();
    const call = store.createCall({
      direction: "inbound",
      from: "+4915799990052",
      to: "+4915799990053",
      tenantId: MANDANT,
      provider: "telnyx",
      twilioSid: `CA_geld_boot_json_${kennung}`,
      maxDurationS: MAX_DAUER_S,
    });
    call.status = "active";
    call.startedAt = new Date(jetzt - 10 * MINUTE_MS).toISOString();
    call.answeredAt = call.startedAt;
    call.fristHoechstdauerAt = new Date(jetzt + hoechstdauerInMinuten * MINUTE_MS).toISOString();
    store.save();
    return call.id;
  };
  return { store, aufgelegt, aktiverAnruf };
}
