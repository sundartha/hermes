import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { mitVerbindung, POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { TELNYX_MESSZEILE_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";
import { gemeinsameUmgebung } from "../gemeinsam/zwei-prozesse.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { EL_OUTBOUND_ZUGANG_BOOT_ENV, seedCall, startServer } from "../helpers.js";

const ZEITGRENZE_MS = 180_000;
const WARTE_FRIST_MS = 45_000;
const HTTP_OK = 200;
const EINMAL = 1;
const MANDANT = seedCall().tenantId;
const FRISTEN_TAKT_MS = "200";
const LEBENDER_BESITZER = "lebender-host:00000000-0000-4000-8000-0000000000a1";
const KONVERSATION_FREMD = "conv_fremd_abfrage";
const KONVERSATION_OHNE_BESITZER = "conv_ohne_besitzer";
const KONVERSATION_EIGEN = "conv_eigen";
const KONVERSATION_FREMD_SPAETER = "conv_fremd_abfrage_spaeter";
const PROFIL_OUTBOUND = "telnyx_outbound_el_convai";
const PROFIL_INBOUND = "telnyx_inbound_el_convai";
const PFAD_KONVERSATION = "/v1/convai/conversations/";

async function mitDatenbank(t, lauf) {
  const db = await echteDatenbankMitRolle(t);
  if (!db) return;
  const verwaltung = new URL(process.env[POSTGRES_VARIABLE]);
  verwaltung.pathname = new URL(db.adresse).pathname;
  await mitVerbindung(verwaltung.href, (sql) => lauf({ db, sql }));
}

async function starteAttrappe(t) {
  const aufrufe = [];
  const server = createServer((anfrage, antwort) => {
    aufrufe.push(`${anfrage.method} ${anfrage.url}`);
    anfrage.resume();
    antwort.writeHead(HTTP_OK, { "content-type": "application/json" });
    antwort.end(JSON.stringify({ status: "processing" }));
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    abfragen: (konversation) => aufrufe.filter((aufruf) => aufruf.startsWith("GET") && aufruf.includes(`${PFAD_KONVERSATION}${konversation}`)).length,
    traegerAufrufe: (kennung) => aufrufe.filter((aufruf) => aufruf.includes(kennung)).length,
  };
}

async function starteInstanz(t, { db, attrappe }) {
  const instanz = await startServer({
    env: gemeinsameUmgebung(db.adresse, {
      TELNYX_API_KEY: TELNYX_MESSZEILE_SCHLUESSEL,
      TELNYX_ACCOUNT_SID: "acct_el_uebernahme",
      TELNYX_API_BASE: attrappe.url,
      ELEVENLABS_API_BASE: attrappe.url,
      FRISTEN_TAKT_MS,
      ...EL_OUTBOUND_ZUGANG_BOOT_ENV,
    }),
  });
  t.after(() => instanz.stop());
  return instanz;
}

async function kennungen(sql) {
  const { rows } = await sql.query(`SELECT kennung FROM instanz_lebenszeichen WHERE kennung <> $1`, [LEBENDER_BESITZER]);
  return rows.map((zeile) => zeile.kennung);
}

async function bisErfuellt(pruefung, was) {
  const frist = AbortSignal.timeout(WARTE_FRIST_MS);
  let stand = await pruefung();
  while (!stand) {
    assert.ok(!frist.aborted, `nicht erreicht: ${was}`);
    await new Promise((fertig) => setImmediate(fertig));
    stand = await pruefung();
  }
  return stand;
}

async function neueInstanzMitKennung(t, { db, sql, attrappe }) {
  const instanz = await starteInstanz(t, { db, attrappe });
  const [kennung] = await bisErfuellt(async () => {
    const stand = await kennungen(sql);
    return stand.length > 0 && stand;
  }, "die Instanz meldet sich");
  return { instanz, kennung };
}

async function lebenszeichenSetzen(sql, kennung, sekundenAlt) {
  await sql.query(
    `INSERT INTO instanz_lebenszeichen (kennung, gemeldet_um) VALUES ($1, now() - $2 * interval '1 second')
     ON CONFLICT (kennung) DO UPDATE SET gemeldet_um = now() - $2 * interval '1 second'`,
    [kennung, sekundenAlt],
  );
}

async function elAnrufAnlegen(sql, { id, besitzer, profil, konversation = null, abfrageFaellig = false, uebergabeFaellig = false }) {
  await sql.query(
    `INSERT INTO call (id, tenant_id, stream_token, twilio_sid, direction, status, started_at, answered_at, provider,
       max_duration_s, cost_profile, elevenlabs_conversation_id, instanz, frist_abfrage_at, frist_uebergabe_at)
     VALUES ($1, $2, $3, $4, $5, 'active', now()::text, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       'telnyx', 3600, $6, $7, $8,
       CASE WHEN $9::boolean THEN now() - interval '1 second' END,
       CASE WHEN $10::boolean THEN now() - interval '1 second' END)`,
    [id, MANDANT, `tok_${id}`, `CA_${id}`, profil === PROFIL_INBOUND ? "inbound" : "outbound", profil, konversation, besitzer, abfrageFaellig, uebergabeFaellig],
  );
}

async function besitzerVon(sql, id) {
  const { rows } = await sql.query(`SELECT instanz FROM call WHERE id = $1`, [id]);
  return rows[0].instanz;
}

async function leaseGenommen(sql, id, art) {
  const { rows } = await sql.query(`SELECT frist_${art}_lease_bis AS lease FROM call WHERE id = $1`, [id]);
  return rows[0].lease !== null;
}

test("Abfrage: B startet, waehrend der Besitzer lebt; B fragt dessen Gespraech nicht ab, ein Anruf ohne Besitzer schon, nach dem Ausfall uebernimmt B die Abfrage", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    const attrappe = await starteAttrappe(t);
    await (await starteInstanz(t, { db, attrappe })).stop();
    await lebenszeichenSetzen(sql, LEBENDER_BESITZER, -3600);
    await elAnrufAnlegen(sql, { id: "call_el_fremd", besitzer: LEBENDER_BESITZER, profil: PROFIL_OUTBOUND, konversation: KONVERSATION_FREMD, abfrageFaellig: true });
    await elAnrufAnlegen(sql, { id: "call_el_ohne", besitzer: null, profil: PROFIL_OUTBOUND, konversation: KONVERSATION_OHNE_BESITZER, abfrageFaellig: true });
    const b = await neueInstanzMitKennung(t, { db, sql, attrappe });
    await bisErfuellt(() => leaseGenommen(sql, "call_el_ohne", "abfrage"), "B nimmt den Anruf ohne Besitzer");
    await bisErfuellt(() => attrappe.abfragen(KONVERSATION_OHNE_BESITZER) >= EINMAL, "B fragt den Anruf ohne Besitzer ab");
    assert.equal(await leaseGenommen(sql, "call_el_fremd", "abfrage"), false);
    assert.equal(attrappe.abfragen(KONVERSATION_FREMD), 0);
    assert.equal(await besitzerVon(sql, "call_el_fremd"), LEBENDER_BESITZER);
    await elAnrufAnlegen(sql, { id: "call_el_eigen", besitzer: b.kennung, profil: PROFIL_OUTBOUND, konversation: KONVERSATION_EIGEN, abfrageFaellig: true });
    await bisErfuellt(() => attrappe.abfragen(KONVERSATION_EIGEN) >= EINMAL, "B fragt den eigenen Anruf ab");
    await lebenszeichenSetzen(sql, LEBENDER_BESITZER, 40);
    await sql.query(`UPDATE call SET frist_abfrage_at = now() - interval '1 second' WHERE id = 'call_el_fremd'`);
    await bisErfuellt(() => attrappe.abfragen(KONVERSATION_FREMD) >= EINMAL, "B fragt nach dem Ausfall ab");
    await bisErfuellt(async () => (await besitzerVon(sql, "call_el_fremd")) === b.kennung, "B traegt sich als Besitzer ein");
  }),
);

test("Abfrage: ist das Lebenszeichen nicht lesbar, fragt B das fremde Gespraech ab", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    const attrappe = await starteAttrappe(t);
    await (await starteInstanz(t, { db, attrappe })).stop();
    await lebenszeichenSetzen(sql, LEBENDER_BESITZER, -3600);
    await elAnrufAnlegen(sql, { id: "call_el_unlesbar", besitzer: LEBENDER_BESITZER, profil: PROFIL_OUTBOUND, konversation: KONVERSATION_FREMD_SPAETER });
    await starteInstanz(t, { db, attrappe });
    await sql.query(`REVOKE SELECT ON instanz_lebenszeichen FROM ${db.rolle}`);
    await sql.query(`UPDATE call SET frist_abfrage_at = now() - interval '1 second' WHERE id = 'call_el_unlesbar'`);
    await bisErfuellt(() => attrappe.abfragen(KONVERSATION_FREMD_SPAETER) >= EINMAL, "B fragt trotz unlesbarem Lebenszeichen ab");
  }),
);

test("Uebergabefrist: B leitet einen wartenden Anruf des lebenden Besitzers nicht um, nach dessen Ausfall schon", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    const attrappe = await starteAttrappe(t);
    await (await starteInstanz(t, { db, attrappe })).stop();
    await lebenszeichenSetzen(sql, LEBENDER_BESITZER, -3600);
    await elAnrufAnlegen(sql, { id: "call_uebergabe_fremd", besitzer: LEBENDER_BESITZER, profil: PROFIL_INBOUND, uebergabeFaellig: true });
    await elAnrufAnlegen(sql, { id: "call_uebergabe_ohne", besitzer: null, profil: PROFIL_INBOUND, uebergabeFaellig: true });
    await starteInstanz(t, { db, attrappe });
    await bisErfuellt(() => leaseGenommen(sql, "call_uebergabe_ohne", "uebergabe"), "B nimmt den Anruf ohne Besitzer");
    await bisErfuellt(() => attrappe.traegerAufrufe("CA_call_uebergabe_ohne") >= EINMAL, "B leitet den Anruf ohne Besitzer um");
    assert.equal(await leaseGenommen(sql, "call_uebergabe_fremd", "uebergabe"), false);
    assert.equal(attrappe.traegerAufrufe("CA_call_uebergabe_fremd"), 0);
    await lebenszeichenSetzen(sql, LEBENDER_BESITZER, 40);
    await bisErfuellt(() => attrappe.traegerAufrufe("CA_call_uebergabe_fremd") >= EINMAL, "B leitet nach dem Ausfall um");
  }),
);
