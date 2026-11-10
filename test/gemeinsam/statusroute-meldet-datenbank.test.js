import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { neuePglite } from "../pglite-helfer.js";
import { poolAufPglite } from "../abrechnung/server-mit-testdatenbank.js";
import {
  STATUS_PATH,
  ANRUFE_LAUFEND_PATH,
  ANRUFPAUSE_PATH,
  HTTP_OK,
  HTTP_UNAUTHORIZED,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_SERVICE_UNAVAILABLE,
  SCHLUESSEL,
  DEPLOY_TOKEN,
  FALSCHER_SCHLUESSEL,
  ZU_KURZ,
  COMMIT,
  STANDARD_FRIST_MS,
  FRIST_UNSCHAERFE_MS,
  ABRUFE_PRO_MINUTE,
  MEHRERE_ABRUFE,
  FEHLERDETAIL,
  KEIN_ZWISCHENSPEICHER,
  konfiguration,
  bearer,
  abrufen,
  abrufeNacheinander,
  mitStatusroute as mitStatusrouteMit,
  mitApp as mitAppMit,
  mitProtokoll,
  stumm,
  abgelehnteAuditZeilen,
  pruefeAbgelehnt,
} from "./statusroute-hilfe.mjs";
import { oeffneSpeicherAn } from "./speicher-oeffnen.js";

const pools = poolAufPglite(await neuePglite());
process.env.STORE_BACKEND = "pg";
process.env.DATABASE_URL = "postgres://attrappe.invalid/hermes";
const DATENORDNER = fs.mkdtempSync(path.join(os.tmpdir(), "statusroute-"));
const { config } = await import("../../src/config.js");
Object.assign(config.server, {
  dataDir: DATENORDNER,
  webDistDir: path.join(DATENORDNER, "web"),
  deployedCommit: COMMIT,
});
Object.assign(config.auth, {
  deployToken: DEPLOY_TOKEN,
  statusToken: SCHLUESSEL,
  sessionSecret: "",
});
const speicher = await import("../../src/store.js").then(oeffneSpeicherAn);
const { buildApp } = await import("../../src/app.js");
const [pool] = pools;

after(() => fs.rmSync(DATENORDNER, { recursive: true, force: true }));

const echteVerbindung = pool.connect.bind(pool);
const datenbank = { verbindungen: 0, verhalten: echteVerbindung };
pool.connect = () => {
  datenbank.verbindungen += 1;
  return datenbank.verhalten();
};

const lehntAb = () => Promise.reject(new Error(FEHLERDETAIL));
const haengt = () => new Promise(() => {});

function datenbankStellen(verhalten = echteVerbindung) {
  Object.assign(datenbank, { verbindungen: 0, verhalten });
}

async function mitStatusroute(einstellung, aufruf) {
  const { makeInternStatusRoutes } = await import("../../src/routes/intern-status.js");
  return mitStatusrouteMit({ speicher, makeInternStatusRoutes }, einstellung, aufruf);
}

async function mitApp(t, aufruf, statusToken = SCHLUESSEL) {
  config.auth.statusToken = statusToken;
  t.after(() => {
    config.auth.statusToken = SCHLUESSEL;
  });
  return mitAppMit({ config, speicher, buildApp }, aufruf);
}

function pruefeZustand(antwort, status, datenbankAntwortet) {
  assert.equal(antwort.status, status);
  assert.equal(antwort.kopf, KEIN_ZWISCHENSPEICHER);
  assert.deepEqual(JSON.parse(antwort.text), {
    datenbank: datenbankAntwortet,
    flush: true,
    commit: COMMIT,
  });
  assert.equal(antwort.text.includes(FEHLERDETAIL), false);
}

test("Statusroute: Datenbank antwortet -> 200 mit datenbank true und commit, no-store", async () => {
  datenbankStellen();
  const { ergebnis } = await mitStatusroute({}, (basis) => abrufen(basis));
  pruefeZustand(ergebnis, HTTP_OK, true);
  assert.equal(datenbank.verbindungen, 1);
});

test("Statusroute: Datenbank lehnt die Verbindung ab -> 503 mit datenbank false, ohne Fehlertext", async () => {
  datenbankStellen(lehntAb);
  const { ergebnis } = await mitStatusroute({}, (basis) => abrufen(basis));
  pruefeZustand(ergebnis, HTTP_SERVICE_UNAVAILABLE, false);
});

test("Statusroute: Datenbank antwortet nicht in der Frist -> 503 mit datenbank false", async () => {
  datenbankStellen(haengt);
  const { ergebnis } = await mitStatusroute({}, (basis) => abrufen(basis));
  pruefeZustand(ergebnis, HTTP_SERVICE_UNAVAILABLE, false);
});

test("Statusroute: ohne Schluessel, falscher Schluessel, Deploy-Token oder ohne Bearer -> 401, Speicher nicht gefragt", async () => {
  datenbankStellen();
  const faelle = [null, bearer(FALSCHER_SCHLUESSEL), bearer(DEPLOY_TOKEN), SCHLUESSEL];
  const { ergebnis, empfangen } = await stumm(() =>
    mitStatusroute({}, (basis) =>
      Promise.all(faelle.map((authorization) => abrufen(basis, { authorization }))),
    ),
  );
  assert.equal("authorization" in ergebnis[0].gesendet, false);
  assert.equal(empfangen.includes(undefined), true);
  for (const antwort of ergebnis) pruefeAbgelehnt(antwort);
  assert.equal(datenbank.verbindungen, 0);
});

test("Statusroute: statusToken leer, zu kurz oder fehlend -> jeder Abruf 401, Speicher nicht gefragt", async () => {
  for (const statusToken of ["", ZU_KURZ, null]) {
    datenbankStellen();
    const { ergebnis } = await stumm(() =>
      mitStatusroute({ config: konfiguration(statusToken) }, (basis) =>
        abrufen(basis, { authorization: bearer(statusToken) }),
      ),
    );
    pruefeAbgelehnt(ergebnis);
    assert.equal(datenbank.verbindungen, 0);
  }
});

test("Statusroute: abgelehnter Abruf steht als auth_failed mit Grund status_token im Protokoll, ohne den Schluessel", async () => {
  datenbankStellen();
  const { zeilen } = await mitProtokoll(() =>
    mitStatusroute({}, (basis) => abrufen(basis, { authorization: bearer(FALSCHER_SCHLUESSEL) })),
  );
  assert.equal(abgelehnteAuditZeilen(zeilen, STATUS_PATH, "status_token").length, 1);
  assert.equal(
    zeilen.some((zeile) => zeile.includes(SCHLUESSEL) || zeile.includes(FALSCHER_SCHLUESSEL)),
    false,
  );
});

test("Statusroute: haengende Datenbankprobe wird geteilt, nicht je Abruf neu gestartet", async () => {
  datenbankStellen(haengt);
  const { ergebnis } = await mitStatusroute({}, (basis) =>
    abrufeNacheinander(basis, MEHRERE_ABRUFE),
  );
  assert.deepEqual(
    ergebnis.map(({ status }) => status),
    Array(MEHRERE_ABRUFE).fill(HTTP_SERVICE_UNAVAILABLE),
  );
  assert.equal(datenbank.verbindungen, 1);
});

test("Statusroute: nach gescheiterter Probe startet der naechste Abruf eine neue", async () => {
  datenbankStellen(() => (datenbank.verbindungen === 1 ? lehntAb() : echteVerbindung()));
  const { ergebnis } = await mitStatusroute({}, (basis) => abrufeNacheinander(basis, 2));
  assert.deepEqual(
    ergebnis.map(({ status }) => status),
    [HTTP_SERVICE_UNAVAILABLE, HTTP_OK],
  );
  assert.equal(datenbank.verbindungen, 2);
});

test("Statusroute: ohne Angabe gilt die Frist 2000 ms, und ihr Zeitgeber wird nach der Antwort abgeraeumt", async (t) => {
  datenbankStellen();
  const setzer = t.mock.method(globalThis, "setTimeout");
  const loescher = t.mock.method(globalThis, "clearTimeout");
  const { ergebnis } = await mitStatusroute(
    { routenOptionen: { datenbankFristMs: undefined } },
    (basis) => abrufen(basis),
  );
  assert.equal(ergebnis.status, HTTP_OK);
  const fristZeitgeber = [];
  for (const { arguments: argumente, result } of setzer.mock.calls) {
    if (argumente[1] === STANDARD_FRIST_MS) fristZeitgeber.push(result);
  }
  assert.equal(fristZeitgeber.length, 1);
  const abgeraeumt = loescher.mock.calls.map((aufruf) => aufruf.arguments[0]);
  assert.equal(abgeraeumt.includes(fristZeitgeber[0]), true);
});

test("Statusroute: scheitert das Zusammenstellen der Antwort, kommt 500 statt eines haengenden Abrufs", async () => {
  datenbankStellen();
  const kaputteKonfiguration = {
    auth: { statusToken: SCHLUESSEL },
    server: {
      get deployedCommit() {
        throw new Error(FEHLERDETAIL);
      },
    },
  };
  const { ergebnis } = await stumm(() =>
    mitStatusroute({ config: kaputteKonfiguration }, (basis) => abrufen(basis)),
  );
  assert.equal(ergebnis.status, HTTP_INTERNAL_SERVER_ERROR);
});

test("Statusroute: bis zur Grenze je Minute antwortet die Route wie sonst, der Abruf darueber bekommt 429", async () => {
  datenbankStellen();
  const { ergebnis } = await mitStatusroute({}, (basis) =>
    abrufeNacheinander(basis, ABRUFE_PRO_MINUTE + 1),
  );
  const innerhalb = ergebnis.slice(0, ABRUFE_PRO_MINUTE).map(({ status }) => status);
  assert.deepEqual(new Set(innerhalb), new Set([HTTP_OK]));
  assert.equal(ergebnis[ABRUFE_PRO_MINUTE].status, HTTP_TOO_MANY_REQUESTS);
  assert.equal(datenbank.verbindungen, ABRUFE_PRO_MINUTE);
});

test("Statusroute: auch Abrufe mit falschem Schluessel zaehlen, der Abruf darueber bekommt 429 statt 401", async () => {
  datenbankStellen();
  const falsch = { authorization: bearer(FALSCHER_SCHLUESSEL) };
  const { ergebnis } = await stumm(() =>
    mitStatusroute({}, (basis) => abrufeNacheinander(basis, ABRUFE_PRO_MINUTE + 1, falsch)),
  );
  const innerhalb = ergebnis.slice(0, ABRUFE_PRO_MINUTE).map(({ status }) => status);
  assert.deepEqual(new Set(innerhalb), new Set([HTTP_UNAUTHORIZED]));
  assert.equal(ergebnis[ABRUFE_PRO_MINUTE].status, HTTP_TOO_MANY_REQUESTS);
  assert.equal(datenbank.verbindungen, 0);
});

test("[NIE1] ohne Schluessel oder mit falschem Schluessel antwortet /intern/status in der App 401 mit Audit, ohne den Speicher zu fragen", async (t) => {
  datenbankStellen();
  const faelle = [null, bearer(FALSCHER_SCHLUESSEL), SCHLUESSEL];
  const { ergebnis, zeilen } = await mitProtokoll(() =>
    mitApp(t, async (basis) => {
      const antworten = [];
      for (const authorization of faelle) antworten.push(await abrufen(basis, { authorization }));
      return antworten;
    }),
  );
  assert.equal("authorization" in ergebnis[0].gesendet, false);
  for (const antwort of ergebnis) pruefeAbgelehnt(antwort);
  assert.equal(abgelehnteAuditZeilen(zeilen, STATUS_PATH, "status_token").length, faelle.length);
  assert.equal(datenbank.verbindungen, 0);
});

test("[NIE1] mit leerem oder zu kurzem statusToken antwortet /intern/status in der App jedem Abruf 401 mit Audit, ohne den Speicher zu fragen", async (t) => {
  for (const statusToken of ["", ZU_KURZ]) {
    datenbankStellen();
    const { ergebnis, zeilen } = await mitProtokoll(() =>
      mitApp(t, (basis) => abrufen(basis, { authorization: bearer(statusToken) }), statusToken),
    );
    pruefeAbgelehnt(ergebnis);
    assert.equal(abgelehnteAuditZeilen(zeilen, STATUS_PATH, "status_token").length, 1);
    assert.equal(datenbank.verbindungen, 0);
  }
});

test("[NIE2] mit gueltigem Schluessel meldet /intern/status in der App 200 bei antwortender und 503 bei ablehnender Datenbank, nie mit Fehlertext", async (t) => {
  datenbankStellen();
  pruefeZustand(await mitApp(t, (basis) => abrufen(basis)), HTTP_OK, true);
  datenbankStellen(lehntAb);
  pruefeZustand(
    await stumm(() => mitApp(t, (basis) => abrufen(basis))),
    HTTP_SERVICE_UNAVAILABLE,
    false,
  );
});

test("[NIE3] der Deploy-Token oeffnet /intern/status in der App nicht", async (t) => {
  datenbankStellen();
  const { ergebnis, zeilen } = await mitProtokoll(() =>
    mitApp(t, (basis) => abrufen(basis, { authorization: bearer(DEPLOY_TOKEN) })),
  );
  pruefeAbgelehnt(ergebnis);
  assert.equal(abgelehnteAuditZeilen(zeilen, STATUS_PATH, "status_token").length, 1);
  assert.equal(datenbank.verbindungen, 0);
});

test("[NIE3] der Status-Schluessel oeffnet /intern/anrufe-laufend nicht, der Deploy-Token unveraendert", async (t) => {
  datenbankStellen();
  const { ergebnis, zeilen } = await mitProtokoll(() =>
    mitApp(t, async (basis) => [
      await abrufen(basis, { pfad: ANRUFE_LAUFEND_PATH }),
      await abrufen(basis, { pfad: ANRUFE_LAUFEND_PATH, authorization: bearer(DEPLOY_TOKEN) }),
    ]),
  );
  const [mitStatusSchluessel, mitDeployToken] = ergebnis;
  pruefeAbgelehnt(mitStatusSchluessel);
  assert.equal(abgelehnteAuditZeilen(zeilen, ANRUFE_LAUFEND_PATH, "deploy_token").length, 1);
  assert.equal(mitDeployToken.status, HTTP_OK);
  assert.equal(mitDeployToken.kopf, KEIN_ZWISCHENSPEICHER);
  assert.deepEqual(JSON.parse(mitDeployToken.text), { laufend: 0 });
});

test("[NIE4] mehr als 30 Abrufe je Minute bekommen in der App 429, auch mit gueltigem Schluessel", async (t) => {
  datenbankStellen();
  const antworten = await mitApp(t, (basis) => abrufeNacheinander(basis, ABRUFE_PRO_MINUTE + 1));
  const innerhalb = antworten.slice(0, ABRUFE_PRO_MINUTE).map(({ status }) => status);
  assert.deepEqual(new Set(innerhalb), new Set([HTTP_OK]));
  assert.equal(antworten[ABRUFE_PRO_MINUTE].status, HTTP_TOO_MANY_REQUESTS);
});

test("[NIE5] eine haengende Datenbankprobe belegt in der App hoechstens eine Verbindung, die Antwort kommt nach 2000 ms als 503", async (t) => {
  datenbankStellen(haengt);
  const beginn = performance.now();
  const antworten = await mitApp(t, (basis) =>
    Promise.all(Array.from({ length: MEHRERE_ABRUFE }, () => abrufen(basis))),
  );
  const dauer = performance.now() - beginn;
  for (const antwort of antworten) pruefeZustand(antwort, HTTP_SERVICE_UNAVAILABLE, false);
  assert.equal(datenbank.verbindungen, 1);
  assert.ok(dauer >= STANDARD_FRIST_MS - FRIST_UNSCHAERFE_MS, `Antwort nach ${dauer} ms`);
});

test("[NIE6] der Status-Schluessel oeffnet /intern/anrufpause weder lesend noch schreibend, der Deploy-Token unveraendert", async (t) => {
  datenbankStellen();
  const deploy = bearer(DEPLOY_TOKEN);
  const { ergebnis, zeilen } = await mitProtokoll(() =>
    mitApp(t, async (basis) => ({
      statusLesen: await abrufen(basis, { pfad: ANRUFPAUSE_PATH }),
      statusSchreiben: await abrufen(basis, { pfad: ANRUFPAUSE_PATH, koerper: { an: true } }),
      pauseNachStatusSchluessel: speicher.anrufpauseAktiv(),
      deployLesen: await abrufen(basis, { pfad: ANRUFPAUSE_PATH, authorization: deploy }),
      deploySchreiben: await abrufen(basis, {
        pfad: ANRUFPAUSE_PATH,
        authorization: deploy,
        koerper: { an: true },
      }),
      pauseNachDeployToken: speicher.anrufpauseAktiv(),
      zurueck: await abrufen(basis, {
        pfad: ANRUFPAUSE_PATH,
        authorization: deploy,
        koerper: { an: false },
      }),
    })),
  );
  pruefeAbgelehnt(ergebnis.statusLesen);
  pruefeAbgelehnt(ergebnis.statusSchreiben);
  assert.equal(abgelehnteAuditZeilen(zeilen, ANRUFPAUSE_PATH, "deploy_token").length, 2);
  assert.equal(ergebnis.pauseNachStatusSchluessel, false);
  assert.equal(ergebnis.deployLesen.status, HTTP_OK);
  assert.deepEqual(JSON.parse(ergebnis.deployLesen.text), { an: false });
  assert.equal(ergebnis.deploySchreiben.status, HTTP_OK);
  assert.deepEqual(JSON.parse(ergebnis.deploySchreiben.text), { an: true });
  assert.equal(ergebnis.pauseNachDeployToken, true);
  assert.deepEqual(JSON.parse(ergebnis.zurueck.text), { an: false });
});
