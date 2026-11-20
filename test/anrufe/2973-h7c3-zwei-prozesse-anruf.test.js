import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { BOOTSTRAP_TENANT_ID, makePgStore } from "../pg-helpers.js";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import {
  anrufAnBis,
  mandantenAbruf,
  postgresVorhanden,
  seedeMandant,
  starteAnAnbieter,
  starteAttrappeMitGespraechsende,
  transkriptSql,
} from "./hermes-mit-postgres.js";

const ZEITGRENZE_MS = 180_000;
const HTTP_OK = 200;
const ALT_ISO = "2026-01-01T00:00:00.000Z";
const SEGMENT_ZEIT = "2026-01-01T00:00:01.000Z";
const ZIEL = "+4915112340931";
const ALTES_ZIEL = "+4915112345602";
const MANDANT_A = Object.freeze({ id: "tenant_h7c3_a", sub: "sub-h7c3-a", e164: "+4930555000331", privateNumber: ZIEL });
const MANDANT_B = Object.freeze({ id: "tenant_h7c3_b", sub: "sub-h7c3-b", e164: "+4930555000332" });
const GESPRAECH_ANBIETER = Object.freeze([
  { role: "agent", message: "Guten Tag, hier ist die KI-Assistentin von Mandant Test." },
  { role: "user", message: "Ja, bitte sehr, worum geht es?" },
  { role: "agent", message: "Ich moechte einen Termin am Donnerstag vereinbaren." },
  { role: "user", message: "Donnerstag um zehn Uhr passt." },
]);
const GESPRAECH_TEXTE = GESPRAECH_ANBIETER.map((zeile) => zeile.message);
const VORSPANN_ZEILEN = 1;
const ERGEBNIS_ABFRAGE_MS = "200";
const GESPRAECH = Object.freeze([
  ["caller", "Guten Tag, ich rufe wegen des Termins an."],
  ["agent", "Hier ist die KI-Assistentin, wie kann ich helfen?"],
  ["caller", "Passt der Donnerstag um zehn Uhr?"],
]);
const ANRUF_FELDER = Object.freeze(["id", "direction", "from", "to", "goal", "status", "tenantId"]);
const SEGMENT_SQL = `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at) VALUES ($1,$2,$3,$4,$5)`;
const ALTER_ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164,
  to_e164, goal, started_at, ended_at, max_duration_s, provider)
  VALUES ($1, $2, $3, 'outbound', 'completed', $4, $5, 'Altes Ziel', $6, $6, 600, 'telnyx')`;
const ZEILEN_SQL = `SELECT
  (SELECT count(*)::int FROM call WHERE id = $1) AS anrufe,
  (SELECT count(*)::int FROM transcript_segment WHERE call_id = $1) AS zeilen`;

const holeZustand = async (prozess, mandant) => {
  const antwort = await mandantenAbruf(prozess, mandant.sub).hole("/api/state");
  assert.equal(antwort.status, HTTP_OK);
  return antwort.json();
};

const textzeilenVon = (anruf) => anruf.transcript.slice(VORSPANN_ZEILEN).map((zeile) => zeile.text);
const anrufVon = (zustand, id) => zustand.calls.find((anruf) => anruf.id === id);
const felderVon = (anruf) => Object.fromEntries(ANRUF_FELDER.map((feld) => [feld, anruf[feld]]));
const gestartet = (anruf) => Boolean(anruf.konversation);
const beendet = (anruf) => anruf.status !== "active";

async function zeilenAnlegen(sql, callId, zeilen) {
  for (const [rolle, text] of zeilen) {
    await sql(SEGMENT_SQL, [callId, MANDANT_A.id, rolle, text, SEGMENT_ZEIT]);
  }
}

function adminAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

async function mitZweiProzessen(t, lauf) {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const db = await echteDatenbankMitRolle(t);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const anbieter = await starteAttrappeMitGespraechsende();
  const env = {
    ELEVENLABS_INBOUND_TENANT_IDS: [BOOTSTRAP_TENANT_ID, MANDANT_A.id, MANDANT_B.id].join(","),
    ELEVENLABS_RESULT_POLL_MS: ERGEBNIS_ABFRAGE_MS,
    RETENTION_DAYS: "30",
    DIAGNOSTIC_RETENTION_DAYS: "7",
  };
  const gestartetProzesse = [];
  const starte = async () => {
    const prozess = await starteAnAnbieter(db, anbieter, env);
    gestartetProzesse.push(prozess);
    return prozess;
  };
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  try {
    await (await starte()).stop();
    for (const mandant of [MANDANT_A, MANDANT_B]) await seedeMandant(sql, mandant);
    const a = await starte();
    const b = await starte();
    await lauf({ a, b, starte, sql, db, anbieter });
  } finally {
    await Promise.all(gestartetProzesse.map((prozess) => prozess.stop()));
    await anbieter.schliessen();
    await verwaltung.end();
  }
}

async function legeAnrufInAAn({ a, sql, anbieter }) {
  const antwort = await mandantenAbruf(a, MANDANT_A.sub).rufeAn(ZIEL);
  assert.equal(antwort.status, HTTP_OK);
  const angelegt = await anrufAnBis(sql, { ziel: ZIEL, genug: gestartet });
  await transkriptSql(sql, angelegt, VORSPANN_ZEILEN);
  anbieter.beendeGespraech(angelegt.konversation, GESPRAECH_ANBIETER);
  const fertig = await anrufAnBis(sql, { ziel: ZIEL, genug: beendet });
  await transkriptSql(sql, fertig, GESPRAECH_ANBIETER.length + VORSPANN_ZEILEN);
  return fertig.id;
}

async function altenAnrufAnlegen(sql, id) {
  await sql(ALTER_ANRUF_SQL, [id, MANDANT_A.id, `tok_${id}`, MANDANT_A.e164, ALTES_ZIEL, ALT_ISO]);
  await zeilenAnlegen(sql, id, GESPRAECH);
}

const inDatenbank = async (sql, id) => (await sql(ZEILEN_SQL, [id])).rows[0];

test(
  "H7C3-SICHTBAR: ein Anruf samt Transkriptzeilen, den Prozess A angelegt hat, steht in Prozess B mit denselben Feldern und den Zeilen in gesprochener Reihenfolge",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    await mitZweiProzessen(t, async (prozesse) => {
      const { a, b } = prozesse;
      const callId = await legeAnrufInAAn(prozesse);
      const ausA = anrufVon(await holeZustand(a, MANDANT_A), callId);
      const ausB = anrufVon(await holeZustand(b, MANDANT_A), callId);
      assert.equal(ausB.to, ZIEL);
      assert.equal(ausB.direction, "outbound");
      assert.equal(ausB.tenantId, MANDANT_A.id);
      assert.deepEqual(felderVon(ausB), felderVon(ausA));
      assert.deepEqual(textzeilenVon(ausB), GESPRAECH_TEXTE);
    });
  },
);

test(
  "H7C3-NEUSTART: nach dem Neustart von Prozess B sieht B den Anruf mit seinen Zeilen weiter",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    await mitZweiProzessen(t, async (prozesse) => {
      const { b, starte } = prozesse;
      const callId = await legeAnrufInAAn(prozesse);
      const vorher = anrufVon(await holeZustand(b, MANDANT_A), callId);
      await b.stop();
      const neuB = await starte();
      const nachher = anrufVon(await holeZustand(neuB, MANDANT_A), callId);
      assert.deepEqual(felderVon(nachher), felderVon(vorher));
      assert.deepEqual(textzeilenVon(nachher), GESPRAECH_TEXTE);
    });
  },
);

test(
  "H7C3-MANDANT: ein zweiter Mandant sieht den Anruf von Mandant A in keinem der beiden Prozesse",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    await mitZweiProzessen(t, async (prozesse) => {
      const { a, b } = prozesse;
      const callId = await legeAnrufInAAn(prozesse);
      assert.ok(anrufVon(await holeZustand(b, MANDANT_A), callId));
      for (const prozess of [a, b]) {
        const fremd = await holeZustand(prozess, MANDANT_B);
        assert.deepEqual(fremd.calls, []);
      }
    });
  },
);

test(
  "H7C3-AUFBEWAHRUNG: der Aufbewahrungslauf beim Start von Prozess B loescht einen abgelaufenen Anruf samt Zeilen in der Datenbank, danach sehen ihn beide Prozesse nicht mehr",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    await mitZweiProzessen(t, async ({ a, b, starte, sql }) => {
      const id = "call_h7c3_alt";
      await altenAnrufAnlegen(sql, id);
      assert.ok(anrufVon(await holeZustand(a, MANDANT_A), id));
      assert.deepEqual(await inDatenbank(sql, id), { anrufe: 1, zeilen: GESPRAECH.length });
      await b.stop();
      const neuB = await starte();
      assert.deepEqual(await inDatenbank(sql, id), { anrufe: 0, zeilen: 0 });
      assert.equal(anrufVon(await holeZustand(neuB, MANDANT_A), id), undefined);
      assert.equal(anrufVon(await holeZustand(a, MANDANT_A), id), undefined);
    });
  },
);

test(
  "H7C3-LOESCHUNG: die Loeschung der Mandantendaten entfernt Anruf und Zeilen in der Datenbank, danach sehen beide Prozesse ihn nicht mehr",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    await mitZweiProzessen(t, async (prozesse) => {
      const { a, b, sql, db } = prozesse;
      const callId = await legeAnrufInAAn(prozesse);
      assert.ok(anrufVon(await holeZustand(b, MANDANT_A), callId));
      const pool = new pg.Pool({ connectionString: db.adresse });
      pool.on("error", () => {});
      const runner = {
        withClient: async (arbeit) => {
          const client = await pool.connect();
          try {
            return await arbeit({ query: (text, params) => client.query(text, params), exec: (text) => client.query(text) });
          } finally {
            client.release();
          }
        },
      };
      const store = makePgStore(runner);
      await store.init();
      const entfernt = await store.eraseTenantData(MANDANT_A.id);
      await store.drainFlushes();
      await pool.end();
      assert.equal(entfernt.calls, 1);
      assert.equal(entfernt.transcriptSegments, GESPRAECH_ANBIETER.length + VORSPANN_ZEILEN);
      assert.deepEqual(await inDatenbank(sql, callId), { anrufe: 0, zeilen: 0 });
      assert.equal(anrufVon(await holeZustand(a, MANDANT_A), callId), undefined);
      assert.equal(anrufVon(await holeZustand(b, MANDANT_A), callId), undefined);
    });
  },
);
