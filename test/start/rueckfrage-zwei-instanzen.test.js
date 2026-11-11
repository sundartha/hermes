import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import * as speicher from "../../src/store.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mitVerbindung, POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { gemeinsameUmgebung } from "../gemeinsam/zwei-prozesse.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { echtWarten } from "../echt-warten.js";
import { OWNER_TEST_NUMBER, placeCall, seedCall, seedState, startServer } from "../helpers.js";

const ZEITGRENZE_MS = 120_000;
const TAKT_FRIST_MS = 30_000;
const ABFRAGE_TAKT_MS = 200;
const LEBEN_FRIST_S = 30;
const EINMAL = 1;
const HTTP_UPSTREAM_FEHLER = 502;
const KENNUNG = /^.+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RUECKFRAGEN_GESCHLOSSEN = "[boot] verwaiste Rueckfragen geschlossen";
const ANRUF = "call_rueckfrage_zwei";
const ANDERER_ANRUF = "call_rueckfrage_zwei_b";
const MANDANT = seedCall().tenantId;
const ALTE_ZEILE = "alt-host:00000000-0000-4000-8000-000000000001";
const JUNGE_ZEILE = "jung-host:00000000-0000-4000-8000-000000000002";
const FREMD = "fremd-host:00000000-0000-4000-8000-000000000003";
const EIGENE = "eigene-host:00000000-0000-4000-8000-000000000004";
const ANDERE = "andere-host:00000000-0000-4000-8000-000000000005";
const SICHTBARER_HOST = "render-host-nicht-zeigen";
const GEHEIME_KENNUNG = `${SICHTBARER_HOST}:00000000-0000-4000-8000-000000000006`;

const REGEL_TABELLE = [
  { name: "lebender Fremder", besitzer: FREMD, lage: { eigene: EIGENE, lebende: [FREMD, EIGENE] }, erwartet: true },
  { name: "die eigene Kennung", besitzer: EIGENE, lage: { eigene: EIGENE, lebende: [FREMD, EIGENE] }, erwartet: false },
  { name: "Fremder ohne Lebenszeichen", besitzer: FREMD, lage: { eigene: EIGENE, lebende: [ANDERE] }, erwartet: false },
  { name: "kein Besitzer eingetragen", besitzer: null, lage: { eigene: EIGENE, lebende: [FREMD] }, erwartet: false },
  { name: "leerer Besitzer", besitzer: "", lage: { eigene: EIGENE, lebende: [FREMD, ""] }, erwartet: false },
  { name: "Lebenszeichen unlesbar", besitzer: FREMD, lage: { eigene: EIGENE, lebende: null }, erwartet: false },
  { name: "niemand lebt", besitzer: FREMD, lage: { eigene: EIGENE, lebende: [] }, erwartet: false },
];

test("Regel: die Arbeit gehoert nur einem lebenden Fremden, wenn Besitzer, eigene Kennung und Lebende es zeigen", () => {
  for (const { name, besitzer, lage, erwartet } of REGEL_TABELLE) {
    assert.equal(speicher.arbeitGehoertLebenderFremder?.(besitzer, lage), erwartet, name);
  }
});

async function mitDatenbank(t, lauf) {
  const db = await echteDatenbankMitRolle(t);
  if (!db) return;
  const verwaltung = new URL(process.env[POSTGRES_VARIABLE]);
  verwaltung.pathname = new URL(db.adresse).pathname;
  await mitVerbindung(verwaltung.href, (sql) => lauf({ db, sql }));
}

async function starteInstanz(t, db, env = {}) {
  const instanz = await startServer({ env: gemeinsameUmgebung(db.adresse, env) });
  t.after(() => instanz.stop());
  return instanz;
}

async function lebenszeichen(sql) {
  const { rows } = await sql.query(
    `SELECT kennung, gemeldet_um, extract(epoch FROM now() - gemeldet_um)::float AS alter_s
       FROM instanz_lebenszeichen ORDER BY kennung`,
  );
  return rows;
}

async function bisErfuellt(pruefung, was) {
  const frist = Date.now() + TAKT_FRIST_MS;
  let stand = await pruefung();
  while (!stand) {
    assert.ok(Date.now() < frist, `nicht erreicht: ${was}`);
    await echtWarten(ABFRAGE_TAKT_MS);
    stand = await pruefung();
  }
  return stand;
}

async function starteVoiceAttrappe(t) {
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => res.writeHead(HTTP_UPSTREAM_FEHLER, { "content-type": "application/json" }).end("{}"));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

const voiceUmgebung = (url) => ({
  TELNYX_API_KEY: "KEYtest-secret",
  TELNYX_CONNECTION_ID: "conn_test",
  TELNYX_ACCOUNT_SID: "acct_test",
  TELNYX_API_BASE: url,
});

async function offeneRueckfrageAnlegen(sql, besitzer, id = ANRUF) {
  const frage = { id: "c0", seq: 0, questions: ["Passt Donnerstag?"], status: "open", askedAt: new Date().toISOString(), answeredAt: null, answeredFacts: 0 };
  await sql.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, max_duration_s, consults, instanz)
     VALUES ($1, $2, 'token', 'outbound', 'active', $3, 3600, $4::jsonb, $5)`,
    [id, MANDANT, new Date().toISOString(), JSON.stringify([frage]), besitzer],
  );
}

async function gespeicherteRueckfrage(sql, id = ANRUF) {
  const { rows } = await sql.query(`SELECT consults FROM call WHERE id = $1`, [id]);
  return rows[0].consults[0];
}

test("Lebenszeichen: A meldet sich beim Start mit seiner Kennung und erneuert die Zeit alle 10 Sekunden", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    await starteInstanz(t, db);
    const [erste, ...weitere] = await lebenszeichen(sql);
    assert.equal(weitere.length, 0, "genau eine Zeile");
    assert.match(erste.kennung, KENNUNG);
    assert.ok(erste.alter_s < LEBEN_FRIST_S, `frisch nach Datenbankuhr: ${erste.alter_s}`);
    const spaeter = await bisErfuellt(async () => {
      const [zeile] = await lebenszeichen(sql);
      return zeile.gemeldet_um > erste.gemeldet_um && zeile;
    }, "A hat die Zeit erneuert");
    assert.equal(spaeter.kennung, erste.kennung);
  }),
);

test("Lebenszeichen: nach SIGTERM loescht A seine Zeile und sie erscheint bis zum Prozessende nicht wieder", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    const a = await starteInstanz(t, db);
    assert.equal((await lebenszeichen(sql)).length, EINMAL);
    await a.stop();
    assert.equal(a.child.exitCode, 0, a.stdout);
    assert.deepEqual(await lebenszeichen(sql), []);
  }),
);

test("Lebenszeichen: Zeilen aelter als 10 Minuten werden im Takt geloescht, juengere bleiben", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    await starteInstanz(t, db);
    await sql.query(
      `INSERT INTO instanz_lebenszeichen (kennung, gemeldet_um)
       VALUES ($1, now() - interval '11 minutes'), ($2, now() - interval '9 minutes')`,
      [ALTE_ZEILE, JUNGE_ZEILE],
    );
    await bisErfuellt(
      async () => !(await lebenszeichen(sql)).some((zeile) => zeile.kennung === ALTE_ZEILE),
      "die alte Zeile ist geloescht",
    );
    assert.ok((await lebenszeichen(sql)).some((zeile) => zeile.kennung === JUNGE_ZEILE), "die juengere Zeile bleibt");
  }),
);

test("Anlegen: ein neuer Anruf traegt die Kennung der anlegenden Instanz, ein Gesamt-Flush ueberschreibt sie nicht", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    const schema = await starteInstanz(t, db);
    await schema.stop();
    await sql.query(`UPDATE tenant SET owner_name = 'Jonas Beispiel', first_name = 'Jonas'`);
    const a = await starteInstanz(t, db, voiceUmgebung(await starteVoiceAttrappe(t)));
    const [{ kennung }] = await lebenszeichen(sql);
    const antwort = await placeCall(a);
    assert.equal(antwort.status, HTTP_UPSTREAM_FEHLER, await antwort.text());
    const rows = await bisErfuellt(async () => {
      const { rows: zeilen } = await sql.query(`SELECT id, instanz FROM call`);
      return zeilen.length > 0 && zeilen;
    }, "der Anruf steht in der Datenbank");
    assert.equal(rows.length, EINMAL);
    assert.equal(rows[0].instanz, kennung);
    await sql.query(`UPDATE call SET instanz = $1`, [ANDERE]);
    await a.stop();
    const { rows: danach } = await sql.query(`SELECT instanz FROM call`);
    assert.equal(danach[0].instanz, ANDERE, "der Flush laesst instanz stehen");
  }),
);

test("Anlegen: unter dem JSON-Speicher traegt ein neuer Anruf die Kennung der Instanz", async () => {
  const srv = await startServer({ env: voiceUmgebung("http://127.0.0.1:1"), ownerNumber: OWNER_TEST_NUMBER });
  try {
    await placeCall(srv);
    const [anruf, ...weitere] = srv.readStore().calls;
    assert.equal(weitere.length, 0);
    assert.match(anruf.instanz, KENNUNG);
  } finally {
    await srv.stop();
  }
});

test("Sicht: Anruf-Ansichten des Gateways enthalten weder Kennung noch Hostnamen", async () => {
  const seed = seedState({ calls: [seedCall({ id: ANRUF, status: "completed", endedAt: new Date().toISOString(), instanz: GEHEIME_KENNUNG })] });
  const srv = await startServer({ seed });
  try {
    for (const pfad of [`/api/calls/${ANRUF}`, "/api/state", "/api/tenant-data/export"]) {
      const antwort = await abrufMitFrist(`${srv.localUrl}${pfad}`);
      const text = await antwort.text();
      assert.ok(text.includes(ANRUF), `${pfad} zeigt den Anruf: ${text.slice(0, 200)}`);
      assert.ok(!text.includes('"instanz"'), `${pfad} ohne Feld instanz`);
      assert.ok(!text.includes(SICHTBARER_HOST), `${pfad} ohne Hostnamen`);
    }
  } finally {
    await srv.stop();
  }
});

async function rueckfrageAmLebenden(t, db, sql) {
  await starteInstanz(t, db);
  const [{ kennung }] = await lebenszeichen(sql);
  await offeneRueckfrageAnlegen(sql, kennung);
}

const EINE_GESCHLOSSEN = /\[boot\] verwaiste Rueckfragen geschlossen: 1 Anrufe/;

async function ausgabeNachStartUndStopp(t, db) {
  const b = await starteInstanz(t, db);
  await b.stop();
  return b.stdout;
}

async function istGeschlossen(sql, id = ANRUF) {
  return (await gespeicherteRueckfrage(sql, id)).status !== "open";
}

test("Rueckfragen: B startet, waehrend A lebt und einen Anruf mit offener Rueckfrage fuehrt, und schliesst sie nicht", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    await rueckfrageAmLebenden(t, db, sql);
    const ausgabe = await ausgabeNachStartUndStopp(t, db);
    assert.ok(!ausgabe.includes(RUECKFRAGEN_GESCHLOSSEN), ausgabe);
    assert.equal(await istGeschlossen(sql), false);
  }),
);

test("Rueckfragen: ist der Besitzer ausgefallen, schliesst B die Rueckfrage beim Start", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    await starteInstanz(t, db);
    await offeneRueckfrageAnlegen(sql, FREMD);
    assert.match(await ausgabeNachStartUndStopp(t, db), EINE_GESCHLOSSEN);
    assert.equal(await istGeschlossen(sql), true);
  }),
);

test("Rueckfragen: ist das Lebenszeichen nicht lesbar, schliesst B die Rueckfrage jedes fremden Anrufs", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    await rueckfrageAmLebenden(t, db, sql);
    await sql.query(`REVOKE SELECT ON instanz_lebenszeichen FROM ${db.rolle}`);
    assert.match(await ausgabeNachStartUndStopp(t, db), EINE_GESCHLOSSEN);
    assert.equal(await istGeschlossen(sql), true);
  }),
);

test("Rueckfragen: ein Besitzer mit Lebenszeichen von vor 20 Sekunden lebt, einer von vor 40 Sekunden nicht", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    await starteInstanz(t, db);
    await sql.query(
      `INSERT INTO instanz_lebenszeichen (kennung, gemeldet_um)
       VALUES ($1, now() - interval '20 seconds'), ($2, now() - interval '40 seconds')`,
      [JUNGE_ZEILE, ALTE_ZEILE],
    );
    await offeneRueckfrageAnlegen(sql, JUNGE_ZEILE, ANRUF);
    await offeneRueckfrageAnlegen(sql, ALTE_ZEILE, ANDERER_ANRUF);
    assert.match(await ausgabeNachStartUndStopp(t, db), EINE_GESCHLOSSEN);
    assert.equal(await istGeschlossen(sql, ANRUF), false);
    assert.equal(await istGeschlossen(sql, ANDERER_ANRUF), true);
  }),
);
