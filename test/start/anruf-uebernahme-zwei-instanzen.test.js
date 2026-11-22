import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mitVerbindung, POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { TELNYX_MESSZEILE_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";
import { gemeinsameUmgebung } from "../gemeinsam/zwei-prozesse.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { seedCall, startServer } from "../helpers.js";

const ZEITGRENZE_MS = 180_000;
const WARTE_FRIST_MS = 45_000;
const HTTP_OK = 200;
const EINMAL = 1;
const MANDANT = seedCall().tenantId;
const FRIST_BIS_FALLIG_S = 5;
const HOECHSTDAUER_GRUND = "max-duration-cap";
const BUDGET_GRUND = "budget-exhausted";
const RUECKFRAGEN_GESCHLOSSEN = "[boot] verwaiste Rueckfragen geschlossen";
const FRISTEN_TAKT_MS = "200";
const BUDGET_UMGEBUNG = { DEFAULT_TENANT_BUDGET_CENTS: "100", VOICE_TARIFF_INBOUND_CENTS: "20" };

async function mitDatenbank(t, lauf) {
  const db = await echteDatenbankMitRolle(t);
  if (!db) return;
  const verwaltung = new URL(process.env[POSTGRES_VARIABLE]);
  verwaltung.pathname = new URL(db.adresse).pathname;
  await mitVerbindung(verwaltung.href, (sql) => lauf({ db, sql }));
}

async function starteTelnyxAttrappe(t) {
  const aufrufe = [];
  const server = createServer((anfrage, antwort) => {
    aufrufe.push(`${anfrage.method} ${anfrage.url}`);
    anfrage.resume();
    antwort.writeHead(HTTP_OK, { "content-type": "application/json" });
    antwort.end("{}");
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    auflegen: (kennung) => aufrufe.filter((aufruf) => aufruf.startsWith("POST") && aufruf.includes(`/Calls/${kennung}`)).length,
  };
}

const beendet = (instanz) => instanz.child.exitCode !== null || instanz.child.signalCode !== null;

async function starteInstanz(t, { db, attrappe, env = {} }) {
  const instanz = await startServer({
    env: gemeinsameUmgebung(db.adresse, {
      TELNYX_API_KEY: TELNYX_MESSZEILE_SCHLUESSEL,
      TELNYX_ACCOUNT_SID: "acct_uebernahme",
      TELNYX_API_BASE: attrappe.url,
      FRISTEN_TAKT_MS,
      ...env,
    }),
  });
  t.after(() => (beendet(instanz) ? undefined : instanz.stop()));
  return instanz;
}

async function schemaAnlegen(t, { db, attrappe }) {
  const erste = await starteInstanz(t, { db, attrappe });
  await erste.stop();
}

async function toteSofort(instanz) {
  const weg = new Promise((fertig) => instanz.child.once("exit", fertig));
  instanz.child.kill("SIGKILL");
  await weg;
}

async function kennungen(sql) {
  const { rows } = await sql.query(`SELECT kennung FROM instanz_lebenszeichen ORDER BY gemeldet_um`);
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

async function neueInstanzMitKennung(t, { db, sql, attrappe, env }) {
  const vorher = await kennungen(sql);
  const instanz = await starteInstanz(t, { db, attrappe, env });
  const bekannt = new Set(vorher);
  const kennung = (await bisErfuellt(async () => (await kennungen(sql)).find((eintrag) => !bekannt.has(eintrag)), "die Instanz meldet sich"));
  return { instanz, kennung };
}

async function anrufAnlegen(sql, { id, besitzer, maxDauerS = 3600, laeuftSeitS = 0, rueckfrage = false }) {
  const frage = { id: "c0", seq: 0, questions: ["Passt Donnerstag?"], status: "open", askedAt: "2026-01-01T00:00:00.000Z", answeredAt: null, answeredFacts: 0 };
  await sql.query(
    `INSERT INTO call (id, tenant_id, stream_token, twilio_sid, direction, status, started_at, answered_at, provider, max_duration_s, consults, instanz)
     VALUES ($1, $2, $3, $4, 'inbound', 'active', (now() - $6 * interval '1 second')::text,
       to_char((now() - $6 * interval '1 second') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       'telnyx', $5, $7::jsonb, $8)`,
    [id, MANDANT, `tok_${id}`, `CA_${id}`, maxDauerS, laeuftSeitS, JSON.stringify(rueckfrage ? [frage] : []), besitzer],
  );
}

async function zeile(sql, id) {
  const { rows } = await sql.query(`SELECT status, failure_reason, billed_at, instanz, consults FROM call WHERE id = $1`, [id]);
  return rows[0];
}

const frageGeschlossen = (stand) => stand.consults[0].status !== "open";

async function lebendeInstanz(t, umgebung) {
  const a = await neueInstanzMitKennung(t, umgebung);
  const b = await neueInstanzMitKennung(t, umgebung);
  return { a, b };
}

test("Hoechstdauer: B startet, waehrend A lebt und einen Anruf fuehrt; der Anruf endet einmal aufgelegt und einmal abgerechnet, B uebernimmt ihn nicht", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    const attrappe = await starteTelnyxAttrappe(t);
    await schemaAnlegen(t, { db, attrappe });
    const a = await neueInstanzMitKennung(t, { db, sql, attrappe });
    await anrufAnlegen(sql, { id: "call_hd_lebend", besitzer: a.kennung, maxDauerS: FRIST_BIS_FALLIG_S });
    await neueInstanzMitKennung(t, { db, sql, attrappe });
    const ende = await bisErfuellt(async () => {
      const stand = await zeile(sql, "call_hd_lebend");
      return stand.status !== "active" && stand.billed_at !== null && stand;
    }, "der Anruf ist beendet und abgerechnet");
    assert.equal(ende.failure_reason, HOECHSTDAUER_GRUND);
    assert.notEqual(ende.billed_at, null);
    assert.equal(ende.instanz, a.kennung);
    assert.equal(attrappe.auflegen("CA_call_hd_lebend"), EINMAL);
  }),
);

test("Uebernahme: B nimmt den Anruf des mit SIGKILL beendeten A im laufenden Takt, schliesst die Rueckfrage und beendet ihn zur Hoechstdauer genau einmal", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    const attrappe = await starteTelnyxAttrappe(t);
    await schemaAnlegen(t, { db, attrappe });
    const { a, b } = await lebendeInstanz(t, { db, sql, attrappe });
    await anrufAnlegen(sql, { id: "call_uebernahme_kill", besitzer: a.kennung, maxDauerS: 600, laeuftSeitS: 570, rueckfrage: true });
    await toteSofort(a.instanz);
    await sql.query(`UPDATE instanz_lebenszeichen SET gemeldet_um = now() - interval '40 seconds' WHERE kennung = $1`, [a.kennung]);
    await bisErfuellt(async () => (await zeile(sql, "call_uebernahme_kill")).instanz === b.kennung, "B hat den Anruf uebernommen");
    const ende = await bisErfuellt(async () => {
      const aktuell = await zeile(sql, "call_uebernahme_kill");
      return aktuell.status !== "active" && aktuell.billed_at !== null && aktuell;
    }, "B hat den Anruf zur Hoechstdauer beendet und abgerechnet");
    assert.equal(ende.failure_reason, HOECHSTDAUER_GRUND);
    assert.equal(ende.instanz, b.kennung);
    assert.equal(frageGeschlossen(ende), true);
    assert.notEqual(ende.billed_at, null);
    assert.equal(attrappe.auflegen("CA_call_uebernahme_kill"), EINMAL);
  }),
);

test("Uebernahme: meldet sich A ab, nimmt B den aktiven Anruf von A und schliesst die offene Rueckfrage", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    const attrappe = await starteTelnyxAttrappe(t);
    await schemaAnlegen(t, { db, attrappe });
    const { a, b } = await lebendeInstanz(t, { db, sql, attrappe });
    await anrufAnlegen(sql, { id: "call_uebernahme_abmeldung", besitzer: a.kennung, rueckfrage: true });
    await a.instanz.stop();
    const stand = await bisErfuellt(async () => {
      const aktuell = await zeile(sql, "call_uebernahme_abmeldung");
      return aktuell.instanz === b.kennung && frageGeschlossen(aktuell) && aktuell;
    }, "B hat den Anruf uebernommen und die Rueckfrage geschlossen");
    assert.equal(stand.status, "active");
    assert.equal(attrappe.auflegen("CA_call_uebernahme_abmeldung"), 0);
  }),
);

test("Kostendecke: liegt der Mandant ueber der Decke, beendet B den Anruf des ausgefallenen A mit dem Budget-Grund, einmal aufgelegt und einmal abgerechnet", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    const attrappe = await starteTelnyxAttrappe(t);
    await schemaAnlegen(t, { db, attrappe });
    const { a } = await lebendeInstanz(t, { db, sql, attrappe, env: BUDGET_UMGEBUNG });
    await toteSofort(a.instanz);
    await anrufAnlegen(sql, { id: "call_budget_uebernahme", besitzer: a.kennung, laeuftSeitS: 600 });
    await sql.query(`UPDATE instanz_lebenszeichen SET gemeldet_um = now() - interval '40 seconds' WHERE kennung = $1`, [a.kennung]);
    const ende = await bisErfuellt(async () => {
      const aktuell = await zeile(sql, "call_budget_uebernahme");
      return aktuell.status !== "active" && aktuell.billed_at !== null && aktuell;
    }, "der Anruf ist beendet und abgerechnet");
    assert.equal(ende.failure_reason, BUDGET_GRUND);
    assert.notEqual(ende.billed_at, null);
    assert.equal(attrappe.auflegen("CA_call_budget_uebernahme"), EINMAL);
  }),
);

test("Uebernahme: laufen B und C, wenn A ausfaellt, traegt sich genau eine als Besitzer ein; der Anruf endet einmal aufgelegt und einmal abgerechnet", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    const attrappe = await starteTelnyxAttrappe(t);
    await schemaAnlegen(t, { db, attrappe });
    const { a, b } = await lebendeInstanz(t, { db, sql, attrappe });
    const c = await neueInstanzMitKennung(t, { db, sql, attrappe });
    await anrufAnlegen(sql, { id: "call_uebernahme_zwei", besitzer: a.kennung, rueckfrage: true });
    await toteSofort(a.instanz);
    await sql.query(`UPDATE instanz_lebenszeichen SET gemeldet_um = now() - interval '40 seconds' WHERE kennung = $1`, [a.kennung]);
    const stand = await bisErfuellt(async () => {
      const aktuell = await zeile(sql, "call_uebernahme_zwei");
      return aktuell.instanz !== a.kennung && frageGeschlossen(aktuell) && aktuell;
    }, "einer der Lebenden hat den Anruf uebernommen");
    assert.ok([b.kennung, c.kennung].includes(stand.instanz), stand.instanz);
    await sql.query(`UPDATE call SET frist_hoechstdauer_at = now() WHERE id = $1`, ["call_uebernahme_zwei"]);
    const ende = await bisErfuellt(async () => {
      const aktuell = await zeile(sql, "call_uebernahme_zwei");
      return aktuell.status !== "active" && aktuell.billed_at !== null && aktuell;
    }, "der Anruf ist beendet und abgerechnet");
    assert.equal(ende.instanz, stand.instanz);
    assert.notEqual(ende.billed_at, null);
    assert.equal(attrappe.auflegen("CA_call_uebernahme_zwei"), EINMAL);
    const geschlossen = [b, c].filter((lebende) => lebende.instanz.stdout.includes(RUECKFRAGEN_GESCHLOSSEN));
    assert.equal(geschlossen.length, EINMAL);
  }),
);

test("Uebernahme: ist das Lebenszeichen nicht lesbar, nimmt B im Takt jeden aktiven Anruf, der nicht ihr eigener ist", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    const attrappe = await starteTelnyxAttrappe(t);
    await schemaAnlegen(t, { db, attrappe });
    const { a, b } = await lebendeInstanz(t, { db, sql, attrappe });
    await anrufAnlegen(sql, { id: "call_uebernahme_unlesbar", besitzer: a.kennung, rueckfrage: true });
    await sql.query(`REVOKE SELECT ON instanz_lebenszeichen FROM ${db.rolle}`);
    const stand = await bisErfuellt(async () => {
      const aktuell = await zeile(sql, "call_uebernahme_unlesbar");
      return aktuell.instanz === b.kennung && frageGeschlossen(aktuell) && aktuell;
    }, "B hat den fremden Anruf uebernommen");
    assert.equal(stand.status, "active");
  }),
);

test("Wiederanbindung: ein Statusereignis zu einem fremden Anruf, den B ueber reattachActiveCall anbindet, aendert die Kennung des Besitzers nicht", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    const attrappe = await starteTelnyxAttrappe(t);
    await schemaAnlegen(t, { db, attrappe });
    const a = await neueInstanzMitKennung(t, { db, sql, attrappe, env: { SKIP_TWILIO_SIGNATURE_CHECK: "true" } });
    await anrufAnlegen(sql, { id: "call_wiederanbindung", besitzer: a.kennung });
    const b = await neueInstanzMitKennung(t, { db, sql, attrappe, env: { SKIP_TWILIO_SIGNATURE_CHECK: "true" } });
    const antwort = await abrufMitFrist(`${b.instanz.localUrl}/voice/status?callId=call_wiederanbindung`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "CallStatus=in-progress&CallSid=CA_call_wiederanbindung",
    });
    assert.equal(antwort.status, HTTP_OK);
    await bisErfuellt(() => b.instanz.stdout.includes('"callId":"call_wiederanbindung"'), "B hat das Statusereignis verarbeitet");
    assert.equal((await zeile(sql, "call_wiederanbindung")).instanz, a.kennung);
  }),
);

test("Uebernahme: B nimmt einen Anruf ohne Besitzer, laesst den eigenen und den beendeten Anruf eines Ausgefallenen unangetastet", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    const attrappe = await starteTelnyxAttrappe(t);
    await schemaAnlegen(t, { db, attrappe });
    const b = await neueInstanzMitKennung(t, { db, sql, attrappe });
    await anrufAnlegen(sql, { id: "call_ohne_besitzer", besitzer: null, rueckfrage: true });
    await anrufAnlegen(sql, { id: "call_ohne_besitzer_ohne_frage", besitzer: null });
    await anrufAnlegen(sql, { id: "call_eigener", besitzer: b.kennung, rueckfrage: true });
    await anrufAnlegen(sql, { id: "call_beendet", besitzer: "weg-host:00000000-0000-4000-8000-000000000009", rueckfrage: true });
    await sql.query(`UPDATE call SET status = 'completed' WHERE id = 'call_beendet'`);
    await bisErfuellt(async () => {
      const aktuell = await zeile(sql, "call_ohne_besitzer");
      return aktuell.instanz === b.kennung && frageGeschlossen(aktuell);
    }, "B hat den Anruf ohne Besitzer uebernommen und seine Rueckfrage geschlossen");
    assert.equal((await zeile(sql, "call_ohne_besitzer_ohne_frage")).instanz, b.kennung);
    assert.match(b.instanz.stdout, /\[boot\] verwaiste Rueckfragen geschlossen: 1 Anrufe/);
    const eigener = await zeile(sql, "call_eigener");
    assert.equal(frageGeschlossen(eigener), false, "die eigene Rueckfrage bleibt offen");
    const beendet = await zeile(sql, "call_beendet");
    assert.equal(beendet.instanz, "weg-host:00000000-0000-4000-8000-000000000009");
    assert.equal(frageGeschlossen(beendet), false);
  }),
);

test("Uebernahme: scheitert die Eintragung, steht der Fehler im Log, und B versucht es im naechsten Takt erneut", { timeout: ZEITGRENZE_MS }, (t) =>
  mitDatenbank(t, async ({ db, sql }) => {
    const attrappe = await starteTelnyxAttrappe(t);
    await schemaAnlegen(t, { db, attrappe });
    const { a, b } = await lebendeInstanz(t, { db, sql, attrappe });
    await sql.query(`
      CREATE FUNCTION sperre_instanz() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.instanz IS DISTINCT FROM OLD.instanz THEN RAISE EXCEPTION 'instanz gesperrt'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER sperre_instanz BEFORE UPDATE ON call FOR EACH ROW EXECUTE FUNCTION sperre_instanz()`);
    await anrufAnlegen(sql, { id: "call_eintragung_scheitert", besitzer: a.kennung, rueckfrage: true });
    await a.instanz.stop();
    await bisErfuellt(() => b.instanz.stdout.includes("[boot] Uebernahme fehlgeschlagen call=call_eintragung_scheitert: instanz gesperrt"), "der Fehler steht im Log");
    const vorher = await zeile(sql, "call_eintragung_scheitert");
    assert.equal(vorher.instanz, a.kennung);
    assert.equal(frageGeschlossen(vorher), false);
    await sql.query(`DROP TRIGGER sperre_instanz ON call`);
    await bisErfuellt(async () => (await zeile(sql, "call_eintragung_scheitert")).instanz === b.kennung, "B hat es im naechsten Takt erneut versucht");
  }),
);
