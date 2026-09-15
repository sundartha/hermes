// ---- IEX-A7: Missbrauchs-Limit am Init-Webhook (POST /webhooks/elevenlabs/init) --------------
// Tests 1-8 laufen IN-PROCESS ueber die echte Schranke (initTokenSchranke + echter
// Fixed-Window-Zaehler) VOR express.json und den echten Router - dieselbe Reihenfolge wie in
// app.js. Die Verdrahtung in app.js selbst (Schranke vor den Parsern, ausserhalb des globalen
// Limiters, exakter Router) pruefen die Spawn-Tests 9 und 10: app.js darf hier nicht in-process
// importiert werden (initialisiert store/json.js, s. test/route-auth-inventory.test.js).
//
// Namen beginnen mit "IEX-A7-<n>: " - trifft weder i18nCatalogPattern noch abnahmePattern.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { INIT_WEBHOOK_TOKEN_MIN_LENGTH } from "../src/elevenlabs/inbound-path-decision.js";
import { makeFixedWindowCounter, RATE_SWEEP_INTERVAL_MS, RATE_WINDOW_MS } from "../src/middleware.js";
import {
  ELEVENLABS_INIT_PATH,
  INIT_ANTWORT,
  INIT_FEHLVERSUCHE_PRO_MIN,
  INIT_TOKEN_HEADER,
  initTokenSchranke,
  istInitWebhookAnfrage,
  makeElevenLabsInitWebhookRoutes,
} from "../src/routes/webhooks-elevenlabs-init.js";
import { MS_PER_SECOND } from "../src/utils/timer.js";
import { captureConsole, startServer, waitForStoreState } from "./helpers.js";
import { elInboundInitSpawnEnv, initBindungsKoerper, spawnSeedWartenderElCall } from "./_iel-inbound-harness.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;

const INIT_TOKEN = "i".repeat(INIT_WEBHOOK_TOKEN_MIN_LENGTH);
const FALSCHES_TOKEN = "f".repeat(INIT_WEBHOOK_TOKEN_MIN_LENGTH);
const IP_X = "203.0.113.7";
const IP_Y = "203.0.113.8";
const KAPUTTES_JSON = "{kaputt";
const LEERES_JSON = "{}";
const AGENT_ID = "agent_iex_a7";
const FREMDES_BINDUNGS_TOKEN = "00112233445566778899aabbccddeeff";
const CONV = "conv_iex_a7";
const SPAWN_CALL_ID = "call_iex_a7_init";
const SPAWN_BINDUNGS_TOKEN = "ffeeddccbbaa99887766554433221100";
const FRISCH_BEANTWORTET_S = 2;
const GLOBALES_TESTLIMIT = 3;
const GUELTIGE_ANFRAGEN_UEBER_LIMIT = 10;
const ABLEHNUNGEN_NACH_GUELTIGEM_TOKEN = 40;
const DROSSELUNGEN_IM_FENSTER = 10;
const VERTRAUTE_PROXY_HOPS = 1;
const SEKUNDEN_JE_FENSTER = RATE_WINDOW_MS / MS_PER_SECOND;
const RETRY_AFTER_ATTRAPPE_S = 7;
// Drosselungen nach der ersten Zeile, alle noch im Fenster (die letzte an dessen Grenze - 1 ms).
const VERSAETZE_IM_FENSTER_MS = Object.freeze([0, 1, RATE_WINDOW_MS - 1]);
const UHR_START_MS = Date.parse("2026-09-15T10:00:00.000Z");
const SPAWN_INIT_TOKEN = elInboundInitSpawnEnv(AGENT_ID).ELEVENLABS_INIT_WEBHOOK_TOKEN;

const ZEILE_TOKEN_ABGELEHNT = "[el-init] abgelehnt grund=token";
const ZEILE_ERSTE_DROSSELUNG = "[el-init] gedrosselt anzahl=1";
const EL_INIT_PRAEFIX = "[el-init]";

// ---- Build ----------------------------------------------------------------------------------

function schrankenConfig() {
  return { voice: { elevenLabsInbound: { initWebhookToken: INIT_TOKEN }, elevenLabsOutbound: { agentId: AGENT_ID } } };
}

// Zaehlt jeden Eigenschafts-Zugriff auf den Store - 0 heisst: die Anfrage hat ihn nie beruehrt.
function zugriffsZaehlenderStore() {
  const zaehlung = { zugriffe: 0 };
  const store = new Proxy(
    { load: () => ({ calls: [] }) },
    {
      get(ziel, name) {
        zaehlung.zugriffe += 1;
        return Reflect.get(ziel, name);
      },
    },
  );
  return { store, zaehlung };
}

function neuerFehlversuchZaehler() {
  return makeFixedWindowCounter({ windowMs: RATE_WINDOW_MS, limit: INIT_FEHLVERSUCHE_PRO_MIN, sweepMs: RATE_SWEEP_INTERVAL_MS });
}

// Spion ueber den ECHTEN Zaehler: zaehlt jeden Aufruf, entscheidet aber echt.
function zaehlerSpion() {
  const echt = neuerFehlversuchZaehler();
  const aufrufe = { anzahl: 0 };
  const zaehler = (schluessel) => {
    aufrufe.anzahl += 1;
    return echt(schluessel);
  };
  return { zaehler, aufrufe };
}

// Reihenfolge wie app.js#installGlobalMiddleware: Schranke -> Parser -> Router.
async function mitSchrankeVorParser({ store = zugriffsZaehlenderStore().store, zaehler = neuerFehlversuchZaehler() }, run) {
  const config = schrankenConfig();
  const schranke = initTokenSchranke({ config, zaehler });
  const app = express();
  app.set("trust proxy", VERTRAUTE_PROXY_HOPS);
  // "test": der Express-Standardfehler (400 bei kaputtem JSON) schreibt keinen Stack ins Testlog.
  app.set("env", "test");
  app.use((req, res, next) => (istInitWebhookAnfrage(req) ? schranke(req, res, next) : next()));
  app.use(express.json());
  app.use(makeElevenLabsInitWebhookRoutes({ store, config, bridges: { clearDeadlines: () => {} } }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run({ baseUrl: `http://127.0.0.1:${server.address().port}` });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function anfrageKopfzeilen({ token, ip }) {
  const headers = { "content-type": "application/json" };
  if (token) headers[INIT_TOKEN_HEADER] = token;
  if (ip) headers["x-forwarded-for"] = ip;
  return headers;
}

async function initPost(baseUrl, { pfad = ELEVENLABS_INIT_PATH, token, ip, rohKoerper = LEERES_JSON }) {
  const res = await fetch(`${baseUrl}${pfad}`, { method: "POST", headers: anfrageKopfzeilen({ token, ip }), body: rohKoerper });
  return { status: res.status, text: await res.text(), retryAfter: res.headers.get("retry-after") };
}

// Sequentiell (await je Anfrage, nie Promise.all): die Statusfolge ist die Zaehlfolge.
async function wiederholtePosts(baseUrl, { anzahl, ...anfrage }) {
  const antworten = [];
  for (let nummer = 0; nummer < anzahl; nummer += 1) antworten.push(await initPost(baseUrl, anfrage));
  return antworten;
}

const statusFolge = (antworten) => antworten.map((antwort) => antwort.status);
const gleicheStatus = (anzahl, status) => Array.from({ length: anzahl }, () => status);
const bindungsKoerper = (bindung) => JSON.stringify(initBindungsKoerper({ bindung, agentId: AGENT_ID, conversationId: CONV }));

// Genau so viele Fehlversuche, wie das Limit erlaubt - der naechste wird gedrosselt.
const fehlversucheBisZumLimit = (baseUrl, anfrage = {}) =>
  wiederholtePosts(baseUrl, { anzahl: INIT_FEHLVERSUCHE_PRO_MIN, token: FALSCHES_TOKEN, ip: IP_X, ...anfrage });

// Reine Middleware an einer fiktiven Uhr, req/res als protokollierende Attrappen.
function schrankeMitUhr({ zaehler, uhr }) {
  const schranke = initTokenSchranke({ config: schrankenConfig(), zaehler, now: () => uhr.nowMs });
  return function aufrufen() {
    const protokoll = { headers: {}, status: null, body: null, weiter: false };
    const req = { ip: IP_X, get: (name) => (name === INIT_TOKEN_HEADER ? FALSCHES_TOKEN : undefined) };
    const res = {
      set: (name, wert) => Object.assign(protokoll.headers, { [name]: wert }),
      status(code) {
        protokoll.status = code;
        return res;
      },
      json: (body) => Object.assign(protokoll, { body }),
    };
    schranke(req, res, () => Object.assign(protokoll, { weiter: true }));
    return protokoll;
  };
}

const zeilenMit = (zeilen, text) => zeilen.filter((zeile) => zeile === text);
const initZeilen = (text) => text.split("\n").filter((zeile) => zeile.includes(EL_INIT_PRAEFIX));

// ---- In-process: Schranke + Parser + Router ---------------------------------------------------

test("IEX-A7-1: 30 Fehlversuche je IP -> 403, der 31. -> 429 mit konstantem Koerper und Retry-After", async () => {
  await mitSchrankeVorParser({}, async ({ baseUrl }) => {
    const erlaubt = await fehlversucheBisZumLimit(baseUrl);
    const gedrosselt = await initPost(baseUrl, { token: FALSCHES_TOKEN, ip: IP_X });

    assert.deepEqual(statusFolge(erlaubt), gleicheStatus(INIT_FEHLVERSUCHE_PRO_MIN, HTTP_FORBIDDEN));
    for (const antwort of erlaubt) assert.equal(antwort.text, JSON.stringify(INIT_ANTWORT.VERWEIGERT));
    assert.equal(gedrosselt.status, HTTP_TOO_MANY_REQUESTS);
    assert.equal(gedrosselt.text, JSON.stringify(INIT_ANTWORT.GEDROSSELT));
    const sekunden = Number(gedrosselt.retryAfter);
    assert.ok(Number.isInteger(sekunden) && sekunden >= 1 && sekunden <= SEKUNDEN_JE_FENSTER, `Retry-After=${gedrosselt.retryAfter}`);
  });
});

test("IEX-A7-2: Ablehnungen nach gueltigem Token zaehlen nie - 40x404, danach 30 Fehlversuche derselben IP -> alle 403", async () => {
  const { zaehler, aufrufe } = zaehlerSpion();
  await mitSchrankeVorParser({ zaehler }, async ({ baseUrl }) => {
    const gueltige = await wiederholtePosts(baseUrl, {
      anzahl: ABLEHNUNGEN_NACH_GUELTIGEM_TOKEN,
      token: INIT_TOKEN,
      ip: IP_X,
      rohKoerper: bindungsKoerper(FREMDES_BINDUNGS_TOKEN),
    });
    assert.deepEqual(statusFolge(gueltige), gleicheStatus(ABLEHNUNGEN_NACH_GUELTIGEM_TOKEN, HTTP_NOT_FOUND));
    for (const antwort of gueltige) assert.equal(antwort.text, JSON.stringify(INIT_ANTWORT.KEIN_ANRUF));
    assert.equal(aufrufe.anzahl, 0);

    const fehlversuche = await fehlversucheBisZumLimit(baseUrl);
    assert.deepEqual(statusFolge(fehlversuche), gleicheStatus(INIT_FEHLVERSUCHE_PRO_MIN, HTTP_FORBIDDEN));
    assert.equal(aufrufe.anzahl, INIT_FEHLVERSUCHE_PRO_MIN);
  });
});

test("IEX-A7-3: ungueltiges Token wird nie geparst - kaputtes JSON -> 403 bzw. 429, gueltiges Token + kaputtes JSON -> 400", async () => {
  await mitSchrankeVorParser({}, async ({ baseUrl }) => {
    const erlaubt = await fehlversucheBisZumLimit(baseUrl, { rohKoerper: KAPUTTES_JSON });
    const gedrosselt = await initPost(baseUrl, { token: FALSCHES_TOKEN, ip: IP_X, rohKoerper: KAPUTTES_JSON });
    const gueltig = await initPost(baseUrl, { token: INIT_TOKEN, ip: IP_X, rohKoerper: KAPUTTES_JSON });

    assert.deepEqual(statusFolge(erlaubt), gleicheStatus(INIT_FEHLVERSUCHE_PRO_MIN, HTTP_FORBIDDEN));
    assert.equal(gedrosselt.status, HTTP_TOO_MANY_REQUESTS);
    assert.equal(gueltig.status, HTTP_BAD_REQUEST);
  });
});

test("IEX-A7-4: 403 und 429 der Schranke greifen nie auf den Store zu (Positiv-Kontrolle: gueltiges Token liest ihn)", async () => {
  const { store, zaehlung } = zugriffsZaehlenderStore();
  await mitSchrankeVorParser({ store }, async ({ baseUrl }) => {
    await fehlversucheBisZumLimit(baseUrl);
    const gedrosselt = await initPost(baseUrl, { token: FALSCHES_TOKEN, ip: IP_X });
    assert.equal(gedrosselt.status, HTTP_TOO_MANY_REQUESTS);
    assert.equal(zaehlung.zugriffe, 0);

    await initPost(baseUrl, { token: INIT_TOKEN, ip: IP_X, rohKoerper: bindungsKoerper(FREMDES_BINDUNGS_TOKEN) });
    assert.ok(zaehlung.zugriffe > 0, "Positiv-Kontrolle: der Handler liest den Store");
  });
});

test("IEX-A7-5: die Drosselung von IP X laesst IP Y unberuehrt", async () => {
  await mitSchrankeVorParser({}, async ({ baseUrl }) => {
    await fehlversucheBisZumLimit(baseUrl);
    const gedrosseltX = await initPost(baseUrl, { token: FALSCHES_TOKEN, ip: IP_X });
    const ersterVersuchY = await initPost(baseUrl, { token: FALSCHES_TOKEN, ip: IP_Y });

    assert.equal(gedrosseltX.status, HTTP_TOO_MANY_REQUESTS);
    assert.equal(ersterVersuchY.status, HTTP_FORBIDDEN);
  });
});

test("IEX-A7-6: Log ohne IP und Token, gedrosselt genau einmal je Fenster", async () => {
  const zeilen = await captureConsole(() =>
    mitSchrankeVorParser({}, ({ baseUrl }) =>
      wiederholtePosts(baseUrl, { anzahl: INIT_FEHLVERSUCHE_PRO_MIN + DROSSELUNGEN_IM_FENSTER, token: FALSCHES_TOKEN, ip: IP_X }),
    ),
  );

  assert.equal(zeilenMit(zeilen, ZEILE_TOKEN_ABGELEHNT).length, INIT_FEHLVERSUCHE_PRO_MIN);
  assert.equal(zeilenMit(zeilen, ZEILE_ERSTE_DROSSELUNG).length, 1);
  assert.equal(zeilen.filter((zeile) => zeile.includes("gedrosselt")).length, 1);
  for (const verboten of [IP_X, INIT_TOKEN, FALSCHES_TOKEN])
    assert.ok(!zeilen.some((zeile) => zeile.includes(verboten)), `Log enthaelt ${verboten}`);
});

test("IEX-A7-7: Fensterlogik der Drossel-Zeile an der injizierten Uhr (Grenze windowMs-1 / windowMs)", async () => {
  const uhr = { nowMs: UHR_START_MS };
  const stelleUhr = (versatzMs) => Object.assign(uhr, { nowMs: UHR_START_MS + versatzMs });
  const aufrufen = schrankeMitUhr({ zaehler: () => ({ allowed: false, retryAfterS: RETRY_AFTER_ATTRAPPE_S }), uhr });

  const zeilen = await captureConsole(() => {
    const erster = aufrufen();
    assert.equal(erster.status, HTTP_TOO_MANY_REQUESTS);
    assert.equal(erster.headers["Retry-After"], String(RETRY_AFTER_ATTRAPPE_S));
    assert.equal(erster.body, INIT_ANTWORT.GEDROSSELT);
    assert.equal(erster.weiter, false);
  });
  assert.deepEqual(zeilen, [ZEILE_ERSTE_DROSSELUNG]);

  const imFenster = await captureConsole(() => {
    for (const versatzMs of VERSAETZE_IM_FENSTER_MS) {
      stelleUhr(versatzMs);
      aufrufen();
    }
  });
  assert.deepEqual(imFenster, []);

  const ab = await captureConsole(() => {
    stelleUhr(RATE_WINDOW_MS);
    aufrufen();
  });
  const seitLetzterZeile = VERSAETZE_IM_FENSTER_MS.length + 1;
  assert.deepEqual(ab, [`[el-init] gedrosselt anzahl=${seitLetzterZeile}`]);
});

test("IEX-A7-8: Pfadvarianten erreichen weder Schranke noch Handler, die exakte Form beide", async () => {
  const varianten = [`${ELEVENLABS_INIT_PATH}/`, ELEVENLABS_INIT_PATH.toUpperCase(), "/Webhooks/ElevenLabs/Init"];
  const { store, zaehlung } = zugriffsZaehlenderStore();
  await mitSchrankeVorParser({ store }, async ({ baseUrl }) => {
    const zeilen = await captureConsole(async () => {
      for (const pfad of varianten) {
        const ohneSchranke = await initPost(baseUrl, { pfad, token: FALSCHES_TOKEN, ip: IP_X, rohKoerper: KAPUTTES_JSON });
        assert.equal(ohneSchranke.status, HTTP_BAD_REQUEST, `${pfad}: Parser lief, also keine Schranke`);
        const ohneHandler = await initPost(baseUrl, { pfad, token: INIT_TOKEN, ip: IP_X, rohKoerper: bindungsKoerper(FREMDES_BINDUNGS_TOKEN) });
        assert.equal(ohneHandler.status, HTTP_NOT_FOUND, pfad);
      }
    });
    assert.equal(zaehlung.zugriffe, 0);
    assert.deepEqual(zeilen.filter((zeile) => zeile.startsWith(EL_INIT_PRAEFIX)), []);

    const kontrolle = await captureConsole(() =>
      initPost(baseUrl, { token: INIT_TOKEN, ip: IP_X, rohKoerper: bindungsKoerper(FREMDES_BINDUNGS_TOKEN) }),
    );
    assert.ok(kontrolle.some((zeile) => zeile.includes("grund=kein_wartender_anruf")), kontrolle.join("\n"));
    assert.ok(zaehlung.zugriffe > 0);
  });
});

// ---- Verdrahtung am echten Server (app.js) ----------------------------------------------------

async function mitSpawnServer(env, run) {
  const srv = await startServer({
    env: { ...elInboundInitSpawnEnv(AGENT_ID), ...env },
    seed: spawnSeedWartenderElCall({ callId: SPAWN_CALL_ID, bindungsToken: SPAWN_BINDUNGS_TOKEN, answeredVorS: FRISCH_BEANTWORTET_S }),
  });
  try {
    await run({ srv, baseUrl: srv.localUrl });
  } finally {
    await srv.stop();
  }
}

const spawnCall = (zustand) => zustand.calls.find((eintrag) => eintrag.id === SPAWN_CALL_ID);
const istGebunden = (zustand) => spawnCall(zustand)?.elevenlabsConversationId === CONV;

async function getVonIp(baseUrl, ip) {
  const res = await fetch(`${baseUrl}${ELEVENLABS_INIT_PATH}`, { headers: { "x-forwarded-for": ip } });
  await res.text();
  return res.status;
}

test("IEX-A7-9: am echten Server (app.js) - Schranke vor den Parsern und ausserhalb des globalen Limiters, die gedrosselte IP bindet trotzdem", async () => {
  await mitSpawnServer({ RATE_LIMIT_PER_MIN: String(GLOBALES_TESTLIMIT) }, async ({ srv, baseUrl }) => {
    const gueltige = await wiederholtePosts(baseUrl, { anzahl: GUELTIGE_ANFRAGEN_UEBER_LIMIT, token: SPAWN_INIT_TOKEN, ip: IP_X });
    assert.deepEqual(statusFolge(gueltige), gleicheStatus(GUELTIGE_ANFRAGEN_UEBER_LIMIT, HTTP_NOT_FOUND));

    const fehlversuche = await fehlversucheBisZumLimit(baseUrl, { rohKoerper: KAPUTTES_JSON });
    assert.deepEqual(statusFolge(fehlversuche), gleicheStatus(INIT_FEHLVERSUCHE_PRO_MIN, HTTP_FORBIDDEN));
    const gedrosselt = await initPost(baseUrl, { token: FALSCHES_TOKEN, ip: IP_X });
    assert.equal(gedrosselt.status, HTTP_TOO_MANY_REQUESTS);

    const bindung = await initPost(baseUrl, { token: SPAWN_INIT_TOKEN, ip: IP_X, rohKoerper: bindungsKoerper(SPAWN_BINDUNGS_TOKEN) });
    assert.equal(bindung.status, HTTP_OK, bindung.text);
    assert.ok(istGebunden(await waitForStoreState(srv, istGebunden)));

    const getStatus = [];
    for (let nummer = 0; nummer <= GLOBALES_TESTLIMIT; nummer += 1) getStatus.push(await getVonIp(baseUrl, IP_X));
    assert.ok(getStatus.slice(0, GLOBALES_TESTLIMIT).every((status) => status !== HTTP_TOO_MANY_REQUESTS), getStatus.join(","));
    assert.equal(getStatus.at(-1), HTTP_TOO_MANY_REQUESTS, "Positiv-Kontrolle: der globale Limiter zaehlt GET");

    const zeilen = initZeilen(srv.stdout);
    assert.equal(zeilenMit(zeilen, ZEILE_ERSTE_DROSSELUNG).length, 1, zeilen.join("\n"));
    for (const verboten of [IP_X, SPAWN_INIT_TOKEN, FALSCHES_TOKEN, SPAWN_BINDUNGS_TOKEN])
      assert.ok(!zeilen.some((zeile) => zeile.includes(verboten)), `Log enthaelt ${verboten}`);
  });
});

test("IEX-A7-10: am echten Server erreicht die Pfadvariante den Handler nicht, die exakte Form bindet", async () => {
  await mitSpawnServer({}, async ({ srv, baseUrl }) => {
    const variante = await initPost(baseUrl, {
      pfad: `${ELEVENLABS_INIT_PATH}/`,
      token: SPAWN_INIT_TOKEN,
      rohKoerper: bindungsKoerper(SPAWN_BINDUNGS_TOKEN),
    });
    assert.notEqual(variante.status, HTTP_OK, variante.text);
    assert.equal(istGebunden(srv.readStore()), false);
    assert.deepEqual(initZeilen(srv.stdout), []);

    const exakt = await initPost(baseUrl, { token: SPAWN_INIT_TOKEN, rohKoerper: bindungsKoerper(SPAWN_BINDUNGS_TOKEN) });
    assert.equal(exakt.status, HTTP_OK, exakt.text);
    assert.ok(istGebunden(await waitForStoreState(srv, istGebunden)));
  });
});
