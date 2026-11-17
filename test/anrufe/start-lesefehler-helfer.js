import http from "node:http";
import { BASE_ENV, tempDataDir } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { poolAufPglite, serverImportieren } from "../abrechnung/server-mit-testdatenbank.js";

const MANDANT = "t_start_lesefehler";
const AKTIVE_ANRUFE_LESEN = "SELECT * FROM call WHERE tenant_id = $1 AND status = 'active'";
const MANDANTEN_BEIM_START = 2;
export const LESEFEHLER = "Start ohne Datenbank (lesefehler-test)";

function umgebungSetzen() {
  Object.assign(process.env, BASE_ENV, {
    DATA_DIR: tempDataDir(),
    STORE_BACKEND: "pg",
    DATABASE_URL: "postgres://start-lesefehler-attrappe.invalid/hermes",
    SESSION_SECRET: "start-lesefehler-signierwert",
  });
}

function scheiterndeDatenbank(db, scheiternde) {
  let lesungen = 0;
  return new Proxy(db, {
    get(ziel, name) {
      if (name !== "query") return Reflect.get(ziel, name).bind(ziel);
      return async (text, params) => {
        if (String(text).startsWith(AKTIVE_ANRUFE_LESEN)) {
          lesungen += 1;
          if (lesungen > (scheiternde - 1) * MANDANTEN_BEIM_START) throw new Error(LESEFEHLER);
        }
        return ziel.query(text, params);
      };
    },
  });
}

export async function startMitLesefehlerBeiLesung(durchgang) {
  umgebungSetzen();
  let store = null;
  const anlegen = aufraeumenVormerken(() => store);
  const db = await anlegen(await vorlage("leer", async () => {}, []));
  await db.exec(`CREATE ROLE start_lesefehler_app NOSUPERUSER NOBYPASSRLS;
    GRANT CREATE, USAGE ON SCHEMA public TO start_lesefehler_app;
    SET ROLE start_lesefehler_app;`);
  poolAufPglite(scheiterndeDatenbank(db, durchgang));
  store = await import("../../src/store.js");
  await store.oeffneSpeicher();
  const state = store.load();
  state.tenants.push({ id: MANDANT, status: "active", kycLevel: "card", ownerName: "Start Lesefehler" });
  state.numbers.push({
    id: "num_start_lesefehler",
    tenantId: MANDANT,
    e164: "+4915799990041",
    provider: "telnyx",
    status: "active",
    providerNumberId: "pnum_start_lesefehler",
    country: "DE",
    language: "de",
    paymentIntentId: null,
  });
  store.save();
  await store.drainFlushes();
  let lauscht = 0;
  const echtesListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function zaehlendesListen(...args) {
    lauscht += 1;
    return echtesListen.apply(this, args);
  };
  const ergebnis = await serverImportieren().then(
    (server) => ({ server }),
    (fehler) => ({ fehler }),
  );
  http.Server.prototype.listen = echtesListen;
  ergebnis.server?.close();
  return { fehler: ergebnis.fehler, lauscht };
}
