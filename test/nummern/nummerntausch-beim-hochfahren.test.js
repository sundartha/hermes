import { test, after } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, tempDataDir } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { poolAufPglite, serverImportieren } from "../abrechnung/server-mit-testdatenbank.js";

const MANDANT = "t_tausch_boot";
const ALTE_NUMMER = "+4915799990031";
const ALTE_ID = "num_tausch_boot";
const ALTE_ANBIETER_ID = "pnum_alt_boot";
const ERSATZ = "+12025550177";
const ERSATZ_ANBIETER_ID = "pnum_neu_boot";
const EL_REGISTRIERUNG = "phnum_boot";
const TELNYX_BASIS = "https://telnyx.tausch-boot.invalid";
const EL_BASIS = "https://elevenlabs.tausch-boot.invalid";
const FREIGABE_PFAD = "/v2/phone_numbers/";
const TAUSCH_FRIST_MS = 10_000;
const LOGZEILE = new RegExp(`^\\[nummerntausch\\] tenant=${MANDANT} alt=\\S+ neu=…\\d{4} ergebnis=getauscht$`);
const TAUSCH_ENDE = /^\[nummerntausch\] (tenant=|Lauf abgebrochen)/;
const TAUSCH_ZEILE = "[nummerntausch] tenant=";

function umgebungSetzen() {
  Object.assign(process.env, BASE_ENV, {
    DATA_DIR: tempDataDir(),
    STORE_BACKEND: "pg",
    DATABASE_URL: "postgres://tausch-boot-attrappe.invalid/hermes",
    SESSION_SECRET: "tausch-boot-signierwert",
    PROVISIONING_ENABLED: "true",
    TELNYX_API_KEY: "KEYtest-tausch-boot",
    TELNYX_API_BASE: TELNYX_BASIS,
    TELNYX_CONNECTION_ID: "tausch-boot-verbindung",
    TELNYX_SIP_TRUNK_USERNAME: "tausch-boot-sip",
    TELNYX_SIP_TRUNK_PASSWORD: "tausch-boot-sip-wort",
    ELEVENLABS_OUTBOUND_ENABLED: "true",
    ELEVENLABS_NUMBER_REGISTRATION_ENABLED: "true",
    ELEVENLABS_API_KEY: "tausch-boot-el-schluessel",
    ELEVENLABS_AGENT_ID: "agent_tausch_boot",
    ELEVENLABS_API_BASE: EL_BASIS,
  });
}

async function datenbankAnlegen(storeHolen) {
  const anlegen = aufraeumenVormerken(storeHolen);
  const db = await anlegen(await vorlage("leer", async () => {}, []));
  await db.exec(`CREATE ROLE tausch_boot_app NOSUPERUSER NOBYPASSRLS;
    GRANT CREATE, USAGE ON SCHEMA public TO tausch_boot_app;
    SET ROLE tausch_boot_app;`);
  poolAufPglite(db);
  return db;
}

const alsJson = (koerper) => new Response(JSON.stringify(koerper), { status: 200 });

function telnyxAntwort(methode, pfad, freigaben) {
  if (methode === "GET" && pfad === "/v2/available_phone_numbers") return alsJson({ data: [{ phone_number: ERSATZ }] });
  if (methode === "POST" && pfad === "/v2/number_orders") return alsJson({ data: { phone_numbers: [{ phone_number: ERSATZ }] } });
  if (methode === "GET" && pfad === "/v2/phone_numbers") return alsJson({ data: [{ id: ERSATZ_ANBIETER_ID, phone_number: ERSATZ }] });
  if (methode === "DELETE" && pfad.startsWith(FREIGABE_PFAD)) {
    freigaben.push(pfad.slice(FREIGABE_PFAD.length));
    return alsJson({ data: {} });
  }
  return null;
}

function elAntwort(methode, pfad) {
  if (pfad !== "/v1/convai/phone-numbers") return null;
  if (methode === "GET") return alsJson([]);
  if (methode === "POST") return alsJson({ phone_number_id: EL_REGISTRIERUNG });
  return null;
}

function aussenweltAbfangen() {
  const freigaben = [];
  globalThis.fetch = async (url, optionen = {}) => {
    const ziel = new URL(String(url));
    const methode = (optionen.method ?? "GET").toUpperCase();
    const antwort =
      (ziel.origin === TELNYX_BASIS && telnyxAntwort(methode, ziel.pathname, freigaben)) ||
      (ziel.origin === EL_BASIS && elAntwort(methode, ziel.pathname));
    if (antwort) return antwort;
    throw new Error(`Testaufbau: Zugriff nach außen gesperrt (${methode} ${ziel.origin}${ziel.pathname})`);
  };
  return freigaben;
}

function protokollMitschreiben() {
  const zeilen = [];
  let tauschGemeldet;
  const tauschEnde = new Promise((erfuellen) => {
    tauschGemeldet = erfuellen;
  });
  for (const stufe of ["log", "warn", "error"]) {
    const original = console[stufe].bind(console);
    console[stufe] = (...teile) => {
      const zeile = teile.map(String).join(" ");
      zeilen.push(zeile);
      if (TAUSCH_ENDE.test(zeile)) tauschGemeldet();
      original(...teile);
    };
  }
  return { zeilen, tauschEnde };
}

async function mandantMitDeutscherNummer(store) {
  const state = store.load();
  state.tenants.push({ id: MANDANT, status: "active", kycLevel: "card", ownerName: "Tausch Boot" });
  state.numbers.push({
    id: ALTE_ID,
    tenantId: MANDANT,
    e164: ALTE_NUMMER,
    provider: "telnyx",
    status: "active",
    providerNumberId: ALTE_ANBIETER_ID,
    country: "DE",
    language: "de",
    paymentIntentId: null,
  });
  store.save();
  await store.drainFlushes();
}

function fristAbgelaufen(ms) {
  const signal = AbortSignal.timeout(ms);
  return new Promise((erfuellen) => signal.addEventListener("abort", erfuellen, { once: true }));
}

let store = null;
umgebungSetzen();
const db = await datenbankAnlegen(() => store);
const freigaben = aussenweltAbfangen();
const protokoll = protokollMitschreiben();
store = await import("../../src/store.js");
await store.oeffneSpeicher();
await mandantMitDeutscherNummer(store);
const server = await serverImportieren();
after(() => {
  server.closeAllConnections();
  server.close();
});
await Promise.race([protokoll.tauschEnde, fristAbgelaufen(TAUSCH_FRIST_MS)]);

const tauschZeilen = () => protokoll.zeilen.filter((zeile) => zeile.startsWith(TAUSCH_ZEILE));
const nummernDesMandanten = () => store.load().numbers.filter((nummer) => nummer.tenantId === MANDANT);

test("Kriterium 1: der Start ueber bootServer schreibt genau eine Logzeile ergebnis=getauscht fuer den Mandanten", () => {
  const zeilen = tauschZeilen();
  assert.equal(zeilen.length, 1, `Tausch-Logzeilen: ${JSON.stringify(zeilen)}`);
  assert.match(zeilen[0], LOGZEILE);
});

test("Kriterium 2: der Start gibt pnum_alt_boot genau einmal frei, alt released, Ersatz +1 active, did_released im Audit", async () => {
  assert.deepEqual(freigaben, [ALTE_ANBIETER_ID]);
  const alt = nummernDesMandanten().find((nummer) => nummer.id === ALTE_ID);
  assert.equal(alt.status, "released");
  const ersatz = nummernDesMandanten().filter((nummer) => nummer.id !== ALTE_ID);
  assert.deepEqual(
    ersatz.map(({ e164, status }) => ({ e164, status })),
    [{ e164: ERSATZ, status: "active" }],
  );
  const { rows } = await db.query("SELECT tenant_id, detail FROM audit_log WHERE action = $1", ["did_released"]);
  assert.deepEqual(rows, [{ tenant_id: MANDANT, detail: `number=${ALTE_ID} provider=${ALTE_ANBIETER_ID}` }]);
});
