import { after } from "node:test";
import http from "node:http";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import pg from "pg";
import { BASE_ENV, EL_INBOUND_ACCESS_BOOT_ENV, EL_OUTBOUND_ZUGANG_BOOT_ENV, DOMESTIC_TEST_NUMBER, OWNER_TEST_NUMBER, tempDataDir, waitUntil } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { echtWarten } from "../echt-warten.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { planProfileFor } from "../../src/plans.ts";
import { oeffneSpeicherAn } from "../gemeinsam/speicher-oeffnen.js";

export const BETREIBER_MAIL = "betreiber@kv2.invalid";
export const LOGIN_SUB = "kv2-betreiber";
const BREVO_VERSAND = "https://api.brevo.com/v3/smtp/email";
const BREVO_KONTO = "https://api.brevo.com/v3/account";
const WORKOS_BASIS = "https://workos.kv2.invalid";
const LOKAL = "http://127.0.0.1:";
const TELNYX_BASIS = "https://telnyx.kv2.invalid";
const TELNYX_VERBINDUNG = "kv2-verbindung";
const TELNYX_ANRUFSTART = `${TELNYX_BASIS}/v2/texml/calls/${TELNYX_VERBINDUNG}`;
const EL_BASIS = "https://elevenlabs.kv2.invalid";
const EL_ANRUFSTART = `${EL_BASIS}/v1/convai/sip-trunk/outbound-call`;
const HTTP_FORBIDDEN = 403;
const HTTP_OK = 200;
const EL_TTS_PFAD = `${EL_BASIS}/v1/text-to-speech/`;
const ABGELEHNTE_STARTS = new Set([TELNYX_ANRUFSTART, EL_ANRUFSTART, `${TELNYX_BASIS}/v2/calls`]);
const VORSPANN_AUDIO_BYTES = 200_000;
const VORSPANN_BELEG_ZEITPUNKT = "2026-09-15T08:00:00.000Z";
const FINGERABDRUCK_ZEICHEN = 16;
const UNBELEGTE_KOSTEN_CENT = 20;
const KOSTENQUELLE_NICHT_VERFUEGBAR = "unavailable";
const PROTOKOLL_FRIST_MS = 3000;
const PROTOKOLL_TAKT_MS = 20;
const ANFRAGE_FRIST_MS = 5000;
export const START_FRIST_MS = 15000;
const AUFWAERM_ZIEL = "+4917312345680";

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
  Object.assign(process.env, EL_INBOUND_ACCESS_BOOT_ENV, EL_OUTBOUND_ZUGANG_BOOT_ENV);
  process.env.STORE_BACKEND = "pg";
  process.env.DATABASE_URL = "postgres://kv2-attrappe.invalid/hermes";
  process.env.SESSION_SECRET = "kv2-test-signierwert";
  process.env.WORKOS_API_BASE = WORKOS_BASIS;
  process.env.ADMIN_EMAILS = BETREIBER_MAIL;
  process.env.BREVO_API_KEY = "kv2-brevo-attrappe";
  process.env.MAIL_FROM = "alarm@kv2.invalid";
  process.env.PLATFORM_ALERT_MAIL_TO = alarmPostfach;
  process.env.PLATFORM_ALERT_SMS_TO = "";
  process.env.OUTAGE_ALERT_WINDOW_MS = BASE_ENV.OUTAGE_ALERT_WINDOW_MS;
}

function telnyxLehntAnrufstartAb() {
  process.env.TELNYX_API_KEY = "KEYtest-secret";
  process.env.TELNYX_CONNECTION_ID = TELNYX_VERBINDUNG;
  process.env.TELNYX_API_BASE = TELNYX_BASIS;
  process.env.ELEVENLABS_API_BASE = EL_BASIS;
}

function vorspannLehntWahlAb(aktiv) {
  vorspannAktiv = aktiv;
  if (!aktiv) return;
  process.env.TELNYX_API_KEY = "KEYtest-secret";
  process.env.TELNYX_CONNECTION_ID = TELNYX_VERBINDUNG;
  process.env.TELNYX_API_BASE = TELNYX_BASIS;
  process.env.TELNYX_CALL_CONTROL_APP_ID = "cc_app_kv2";
  process.env.ELEVENLABS_API_BASE = EL_BASIS;
  process.env.ELEVENLABS_API_KEY = "kv2-el-schluessel";
  process.env.ELEVENLABS_AGENT_ID = "agent_kv2";
  process.env.ELEVENLABS_INBOUND_ENABLED = "true";
  process.env.ELEVENLABS_INBOUND_SCOPE = "registrierte_dids";
  process.env.ELEVENLABS_OUTBOUND_UEBER_TELNYX = "true";
  process.env.ELEVENLABS_OUTBOUND_VORSPANN = "true";
}

export const vorspannBelegFelder = () => ({
  elInboundTrunkBelegtAt: VORSPANN_BELEG_ZEITPUNKT,
  elInboundTrunkZugangFp: createHash("sha256")
    .update(EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_USER)
    .digest("hex")
    .slice(0, FINGERABDRUCK_ZEICHEN),
});

const vorspannNummerFelder = () => (vorspannAktiv ? vorspannBelegFelder() : {});

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
let vorspannAktiv = false;

async function nummerOhneAnrufAnlegen(store) {
  const state = store.load();
  state.numbers.push({ id: "num_kv2", ...OWNER_TEST_NUMBER, tenantId: state.tenants[0].id, status: "active", providerNumberId: null, ...vorspannNummerFelder() });
  store.save();
  await store.drainFlushes();
}

async function unbelegtenAnrufAnlegen(store) {
  if (ohneStartanrufAktiv) return nummerOhneAnrufAnlegen(store);
  const { makeDueOutboundCall } = await import("../cost-truing-harness.js");
  const state = store.load();
  const nowMs = Date.now();
  const call = makeDueOutboundCall(state, { nowMs, estimatedCostCents: UNBELEGTE_KOSTEN_CENT });
  state.numbers.push({ id: "num_kv2", ...OWNER_TEST_NUMBER, tenantId: call.tenantId, status: "active", providerNumberId: null, ...vorspannNummerFelder() });
  store.save();
  const abgeschlossen = await store.recordCallCostTruingResult(call.id, {
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

const EINGANG_ADRESSE = "https://eingang.kv2.invalid/hook";

export function aussenweltAbfangen(testPostfach, vorfaelle) {
  const echtesFetch = globalThis.fetch;
  globalThis.fetch = async (url, optionen = {}) => {
    const ziel = String(url);
    if (ziel === BREVO_VERSAND) {
      testPostfach.push(JSON.parse(optionen.body));
      return new Response("{}", { status: 201 });
    }
    if (ziel === EINGANG_ADRESSE) {
      vorfaelle.push(JSON.parse(optionen.body));
      return new Response(null, { status: 200 });
    }
    if (ziel === BREVO_KONTO) return new Response("{}", { status: 200 });
    if (ABGELEHNTE_STARTS.has(ziel)) return new Response("{}", { status: HTTP_FORBIDDEN });
    if (ziel.startsWith(EL_TTS_PFAD)) return new Response(Buffer.alloc(VORSPANN_AUDIO_BYTES, 1), { status: HTTP_OK, headers: { "content-type": "audio/mpeg" } });
    if (ziel === `${WORKOS_BASIS}/user_management/authenticate`) {
      const user = { id: LOGIN_SUB, email: BETREIBER_MAIL, email_verified: true };
      return new Response(JSON.stringify({ user }), { status: 200 });
    }
    if (!ziel.startsWith(LOKAL)) throw new Error(`Testaufbau: Zugriff nach außen gesperrt (${ziel})`);
    return echtesFetch(url, {
      ...optionen,
      signal: AbortSignal.any([AbortSignal.timeout(START_FRIST_MS), ...(optionen.signal ? [optionen.signal] : [])]),
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
  () => import("../../src/store.js?schema-erneut-4").then(oeffneSpeicherAn),
];

async function anrufwegAufwaermen(aktiv, { anmelden, betreiberDarfAnrufen, aufwaermen }) {
  if (!aktiv) return null;
  await anmelden();
  await betreiberDarfAnrufen();
  const antwort = await aufwaermen("/api/calls", {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-identity": LOGIN_SUB },
    body: JSON.stringify({ to: AUFWAERM_ZIEL, objective: "Termin vereinbaren" }),
  });
  await antwort.arrayBuffer();
  return antwort.status;
}

async function hermesAufbauen({
  alarmPostfach,
  anrufstartAbgelehnt = false,
  vorspannWahlAbgelehnt,
  eingang = false,
  zusatzRollen = [],
  appRolleDatenbankAnlegen = false,
  appRolleVerwaltetZusatzRollen = false,
  clientBruecke = false,
  ...kennzahlenOptionen
}) {
  const testPostfach = [];
  const vorfaelle = [];
  let server = null;
  let store = null;
  after(() => {
    server?.closeAllConnections();
    server?.close();
  });
  umgebungSetzen(alarmPostfach);
  if (eingang) process.env.BETTERSTACK_ALERT_URL = EINGANG_ADRESSE;
  if (anrufstartAbgelehnt) telnyxLehntAnrufstartAb();
  vorspannLehntWahlAb(vorspannWahlAbgelehnt);
  const db = await datenbankOhneSonderrechte(() => store, { zusatzRollen, appRolleDatenbankAnlegen, appRolleVerwaltetZusatzRollen });
  await appRolleErstelltRollenWenn(db, kennzahlenOptionen);
  poolAufPglite(db);
  if (clientBruecke) clientAufPglite(db);
  kennzahlenAufbauen(db, { clientBruecke, ...kennzahlenOptionen });
  aussenweltAbfangen(testPostfach, vorfaelle);
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
    const gewuenschtesProfil = state.profiles[tenantId];
    delete state.profiles[tenantId];
    store.setProfile(tenantId, gewuenschtesProfil);
    if (!state.numbers.some((nummer) => nummer.id === "num_kv2_betreiber"))
      state.numbers.push({ id: "num_kv2_betreiber", ...DOMESTIC_TEST_NUMBER, tenantId, status: "active", providerNumberId: null, providerAgentPhoneNumberId: "phnum_kv2_betreiber", ...vorspannNummerFelder() });
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

  const aufwaermStatus = await anrufwegAufwaermen(kennzahlenOptionen.anrufwegWaermen, { anmelden, betreiberDarfAnrufen, aufwaermen });

  return { db, testPostfach, vorfaelle, aufwaermStatus, anfrage, aufwaermen, anmelden, warteAufProtokoll, betreiberDarfAnrufen, schemaErneutAnwenden, neuerClient };
}
