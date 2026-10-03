import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { healthzPruefen } from "../../tools/wiederherstellung/hermes.mjs";
import {
  erwartetesSchema,
  pruefenNachDemEnde,
  pruefenVorDemStart,
} from "../../tools/wiederherstellung/pruefungen.mjs";
import { makePgTestStore } from "../pg-helpers.js";
import { werkzeugLaufen } from "../sicherheit/werkzeug-probe.js";
import { isolatedEnvironment } from "./probe-repo.js";

const RENDER = JSON.parse(
  readFileSync(new URL("./wiederherstellung-render.json", import.meta.url), "utf8"),
);
const WERKZEUG = "wiederherstellung.mjs";
const WERKZEUG_PFAD = fileURLToPath(new URL("../../tools/wiederherstellung.mjs", import.meta.url));
const AUSGABE_MODUL = new URL("../../tools/wiederherstellung/ausgabe.mjs", import.meta.url).href;
const PRODUKTION = RENDER.produktion.id;
const KOPIE = RENDER.kopie.id;
const KOPIE_PFAD = "/v1/postgres/" + KOPIE;
const SCHLUESSEL = "rnd_probeschluessel";
const LOKAL = "127.0.0.1";
const HTTP_OK = 200;
const HTTP_KEIN_INHALT = 204;
const HTTP_NICHT_GEFUNDEN = 404;
const HTTP_FEHLER = 500;
const EXIT_OK = 0;
const EXIT_FEHLER = 1;
const KURZER_TAKT = "2";
const SIGNAL_TAKT = "20";
const TAKT_IM_PROZESS = 2;
const MINUTE_MS = 60000;
const MASKE = "::add-mask::";
const ZWEI_ABRUFE = 2;

function lageBauen(abweichung) {
  return {
    produktion: RENDER.produktion,
    wiederherstellung: [HTTP_OK, RENDER.kopie],
    statusFolge: ["recovery_in_progress", "available"],
    verbindungsdaten: RENDER.verbindungsdaten,
    liste: [],
    loeschStatus: HTTP_KEIN_INHALT,
    geloescht: new Set(),
    beobachter: () => {},
    ...abweichung,
  };
}

function naechsterStatus(folge) {
  return folge.length > 1 ? folge.shift() : folge[0];
}

function lesen(lage, id) {
  if (lage.geloescht.has(id)) return [HTTP_NICHT_GEFUNDEN, {}];
  if (id === KOPIE && lage.kopieLesenStatus !== undefined) return [lage.kopieLesenStatus, {}];
  if (id === PRODUKTION) return [HTTP_OK, lage.produktion];
  if (id === KOPIE)
    return [HTTP_OK, { ...RENDER.kopie, status: naechsterStatus(lage.statusFolge) }];
  const eintrag = lage.liste.find((datenbank) => datenbank.id === id);
  return eintrag === undefined ? [HTTP_NICHT_GEFUNDEN, {}] : [HTTP_OK, eintrag];
}

function loeschen(lage, id) {
  if (lage.loeschStatus === HTTP_KEIN_INHALT) lage.geloescht.add(id);
  return [lage.loeschStatus, null];
}

function routen(lage) {
  return [
    ["GET", /^\/v1\/postgres\/[^/?]+\/recovery$/, () => [HTTP_OK, RENDER.rueckblick]],
    ["POST", /^\/v1\/postgres\/[^/?]+\/recovery$/, () => lage.wiederherstellung],
    ["GET", /^\/v1\/postgres\/[^/?]+\/connection-info$/, () => [HTTP_OK, lage.verbindungsdaten]],
    [
      "GET",
      /^\/v1\/postgres\?/,
      () => [HTTP_OK, lage.liste.map((postgres, nr) => ({ cursor: "c" + nr, postgres }))],
    ],
    [
      "PATCH",
      /^\/v1\/postgres\/[^/?]+$/,
      (_treffer, koerper) => [HTTP_OK, { ...RENDER.kopie, ipAllowList: koerper.ipAllowList }],
    ],
    ["DELETE", /^\/v1\/postgres\/([^/?]+)$/, ([, id]) => loeschen(lage, id)],
    ["GET", /^\/v1\/postgres\/([^/?]+)$/, ([, id]) => lesen(lage, id)],
    ["GET", /^\/ip$/, () => [HTTP_OK, RENDER.runnerAdresse]],
  ];
}

function renderAntwort(lage) {
  return ({ methode, pfad, koerper }) => {
    lage.beobachter({ methode, pfad });
    for (const [art, muster, antwort] of routen(lage)) {
      const treffer = muster.exec(pfad);
      if (art === methode && treffer !== null) return antwort(treffer, koerper);
    }
    return [HTTP_NICHT_GEFUNDEN, {}];
  };
}

function senden(antwort, [status, inhalt]) {
  if (inhalt === null) {
    antwort.writeHead(status).end();
    return;
  }
  const text = typeof inhalt === "string" ? inhalt : JSON.stringify(inhalt);
  const art = typeof inhalt === "string" ? "text/plain" : "application/json";
  antwort.writeHead(status, { "content-type": art }).end(text);
}

async function attrappe(kontext, beantworten) {
  const anfragen = [];
  const server = createServer((anfrage, antwort) => {
    const teile = [];
    anfrage.on("data", (teil) => teile.push(teil));
    anfrage.on("end", () => {
      const roh = Buffer.concat(teile).toString("utf8");
      const eintrag = {
        methode: anfrage.method,
        pfad: anfrage.url,
        kopf: anfrage.headers.authorization ?? "",
        koerper: roh === "" ? null : JSON.parse(roh),
      };
      anfragen.push(eintrag);
      senden(antwort, beantworten(eintrag));
    });
  });
  server.listen(0, LOKAL);
  await once(server, "listening");
  kontext.after(() => server.close());
  return { basis: "http://" + LOKAL + ":" + server.address().port, anfragen };
}

function renderAttrappe(kontext, abweichung = {}) {
  return attrappe(kontext, renderAntwort(lageBauen(abweichung)));
}

function umgebung(basis, mehr = {}) {
  return {
    RENDER_API_KEY: SCHLUESSEL,
    RENDER_POSTGRES_ID: PRODUKTION,
    RENDER_WIEDERHERSTELLUNG_UMGEBUNG: RENDER.kopie.environmentId,
    GITHUB_RUN_ID: "4711",
    GITHUB_RUN_ATTEMPT: "1",
    RENDER_API_URL: basis + "/v1",
    WIEDERHERSTELLUNG_IP_URL: basis + "/ip",
    WIEDERHERSTELLUNG_TAKT_MS: KURZER_TAKT,
    ...mehr,
  };
}

function lauf(befehl, render, mehr) {
  return werkzeugLaufen(WERKZEUG, [befehl], { env: umgebung(render.basis, mehr) });
}

function anfragenMit(render, methode) {
  return render.anfragen.filter((anfrage) => anfrage.methode === methode).map(({ pfad }) => pfad);
}

async function geschlossenerPort() {
  const server = createServer();
  server.listen(0, LOKAL);
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

test("R1 Wiederherstellung meldet recovery_failed: Exit 1, die Kopie ist trotzdem gelöscht", async (kontext) => {
  const render = await renderAttrappe(kontext, {
    statusFolge: ["recovery_in_progress", "recovery_failed"],
  });
  const ergebnis = await lauf("pruefen", render);
  assert.equal(ergebnis.status, EXIT_FEHLER);
  assert.match(ergebnis.ausgabe, /Wiederherstellung gescheitert/);
  assert.deepEqual(anfragenMit(render, "DELETE"), [KOPIE_PFAD]);
  assert.match(ergebnis.ausgabe, /Kopie gelöscht und Löschung bestätigt: ja/);
  assert.deepEqual(anfragenMit(render, "PATCH"), []);
  assert.match(ergebnis.ausgabe, /Ergebnis: nein/);
});

test("R2 Wiederherstellung antwortet mit 500: Exit 1 und keine Löschanfrage", async (kontext) => {
  const render = await renderAttrappe(kontext, { wiederherstellung: [HTTP_FEHLER, {}] });
  const ergebnis = await lauf("pruefen", render);
  assert.equal(ergebnis.status, EXIT_FEHLER);
  assert.match(ergebnis.ausgabe, /Abbruch im Schritt wiederherstellen: HTTP 500/);
  assert.deepEqual(anfragenMit(render, "DELETE"), []);
  assert.deepEqual(anfragenMit(render, "PATCH"), []);
});

async function aufraeumenScheitert(kontext, abweichung) {
  const render = await renderAttrappe(kontext, {
    liste: [RENDER.produktion, RENDER.kopie],
    ...abweichung,
  });
  const ergebnis = await lauf("aufraeumen", render);
  assert.equal(ergebnis.status, EXIT_FEHLER);
  assert.match(ergebnis.ausgabe, /Löschen gescheitert: HTTP 500/);
  assert.match(ergebnis.ausgabe, /0 eigene Kopien gelöscht, 1 fremde nicht angefasst, 1 Fehler/);
  return anfragenMit(render, "DELETE");
}

test("R3 Löschen scheitert mit 500: aufraeumen endet mit Exit 1", async (kontext) => {
  const loeschungen = await aufraeumenScheitert(kontext, { loeschStatus: HTTP_FEHLER });
  assert.deepEqual(loeschungen, [KOPIE_PFAD]);
});

test("R3b Scheitert das Nachlesen einer eigenen Kopie, zählt aufraeumen sie als Fehler und endet mit Exit 1", async (kontext) => {
  const loeschungen = await aufraeumenScheitert(kontext, { kopieLesenStatus: HTTP_FEHLER });
  assert.deepEqual(loeschungen, []);
});

test("R4 Fremde Datenbanken werden nie gelöscht, auch wenn die Antwort die Produktion nennt", async (kontext) => {
  const render = await renderAttrappe(kontext, {
    wiederherstellung: [HTTP_OK, RENDER.produktion],
    liste: [RENDER.produktion, RENDER.fremdMitPassendemNamen, RENDER.fremdImKopienEnvironment],
  });
  const ergebnis = await lauf("pruefen", render);
  assert.equal(ergebnis.status, EXIT_FEHLER);
  assert.match(ergebnis.ausgabe, /Löschen verweigert: keine eigene Kopie/);
  assert.deepEqual(anfragenMit(render, "DELETE"), []);
  assert.deepEqual(anfragenMit(render, "PATCH"), []);
  assert.equal(
    anfragenMit(render, "GET").filter((pfad) => pfad.startsWith("/v1/postgres?")).length,
    1,
  );
});

test("R5 Produktion im Environment der Kopien: Abbruch vor jeder Wiederherstellung und jedem Löschen", async (kontext) => {
  const produktion = { ...RENDER.produktion, environmentId: RENDER.kopie.environmentId };
  const render = await renderAttrappe(kontext, { produktion, liste: [RENDER.kopie] });
  for (const befehl of ["pruefen", "aufraeumen"]) {
    const ergebnis = await lauf(befehl, render);
    assert.equal(ergebnis.status, EXIT_FEHLER);
    assert.match(ergebnis.ausgabe, /Produktions-Datenbank liegt im Environment der Kopien/);
  }
  assert.deepEqual(
    render.anfragen.map(({ methode, pfad }) => methode + " " + pfad),
    ["GET /v1/postgres/" + PRODUKTION, "GET /v1/postgres/" + PRODUKTION],
  );
});

test("R6 aufraeumen ohne Verstoß löscht nur die eigene Kopie und endet mit Exit 0", async (kontext) => {
  const render = await renderAttrappe(kontext, {
    liste: [
      RENDER.produktion,
      RENDER.kopie,
      RENDER.fremdMitPassendemNamen,
      RENDER.fremdImKopienEnvironment,
    ],
  });
  const ergebnis = await lauf("aufraeumen", render);
  assert.equal(ergebnis.status, EXIT_OK);
  assert.match(ergebnis.ausgabe, /1 eigene Kopien gelöscht, 3 fremde nicht angefasst, 0 Fehler/);
  assert.deepEqual(anfragenMit(render, "DELETE"), [KOPIE_PFAD]);
  assert.ok(render.anfragen.every(({ kopf }) => kopf === "Bearer " + SCHLUESSEL));
});

test("R7 Ein Wert mit E-Mail aus einer Antwort wird nicht ausgegeben, die Kopie trotzdem gelöscht", async (kontext) => {
  const email = "kunde.probe@example.invalid";
  const render = await renderAttrappe(kontext, { statusFolge: ["recovery_in_progress", email] });
  const ergebnis = await lauf("pruefen", render);
  assert.equal(ergebnis.status, EXIT_FEHLER);
  assert.match(ergebnis.ausgabe, /Ausgabe verweigert/);
  assert.equal(ergebnis.ausgabe.includes("@"), false);
  assert.deepEqual(anfragenMit(render, "DELETE"), [KOPIE_PFAD]);
});

test("R7 Verbindungsdaten und Runner-Adresse erscheinen nur in add-mask-Zeilen", async (kontext) => {
  const adresse = new URL(RENDER.verbindungsdaten.externalConnectionString);
  adresse.hostname = LOKAL;
  adresse.port = String(await geschlossenerPort());
  const verbindungsdaten = { ...RENDER.verbindungsdaten, externalConnectionString: adresse.href };
  const render = await renderAttrappe(kontext, { verbindungsdaten });
  const ergebnis = await lauf("pruefen", render);
  const zeilen = ergebnis.ausgabe.split("\n");
  const geheim = [
    adresse.href,
    RENDER.verbindungsdaten.password,
    adresse.username,
    "kopiedatenbank",
    RENDER.runnerAdresse,
  ];
  assert.equal(ergebnis.status, EXIT_FEHLER);
  assert.match(ergebnis.ausgabe, /Abbruch im Schritt tunnel: ECONNREFUSED/);
  for (const wert of geheim) {
    const treffer = zeilen.filter((zeile) => zeile.includes(wert));
    assert.ok(treffer.length > 0);
    assert.ok(treffer.every((zeile) => zeile.startsWith(MASKE)));
  }
  assert.equal(ergebnis.ausgabe.includes(SCHLUESSEL), false);
  assert.deepEqual(anfragenMit(render, "DELETE"), [KOPIE_PFAD]);
  const zugang = render.anfragen.find(({ methode }) => methode === "PATCH");
  assert.deepEqual(
    zugang.koerper.ipAllowList.map(({ cidrBlock }) => cidrBlock),
    [RENDER.runnerAdresse + "/32"],
  );
});

test("R7 Die zweite Linie hält Zeilen mit E-Mail, Telefonnummer oder Verbindungsadresse zurück", () => {
  const skript = [
    "const { zeileSchreiben } = await import(process.argv[1]);",
    "let verweigert = 0;",
    "const texte = ['Kontakt kunde.probe@example.invalid', 'Rückruf +49 151 999 000 11', 'Ziel postgresql://nutzer@ziel/db'];",
    "for (const text of texte) {",
    "  try { zeileSchreiben(text); } catch (fehler) { if (fehler.name === 'AusgabeVerweigert') verweigert += 1; }",
    "}",
    "process.stdout.write('verweigert=' + verweigert + '\\n');",
  ].join("\n");
  const ergebnis = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", skript, AUSGABE_MODUL],
    { encoding: "utf8", env: isolatedEnvironment() },
  );
  assert.equal(ergebnis.status, EXIT_OK);
  assert.equal(ergebnis.stdout, "verweigert=3\n");
  assert.equal(ergebnis.stderr, "");
});

test("SIGTERM während des Wartens löscht die Kopie und endet mit Exit 1", async (kontext) => {
  let angefragt = null;
  const kopieAngefragt = new Promise((weiter) => {
    angefragt = weiter;
  });
  const render = await renderAttrappe(kontext, {
    statusFolge: ["recovery_in_progress"],
    beobachter: ({ methode, pfad }) => {
      if (methode === "GET" && pfad === KOPIE_PFAD) angefragt();
    },
  });
  const kind = spawn(process.execPath, [WERKZEUG_PFAD, "pruefen"], {
    env: {
      ...isolatedEnvironment(),
      ...umgebung(render.basis, { WIEDERHERSTELLUNG_TAKT_MS: SIGNAL_TAKT }),
    },
  });
  const ausgabe = [];
  kind.stdout.on("data", (teil) => ausgabe.push(teil));
  await kopieAngefragt;
  kind.kill("SIGTERM");
  const [code] = await once(kind, "close");
  assert.equal(code, EXIT_FEHLER);
  assert.match(Buffer.concat(ausgabe).toString("utf8"), /Signal empfangen/);
  assert.deepEqual(anfragenMit(render, "DELETE"), [KOPIE_PFAD]);
});

let schemaVersprechen = null;
function erwartet() {
  schemaVersprechen ??= erwartetesSchema();
  return schemaVersprechen;
}

async function kopieMitDaten() {
  const { db } = await makePgTestStore();
  await db.query("INSERT INTO account (sub, email, tenant_id, role) VALUES ($1, $2, $3, $4)", [
    "probe-sub",
    "probe.konto@example.invalid",
    "owner",
    "admin",
  ]);
  return db;
}

test("R8 Lesende Prüfungen ohne Verstoß sind grün", async () => {
  const schema = await erwartet();
  const db = await kopieMitDaten();
  const zeitpunkt = Date.now() + MINUTE_MS;
  const vorher = await pruefenVorDemStart(db, { zeitpunkt, erwartet: schema });
  assert.equal(vorher.p1.ok, true);
  assert.equal(vorher.p2.ok, true);
  assert.deepEqual(vorher.p3, { gesamt: schema.size, lesbar: schema.size, nichtLesbar: [] });
  assert.deepEqual(vorher.p4, { fehlend: 0, unbekannt: 0 });
  const nachher = await pruefenNachDemEnde(db, { erwartet: schema, mengenVorher: vorher.mengen });
  assert.equal(nachher.p5.ok, true);
  assert.equal(nachher.p6.ok, true);
});

test("R8 Eine fehlende Tabelle macht P3 und P5 rot", async () => {
  const schema = await erwartet();
  const db = await kopieMitDaten();
  await db.query("DROP TABLE action_item CASCADE");
  const vorher = await pruefenVorDemStart(db, {
    zeitpunkt: Date.now() + MINUTE_MS,
    erwartet: schema,
  });
  assert.deepEqual(vorher.p3.nichtLesbar, ["action_item"]);
  assert.equal(vorher.p3.lesbar, schema.size - 1);
  assert.ok(vorher.p4.fehlend > 0);
  const nachher = await pruefenNachDemEnde(db, { erwartet: schema, mengenVorher: vorher.mengen });
  assert.equal(nachher.p5.ok, false);
});

test("R8 Eine Zeile nach dem Wiederherstellungszeitpunkt macht P1 rot", async () => {
  const schema = await erwartet();
  const db = await kopieMitDaten();
  const zeitpunkt = Date.now() + MINUTE_MS;
  await db.query("INSERT INTO audit_log (at, action) VALUES (now() + interval '1 hour', 'probe')");
  const vorher = await pruefenVorDemStart(db, { zeitpunkt, erwartet: schema });
  assert.equal(vorher.p1.ok, false);
  assert.ok(vorher.p1.abstandMinuten < 0);
  assert.equal(vorher.p2.ok, true);
});

test("R8 Ein nach dem Start verlorenes Konto macht P6 rot", async () => {
  const schema = await erwartet();
  const db = await kopieMitDaten();
  const vorher = await pruefenVorDemStart(db, {
    zeitpunkt: Date.now() + MINUTE_MS,
    erwartet: schema,
  });
  await db.query("DELETE FROM account");
  const nachher = await pruefenNachDemEnde(db, { erwartet: schema, mengenVorher: vorher.mengen });
  assert.equal(nachher.p5.ok, true);
  assert.equal(nachher.p6.ok, false);
});

test("R9 /healthz mit 500 ist rot, mit 200 grün", async (kontext) => {
  const rot = await attrappe(kontext, () => [HTTP_FEHLER, null]);
  assert.equal(await healthzPruefen(rot.basis, { takt: TAKT_IM_PROZESS }), false);
  const gruen = await attrappe(kontext, () => [HTTP_OK, { ok: true }]);
  assert.equal(await healthzPruefen(gruen.basis, { takt: TAKT_IM_PROZESS }), true);
  assert.ok(gruen.anfragen.length >= ZWEI_ABRUFE);
  assert.ok(gruen.anfragen.every(({ pfad }) => pfad === "/healthz"));
});

test("R10 Eine Render-Adresse außerhalb von 127.0.0.1 bricht ohne jede Anfrage ab", async (kontext) => {
  const render = await renderAttrappe(kontext);
  const fremd = render.basis.replace(LOKAL, "localhost");
  const faelle = [{ RENDER_API_URL: fremd + "/v1" }, { WIEDERHERSTELLUNG_IP_URL: fremd + "/ip" }];
  for (const abweichung of faelle) {
    const ergebnis = await lauf("pruefen", render, abweichung);
    assert.equal(ergebnis.status, EXIT_FEHLER);
    assert.match(
      ergebnis.ausgabe,
      /Einstellung fehlt oder ist ungültig: (RENDER_API_URL|WIEDERHERSTELLUNG_IP_URL)/,
    );
  }
  assert.deepEqual(render.anfragen, []);
});

test("Ein fehlender Pflichtwert bricht vor jedem Render-Aufruf ab", async (kontext) => {
  const render = await renderAttrappe(kontext);
  const ergebnis = await lauf("aufraeumen", render, { RENDER_API_KEY: "" });
  assert.equal(ergebnis.status, EXIT_FEHLER);
  assert.match(ergebnis.ausgabe, /Einstellung fehlt oder ist ungültig: RENDER_API_KEY/);
  assert.deepEqual(render.anfragen, []);
});
