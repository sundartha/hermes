import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { neuePglite } from "../pglite-helfer.js";
import { startServer } from "../helpers.js";
import { poolAufPglite } from "../abrechnung/server-mit-testdatenbank.js";
import {
  HTTP_OK,
  HTTP_SERVICE_UNAVAILABLE,
  SCHLUESSEL,
  FALSCHER_SCHLUESSEL,
  COMMIT,
  KEIN_ZWISCHENSPEICHER,
  FEHLERDETAIL,
  bearer,
  abrufen,
  pruefeAbgelehnt,
  mitStatusroute as mitStatusrouteMit,
  stumm,
} from "./statusroute-hilfe.mjs";
import { mitGescheitertemFlush, mitHaengendemFlush } from "./flush-verhalten-hilfe.mjs";
import { oeffneSpeicherAn } from "./speicher-oeffnen.js";

const MELDUNG = "Statusroute meldet flush nicht";

const db = await neuePglite();
const pools = poolAufPglite(db, { exklusiv: false });
process.env.STORE_BACKEND = "pg";
process.env.DATABASE_URL = "postgres://attrappe.invalid/hermes";
const DATENORDNER = fs.mkdtempSync(path.join(os.tmpdir(), "statusroute-flush-"));
const { config } = await import("../../src/config.js");
Object.assign(config.server, { dataDir: DATENORDNER, deployedCommit: COMMIT });
Object.assign(config.auth, { statusToken: SCHLUESSEL });
const speicher = await import("../../src/store.js").then(oeffneSpeicherAn);
const [pool] = pools;

const jsonServer = await startServer({
  env: { HERMES_STATUS_TOKEN: SCHLUESSEL, RENDER_GIT_COMMIT: COMMIT },
});

after(async () => {
  await jsonServer.stop();
  fs.rmSync(DATENORDNER, { recursive: true, force: true });
});

const echteVerbindung = pool.connect.bind(pool);
const verbindungen = { anzahl: 0 };
pool.connect = () => {
  verbindungen.anzahl += 1;
  return echteVerbindung();
};

async function mitStatusroute(speicherFuerRoute, aufruf = (basis) => abrufen(basis)) {
  const { makeInternStatusRoutes } = await import("../../src/routes/intern-status.js");
  const { ergebnis } = await mitStatusrouteMit(
    { speicher: speicherFuerRoute, makeInternStatusRoutes },
    {},
    aufruf,
  );
  return ergebnis;
}

function speicherMit(abweichungen) {
  return new Proxy(speicher, {
    get: (ziel, name) => (name in abweichungen ? abweichungen[name] : ziel[name]),
  });
}

function koerperVon(antwort) {
  return JSON.parse(antwort.text);
}

function pruefeZustand(antwort, status, { datenbank, flush }) {
  assert.equal(antwort.status, status);
  assert.equal(antwort.kopf, KEIN_ZWISCHENSPEICHER);
  assert.equal(koerperVon(antwort).flush, flush, MELDUNG);
  assert.deepEqual(koerperVon(antwort), { datenbank, flush, commit: COMMIT });
  assert.equal(antwort.text.includes(FEHLERDETAIL), false);
}

test("Statusroute: letzter Flush gelungen -> 200 mit flush true", async () => {
  await speicher.drainFlushes();
  const antwort = await mitStatusroute(speicher);
  pruefeZustand(antwort, HTTP_OK, { datenbank: true, flush: true });
});

test("Statusroute: letzter Flush gescheitert -> 503 mit flush false, danach nach gelungenem Flush wieder 200", async () => {
  const antwort = await stumm(() =>
    mitGescheitertemFlush(db, speicher, () => mitStatusroute(speicher)),
  );
  pruefeZustand(antwort, HTTP_SERVICE_UNAVAILABLE, { datenbank: true, flush: false });
  pruefeZustand(await mitStatusroute(speicher), HTTP_OK, { datenbank: true, flush: true });
});

test("Statusroute: haengender Flush -> 503 mit flush false innerhalb der Frist, Datenbankpunkt unberuehrt", async () => {
  const antwort = await mitHaengendemFlush(pool, speicher, () => mitStatusroute(speicher));
  pruefeZustand(antwort, HTTP_SERVICE_UNAVAILABLE, { datenbank: true, flush: false });
});

test("Statusroute: am laufenden Server mit JSON-Speicher 200 mit datenbank true, flush true und commit", async () => {
  const antwort = await abrufen(jsonServer.localUrl);
  pruefeZustand(antwort, HTTP_OK, { datenbank: true, flush: true });
});

test("[NIE1] gelingt die Datenbankprobe, ist aber der letzte Flush gescheitert, antwortet die Route nie 200", async () => {
  const antwort = await stumm(() =>
    mitGescheitertemFlush(db, speicher, () => mitStatusroute(speicher)),
  );
  assert.equal(koerperVon(antwort).datenbank, true);
  assert.notEqual(antwort.status, HTTP_OK);
  assert.equal(antwort.status, HTTP_SERVICE_UNAVAILABLE);
});

test("[NIE2] die Antwort enthaelt nie einen Fehlertext, auch wenn der Flush mit Fehler scheiterte", async () => {
  const antwort = await stumm(() =>
    mitGescheitertemFlush(db, speicher, () => mitStatusroute(speicher)),
  );
  assert.equal(antwort.text.includes(FEHLERDETAIL), false);
  assert.equal(antwort.text.includes(db.constructor.name), false);
  assert.deepEqual(Object.keys(koerperVon(antwort)).sort(), ["commit", "datenbank", "flush"]);
  assert.equal(typeof koerperVon(antwort).flush, "boolean");
  assert.equal(antwort.text.includes("cost_cross_check"), false);
});

test("[NIE3] ohne gueltigen Statusschluessel fragt die Route den Speicher weder nach Verbindung noch nach Flush und antwortet 401", async () => {
  const gefragt = [];
  const beobachtet = speicherMit({
    pruefeVerbindung: (...argumente) => {
      gefragt.push("verbindung");
      return speicher.pruefeVerbindung(...argumente);
    },
    letzterFlushGelungen: () => {
      gefragt.push("flush");
      return speicher.letzterFlushGelungen();
    },
  });
  verbindungen.anzahl = 0;
  const faelle = [null, bearer(FALSCHER_SCHLUESSEL), SCHLUESSEL];
  const antworten = await stumm(() =>
    mitStatusroute(beobachtet, async (basis) => {
      const gesammelt = [];
      for (const authorization of faelle) gesammelt.push(await abrufen(basis, { authorization }));
      return gesammelt;
    }),
  );
  for (const antwort of antworten) pruefeAbgelehnt(antwort);
  assert.deepEqual(gefragt, []);
  assert.equal(verbindungen.anzahl, 0);
});

test("[NIE4] fehlt dem Speicher letzterFlushGelungen oder wirft sie, antwortet die Route 503 statt 200", async () => {
  const fehlend = await mitStatusroute(speicherMit({ letzterFlushGelungen: undefined }));
  assert.equal(fehlend.status, HTTP_SERVICE_UNAVAILABLE);
  assert.equal(koerperVon(fehlend).flush, false);
  const wirft = await mitStatusroute(
    speicherMit({
      letzterFlushGelungen: () => {
        throw new Error(FEHLERDETAIL);
      },
    }),
  );
  assert.equal(wirft.status, HTTP_SERVICE_UNAVAILABLE);
  assert.equal(koerperVon(wirft).flush, false);
  assert.equal(wirft.text.includes(FEHLERDETAIL), false);
});

test("[NIE5] haengt die Flush-Abfrage, antwortet die Route in der Frist mit 503 und flush false, Datenbankpunkt unberuehrt", async () => {
  const antwort = await mitStatusroute(
    speicherMit({ letzterFlushGelungen: () => new Promise(() => {}) }),
  );
  assert.equal(antwort.status, HTTP_SERVICE_UNAVAILABLE);
  assert.equal(koerperVon(antwort).flush, false);
  assert.equal(koerperVon(antwort).datenbank, true);
});

test("[NIE6] am laufenden Server mit JSON-Speicher antwortet /intern/status mit Schluessel 200 mit datenbank true, flush true und commit", async () => {
  const antwort = await abrufen(jsonServer.localUrl);
  assert.equal(antwort.status, HTTP_OK);
  assert.deepEqual(koerperVon(antwort), { datenbank: true, flush: true, commit: COMMIT });
});
