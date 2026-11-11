import { after } from "node:test";
import http from "node:http";
import { EventEmitter } from "node:events";
import pg from "pg";
import { BASE_ENV, DOMESTIC_TEST_NUMBER, OWNER_TEST_NUMBER, tempDataDir, waitUntil } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { echtWarten } from "../echt-warten.js";
import { abrufMitFrist, fristSignal } from "../gemeinsam/antwortfrist.mjs";
import { planProfileFor } from "../../src/plans.js";
import { oeffneSpeicherAn } from "../gemeinsam/speicher-oeffnen.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/store/defaults.js";

export const BETREIBER_MAIL = "betreiber@kv2.invalid";
export const LOGIN_SUB = "kv2-betreiber";
const BREVO_VERSAND = "https://api.brevo.com/v3/smtp/email";
const BREVO_KONTO = "https://api.brevo.com/v3/account";
const WORKOS_BASIS = "https://workos.kv2.invalid";
const LOKAL = "http://127.0.0.1:";
const TELNYX_BASIS = "https://telnyx.kv2.invalid";
const TELNYX_VERBINDUNG = "kv2-verbindung";
const TELNYX_ANRUFSTART = `${TELNYX_BASIS}/v2/texml/calls/${TELNYX_VERBINDUNG}`;
const HTTP_FORBIDDEN = 403;
const UNBELEGTE_KOSTEN_CENT = 20;
const KOSTENQUELLE_NICHT_VERFUEGBAR = "unavailable";
const PROTOKOLL_FRIST_MS = 3000;
const PROTOKOLL_TAKT_MS = 20;
const ANFRAGE_FRIST_MS = 5000;
const START_FRIST_MS = 15000;

function umgebungSetzen(alarmPostfach) {
  process.env.NODE_ENV = BASE_ENV.NODE_ENV;
  process.env.PORT = BASE_ENV.PORT;
  process.env.DATA_DIR = tempDataDir();
  process.env.ANTHROPIC_API_KEY = BASE_ENV.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_BASE_URL = BASE_ENV.ANTHROPIC_BASE_URL;
  process.env.PUBLIC_URL = BASE_ENV.PUBLIC_URL;
  process.env.METRICS_ENABLED = BASE_ENV.METRICS_ENABLED;
  process.env.SKIP_TWILIO_SIGNATURE_CHECK = BASE_ENV.SKIP_TWILIO_SIGNATURE_CHECK;
  process.env.COST_TRUING_REQUIRED_RECORD_TYPES = BASE_ENV.COST_TRUING_REQUIRED_RECORD_TYPES;
  process.env.ELEVENLABS_API_BASE = BASE_ENV.ELEVENLABS_API_BASE;
  process.env.STORE_BACKEND = "pg";
  process.env.DATABASE_URL = "postgres://kv2-attrappe.invalid/hermes";
  process.env.SESSION_SECRET = "kv2-test-signierwert";
  process.env.WORKOS_API_BASE = WORKOS_BASIS;
  process.env.ADMIN_EMAILS = BETREIBER_MAIL;
  process.env.BREVO_API_KEY = "kv2-brevo-attrappe";
  process.env.MAIL_FROM = "alarm@kv2.invalid";
  process.env.PLATFORM_ALERT_MAIL_TO = alarmPostfach;
  process.env.PLATFORM_ALERT_SMS_TO = "";
}

function telnyxLehntAnrufstartAb() {
  process.env.TELNYX_API_KEY = "KEYtest-secret";
  process.env.TELNYX_CONNECTION_ID = TELNYX_VERBINDUNG;
  process.env.TELNYX_API_BASE = TELNYX_BASIS;
}

function sqlName(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Testaufbau: ungültiger Rollen- oder Datenbankname ${String(name)}`);
  return `"${name}"`;
}

async function rechteVorbereiten(db, { zusatzRollen, appRolleDatenbankAnlegen, appRolleVerwaltetZusatzRollen }) {
  const anweisungen = zusatzRollen.map((rolle) => `CREATE ROLE ${sqlName(rolle)} NOLOGIN NOSUPERUSER NOBYPASSRLS;`);
  if (appRolleDatenbankAnlegen) {
    const { rows } = await db.query("SELECT current_database() AS name");
    anweisungen.push(`GRANT CREATE ON DATABASE ${sqlName(rows[0].name)} TO kv2_app;`);
  }
  if (appRolleVerwaltetZusatzRollen) {
    anweisungen.push(...zusatzRollen.map((rolle) => `GRANT ${sqlName(rolle)} TO kv2_app WITH ADMIN OPTION;`));
  }
  return anweisungen.join("\n");
}

async function datenbankOhneSonderrechte(storeHolen, rechte) {
  const anlegen = aufraeumenVormerken(storeHolen);
  const db = await anlegen(await vorlage("leer", async () => {}, []));
  await db.exec(`CREATE ROLE kv2_app NOSUPERUSER NOBYPASSRLS;
    GRANT CREATE, USAGE ON SCHEMA public TO kv2_app;`);
  const zusaetzlich = await rechteVorbereiten(db, rechte);
  if (zusaetzlich) await db.exec(zusaetzlich);
  await db.exec("SET ROLE kv2_app;");
  return db;
}

export const laufClients = [];
let ohneStartanrufAktiv = false;

async function nummerOhneAnrufAnlegen(store) {
  store.load().numbers.push({ id: "num_kv2", ...OWNER_TEST_NUMBER, tenantId: BOOTSTRAP_TENANT_ID, status: "active", providerNumberId: null });
  store.save();
  await store.drainFlushes();
}

async function unbelegtenAnrufAnlegen(store) {
  if (ohneStartanrufAktiv) return nummerOhneAnrufAnlegen(store);
  const { makeDueOutboundCall } = await import("../cost-truing-harness.js");
  const state = store.load();
  const nowMs = Date.now();
  const call = makeDueOutboundCall(state, { nowMs, estimatedCostCents: UNBELEGTE_KOSTEN_CENT });
  state.numbers.push({ id: "num_kv2", ...OWNER_TEST_NUMBER, tenantId: call.tenantId, status: "active", providerNumberId: null });
  store.save();
  const abgeschlossen = store.recordCallCostTruingResult(call.id, {
    source: KOSTENQUELLE_NICHT_VERFUEGBAR,
    closedAt: new Date(nowMs).toISOString(),
  });
  if (abgeschlossen?.costTruedSource !== KOSTENQUELLE_NICHT_VERFUEGBAR) throw new Error("Testaufbau: Kostenabgleich des Anrufs ließ sich nicht schließen");
  await store.drainFlushes();
}

function abfrageAn(db) {
  return async (text, params) => {
    if (params !== undefined) return db.query(text, params);
    const ergebnisse = await db.exec(text);
    return ergebnisse.at(-1) ?? { rows: [] };
  };
}

function clientAufPglite(db) {
  const angelegt = [];
  pg.Client = class PgliteClient extends EventEmitter {
    constructor(optionen) {
      super();
      this.optionen = optionen;
      angelegt.push(this);
    }

    async connect() {}

    query = abfrageAn(db);

    async end() {}
  };
  return angelegt;
}

async function appRolleErstelltRollenWenn(db, { appRolleErstelltRollen = false }) {
  if (appRolleErstelltRollen) await db.exec("RESET ROLE; ALTER ROLE kv2_app CREATEROLE; SET ROLE kv2_app;");
}

function kennzahlenAufbauen(db, { clientBruecke, kennzahlenAdresse = "", unterKennzahlenLeser = false, ohneStartanruf = false }) {
  if (clientBruecke) laufClientsVerfolgen(db, unterKennzahlenLeser);
  if (kennzahlenAdresse) process.env.KENNZAHLEN_DATABASE_URL = kennzahlenAdresse;
  ohneStartanrufAktiv = ohneStartanruf;
}

function laufClientsVerfolgen(db, unterKennzahlenLeser) {
  const Basis = pg.Client;
  pg.Client = class LaufClient extends Basis {
    constructor(optionen) {
      super(optionen);
      laufClients.push(this);
      if (unterKennzahlenLeser) this.query = (text, params) => leserAbfrage(db, text, params);
    }
  };
}

function leserAbfrage(db, text, params) {
  return db.transaction(async (transaktion) => {
    await transaktion.exec("SET LOCAL ROLE kennzahlen_leser");
    return abfrageAn(transaktion)(text, params);
  });
}

export function poolAufPglite(db, { exklusiv = true } = {}) {
  const angelegt = [];
  const abfrage = abfrageAn(db);
  let frei = Promise.resolve();
  pg.Pool = class PglitePool extends EventEmitter {
    waitingCount = 0;
    totalCount = 0;

    constructor(optionen) {
      super();
      this.optionen = optionen;
      angelegt.push(this);
    }

    async connect() {
      if (!exklusiv) return { query: abfrage, release() {} };
      const vorgaenger = frei;
      let freigeben;
      frei = new Promise((erfuellen) => {
        freigeben = erfuellen;
      });
      await vorgaenger;
      return { query: abfrage, release: freigeben };
    }

    async end() {}
  };
  return angelegt;
}

function aussenweltAbfangen(testPostfach) {
  const echtesFetch = globalThis.fetch;
  globalThis.fetch = async (url, optionen = {}) => {
    const ziel = String(url);
    if (ziel === BREVO_VERSAND) {
      testPostfach.push(JSON.parse(optionen.body));
      return new Response("{}", { status: 201 });
    }
    if (ziel === BREVO_KONTO) return new Response("{}", { status: 200 });
    if (ziel === TELNYX_ANRUFSTART) return new Response("{}", { status: HTTP_FORBIDDEN });
    if (ziel === `${WORKOS_BASIS}/user_management/authenticate`) {
      const user = { id: LOGIN_SUB, email: BETREIBER_MAIL, email_verified: true };
      return new Response(JSON.stringify({ user }), { status: 200 });
    }
    if (!ziel.startsWith(LOKAL)) throw new Error(`Testaufbau: Zugriff nach außen gesperrt (${ziel})`);
    return echtesFetch(url, {
      ...optionen,
      signal: AbortSignal.any([fristSignal(), ...(optionen.signal ? [optionen.signal] : [])]),
    });
  };
}

function mitFrist(versprechen, fristMs, was) {
  const signal = AbortSignal.timeout(fristMs);
  const abgelaufen = new Promise((_erfuellen, ablehnen) => {
    signal.addEventListener("abort", () => ablehnen(new Error(`${was} nicht innerhalb von ${fristMs} ms`)), { once: true });
  });
  return Promise.race([versprechen, abgelaufen]);
}

export async function serverImportieren() {
  let server = null;
  const echtesListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function listenMitzeichnen(...args) {
    if (args[0] !== 0) throw new Error(`Testaufbau: Server soll auf einem freien Port (0) lauschen, bekommt ${String(args[0])}`);
    server = this;
    return echtesListen.apply(this, args);
  };
  try {
    await mitFrist(import("../../src/server.js"), START_FRIST_MS, "Serverstart");
  } finally {
    http.Server.prototype.listen = echtesListen;
  }
  await waitUntil(() => Boolean(server?.address()));
  return server;
}

function cookiesAus(antwort) {
  return antwort.headers.getSetCookie().map((zeile) => zeile.split(";")[0]);
}

export async function starteHermesMitPglite(optionen) {
  const start = await hermesAufbauen(optionen).then((hermes) => ({ hermes }), (startfehler) => ({ startfehler }));
  return function laufendesHermes() {
    if (start.startfehler) throw start.startfehler;
    return start.hermes;
  };
}

const ERNEUTE_STORE_STARTS = [
  () => import("../../src/store.js?schema-erneut-1").then(oeffneSpeicherAn),
  () => import("../../src/store.js?schema-erneut-2").then(oeffneSpeicherAn),
  () => import("../../src/store.js?schema-erneut-3").then(oeffneSpeicherAn),
];

async function hermesAufbauen({
  alarmPostfach,
  anrufstartAbgelehnt = false,
  zusatzRollen = [],
  appRolleDatenbankAnlegen = false,
  appRolleVerwaltetZusatzRollen = false,
  clientBruecke = false,
  ...kennzahlenOptionen
}) {
  const testPostfach = [];
  let server = null;
  let store = null;
  after(() => {
    server?.closeAllConnections();
    server?.close();
  });
  umgebungSetzen(alarmPostfach);
  if (anrufstartAbgelehnt) telnyxLehntAnrufstartAb();
  const db = await datenbankOhneSonderrechte(() => store, { zusatzRollen, appRolleDatenbankAnlegen, appRolleVerwaltetZusatzRollen });
  await appRolleErstelltRollenWenn(db, kennzahlenOptionen);
  poolAufPglite(db);
  if (clientBruecke) clientAufPglite(db);
  kennzahlenAufbauen(db, { clientBruecke, ...kennzahlenOptionen });
  aussenweltAbfangen(testPostfach);
  store = await import("../../src/store.js").then(oeffneSpeicherAn);
  await unbelegtenAnrufAnlegen(store);
  server = await serverImportieren();
  const basis = `http://127.0.0.1:${server.address().port}`;

  function anfrage(pfad, optionen = {}) {
    return abrufMitFrist(`${basis}${pfad}`, { ...optionen, signal: AbortSignal.timeout(ANFRAGE_FRIST_MS) });
  }

  function aufwaermen(pfad, optionen = {}) {
    return abrufMitFrist(`${basis}${pfad}`, optionen, { wartezeitMs: START_FRIST_MS });
  }

  async function anmelden() {
    const start = await anfrage("/auth/login", { redirect: "manual" });
    const weiterleitung = new URL(start.headers.get("location"));
    const state = weiterleitung.searchParams.get("state");
    const rueckruf = await anfrage(`/auth/callback?code=kv2-code&state=${encodeURIComponent(state)}`, {
      headers: { cookie: cookiesAus(start).join("; ") },
      redirect: "manual",
    });
    return { rueckruf, sessionCookie: cookiesAus(rueckruf).find((cookie) => cookie.startsWith("__Host-session=")) };
  }

  async function warteAufProtokoll(action, passt = () => true) {
    const frist = Date.now() + PROTOKOLL_FRIST_MS;
    for (;;) {
      const { rows } = await db.query("SELECT tenant_id, actor_sub, detail FROM audit_log WHERE action = $1 ORDER BY id", [action]);
      const treffer = rows.filter(passt);
      if (treffer.length > 0 || Date.now() > frist) return treffer;
      await echtWarten(PROTOKOLL_TAKT_MS);
    }
  }

  async function betreiberDarfAnrufen() {
    const tenantId = store.resolveTenant(LOGIN_SUB);
    const state = store.load();
    const tenant = state.tenants.find((eintrag) => eintrag.id === tenantId);
    await db.query("UPDATE tenant SET status = 'active' WHERE id = $1", [tenantId]);
    Object.assign(tenant, { status: "active", ownerName: "Kai Betreiber" });
    state.profiles[tenantId] = { ...planProfileFor("starter") };
    state.numbers.push({ id: "num_kv2_betreiber", ...DOMESTIC_TEST_NUMBER, tenantId, status: "active", providerNumberId: null });
    store.save();
    await store.setKycLevel(tenantId, "card");
    await store.drainFlushes();
    return tenantId;
  }

  let schemaLaeufe = 0;
  async function schemaErneutAnwenden() {
    const frischerStore = ERNEUTE_STORE_STARTS[schemaLaeufe];
    if (!frischerStore) throw new Error(`Testaufbau: Schema lässt sich höchstens ${ERNEUTE_STORE_STARTS.length}-mal erneut anwenden`);
    schemaLaeufe += 1;
    await mitFrist(frischerStore(), START_FRIST_MS, "Schema erneut anwenden");
  }

  function neuerClient() {
    if (!clientBruecke) throw new Error("Testaufbau: neuerClient braucht die Option clientBruecke");
    return new pg.Client({ connectionString: process.env.DATABASE_URL });
  }

  return { db, testPostfach, anfrage, aufwaermen, anmelden, warteAufProtokoll, betreiberDarfAnrufen, schemaErneutAnwenden, neuerClient };
}
