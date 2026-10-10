import { after } from "node:test";
import http from "node:http";
import pg from "pg";
import { BASE_ENV, OWNER_TEST_NUMBER, tempDataDir, waitUntil } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { echtWarten } from "../echt-warten.js";

const BETREIBER_MAIL = "betreiber@kv2.invalid";
export const LOGIN_SUB = "kv2-betreiber";
const BREVO_VERSAND = "https://api.brevo.com/v3/smtp/email";
const BREVO_KONTO = "https://api.brevo.com/v3/account";
const WORKOS_BASIS = "https://workos.kv2.invalid";
const LOKAL = "http://127.0.0.1:";
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

async function datenbankOhneSonderrechte(storeHolen) {
  const anlegen = aufraeumenVormerken(storeHolen);
  const db = await anlegen(await vorlage("leer", async () => {}, []));
  await db.exec(`CREATE ROLE kv2_app NOSUPERUSER NOBYPASSRLS;
    GRANT CREATE, USAGE ON SCHEMA public TO kv2_app;
    SET ROLE kv2_app;`);
  return db;
}

async function unbelegtenAnrufAnlegen(store) {
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

function poolAufPglite(db) {
  pg.Pool = class PglitePool {
    async connect() {
      return {
        query: async (text, params) => {
          if (params !== undefined) return db.query(text, params);
          const ergebnisse = await db.exec(text);
          return ergebnisse.at(-1) ?? { rows: [] };
        },
        release() {},
      };
    }

    async end() {}
  };
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
    if (ziel === `${WORKOS_BASIS}/user_management/authenticate`) {
      const user = { id: LOGIN_SUB, email: BETREIBER_MAIL, email_verified: true };
      return new Response(JSON.stringify({ user }), { status: 200 });
    }
    if (!ziel.startsWith(LOKAL)) throw new Error(`Testaufbau: Zugriff nach außen gesperrt (${ziel})`);
    return echtesFetch(url, optionen);
  };
}

function mitFrist(versprechen, fristMs, was) {
  const signal = AbortSignal.timeout(fristMs);
  const abgelaufen = new Promise((_erfuellen, ablehnen) => {
    signal.addEventListener("abort", () => ablehnen(new Error(`${was} nicht innerhalb von ${fristMs} ms`)), { once: true });
  });
  return Promise.race([versprechen, abgelaufen]);
}

async function serverImportieren() {
  let server = null;
  const echtesListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function listenMitzeichnen(...args) {
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

async function hermesAufbauen({ alarmPostfach }) {
  const testPostfach = [];
  let server = null;
  let store = null;
  after(() => {
    server?.closeAllConnections();
    server?.close();
  });
  umgebungSetzen(alarmPostfach);
  const db = await datenbankOhneSonderrechte(() => store);
  poolAufPglite(db);
  aussenweltAbfangen(testPostfach);
  store = await import("../../src/store.js");
  await unbelegtenAnrufAnlegen(store);
  server = await serverImportieren();
  const basis = `http://127.0.0.1:${server.address().port}`;

  function anfrage(pfad, optionen = {}) {
    return fetch(`${basis}${pfad}`, { ...optionen, signal: AbortSignal.timeout(ANFRAGE_FRIST_MS) });
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

  return { db, testPostfach, anfrage, anmelden, warteAufProtokoll };
}
