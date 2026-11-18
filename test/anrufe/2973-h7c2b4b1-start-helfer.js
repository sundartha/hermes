import http from "node:http";
import { BASE_ENV, captureConsole, tempDataDir } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { poolAufPglite, serverImportieren } from "../abrechnung/server-mit-testdatenbank.js";
import { WEB_SITZUNGS_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";

export const MANDANT = "t_h7c2b4b1_start";
export const ANRUF_ABSENDER = "+4930555000311";
export const ANRUF_ZIEL = "+4915112349933";
export const LESEFEHLER = "Bericht lesen kaputt (h7c2b4b1-test)";
const MANDANTEN_LESEN = "SELECT id FROM tenant ORDER BY id";
const VOR_MS = 60_000;
const SCHAETZUNG_CENT = 20;

function umgebungSetzen() {
  Object.assign(process.env, BASE_ENV, {
    DATA_DIR: tempDataDir(),
    STORE_BACKEND: "pg",
    DATABASE_URL: "postgres://h7c2b4b1-attrappe.invalid/hermes",
    SESSION_SECRET: WEB_SITZUNGS_GEHEIMNIS,
    VOICE_TARIFF_FULL_COST_FLOOR_CENTS: "5",
  });
}

function mitBerichtsausfall(db, zustand) {
  const pruefen = (text) => {
    if (String(text) !== MANDANTEN_LESEN || zustand.scheiternAb === undefined) return;
    zustand.gelesen += 1;
    if (zustand.gelesen >= zustand.scheiternAb) throw new Error(LESEFEHLER);
  };
  return new Proxy(db, {
    get(ziel, name) {
      if (name !== "query" && name !== "exec") return Reflect.get(ziel, name).bind(ziel);
      return async (text, ...rest) => {
        pruefen(text);
        return ziel[name](text, ...rest);
      };
    },
  });
}

async function andereInstanzLegtBelegtenAnrufAn(db) {
  const runner = {
    withClient: (arbeit) => arbeit({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
  };
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [MANDANT]);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1) ON CONFLICT (id) DO NOTHING`, [MANDANT]);
  const { makePgStore } = await import("../pg-helpers.js");
  const fremd = makePgStore(runner);
  await fremd.init();
  const call = fremd.createCall({ direction: "outbound", from: ANRUF_ABSENDER, to: ANRUF_ZIEL, goal: "Test", tenantId: MANDANT });
  await fremd.persistCall(call.id);
  const angelegt = fremd.getCall(call.id);
  angelegt.status = "completed";
  angelegt.answeredAt = new Date(Date.now() - 2 * VOR_MS).toISOString();
  angelegt.endedAt = new Date(Date.now() - VOR_MS).toISOString();
  angelegt.estimatedCostCents = SCHAETZUNG_CENT;
  angelegt.costTruedSource = "telnyx_detail_records";
  angelegt.costTruedAt = angelegt.endedAt;
  fremd.save();
  await fremd.drainFlushes();
}

async function eigeneInstanzOeffnen() {
  const store = await import("../../src/store.js");
  await store.oeffneSpeicher();
  const state = store.load();
  state.tenants.push({ id: MANDANT, status: "active", kycLevel: "card", ownerName: "Start Bericht" });
  state.numbers.push({
    id: "num_h7c2b4b1_start",
    tenantId: MANDANT,
    e164: "+4915799990051",
    provider: "telnyx",
    status: "active",
    providerNumberId: "pnum_h7c2b4b1_start",
    country: "DE",
    language: "de",
    paymentIntentId: null,
  });
  store.save();
  await store.drainFlushes();
  return store;
}

export async function startMitFremdemAnruf({ scheiternAb } = {}) {
  umgebungSetzen();
  let store = null;
  const anlegen = aufraeumenVormerken(() => store);
  const db = await anlegen(await vorlage("leer", async () => {}, []));
  await db.exec(`CREATE ROLE h7c2b4b1_app NOSUPERUSER NOBYPASSRLS;
    GRANT CREATE, USAGE ON SCHEMA public TO h7c2b4b1_app;
    SET ROLE h7c2b4b1_app;`);
  const zustand = {};
  poolAufPglite(mitBerichtsausfall(db, zustand));
  store = await eigeneInstanzOeffnen();
  await andereInstanzLegtBelegtenAnrufAn(db);
  zustand.gelesen = 0;
  zustand.scheiternAb = scheiternAb;
  let lauscht = 0;
  const echtesListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function zaehlendesListen(...args) {
    lauscht += 1;
    return echtesListen.apply(this, args);
  };
  let ergebnis;
  const zeilen = await captureConsole(async () => {
    ergebnis = await serverImportieren().then((server) => ({ server }), (fehler) => ({ fehler }));
  });
  http.Server.prototype.listen = echtesListen;
  ergebnis.server?.close();
  return { fehler: ergebnis.fehler, lauscht, zeilen: zeilen.join("\n") };
}
