import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";

import { starteAnbieterServer } from "../gemeinsam/anbieter-attrappe.mjs";
import { starteBetterStackAttrappe } from "../gemeinsam/better-stack-attrappe.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { parallelStarten } from "../gemeinsam/parallelstart.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { echtWarten } from "../echt-warten.js";
import { EL_INBOUND_ACCESS_BOOT_ENV, startServerExpectExit, waitUntil } from "../helpers.js";

const ZEITGRENZE_MS = 120_000;
const HTTP_OK = 200;
const EINMAL = 1;
const SMS_ANTWORT_VERZOEGERUNG_MS = 1_000;
const HALTE_SCHLUESSEL = 7_001;
const UEBERSPRINGEN_FRIST_MS = 60_000;
const NACHLAUF_FUER_ZWEITE_SMS_MS = 1_500;
const GLEICHSTAND_TABELLE = "platform_anrufpause";
const GLEICHSTAND_FRIST_MS = 60_000;
const GLEICHSTAND_TAKT_MS = 100;
const BEIDE = 2;
const EL_ANTWORT_VERZOEGERUNG_MS = 2_000;
const SWEEP_LAEUFT_FRIST_MS = 30_000;
const HEIL_SMS = /geheilt/;
const HEILUNG_FERTIG = "[bootstrap-heal] Leerer Store aus den Deploy-Parametern geheilt";
const HEILUNG_FRIST_MS = 60_000;
const FREMDER_MANDANT = "tenant_start_sperre_fremd";
const HEILUNG_UEBERSPRUNGEN = "[bootstrap-heal] uebersprungen: andere Instanz";
const SWEEP_UEBERSPRUNGEN = "[el-trunk] sweep uebersprungen grund=andere_instanz";
const ZWEI_SCHLUESSEL_FORM = 2;
const AGENT_ID = "agent_start_sperre";
const SIP_USER = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_USER;
const ALARM_ZIEL = "+15005550009";
const DIDS = Object.freeze([
  { id: "num_start_a", e164: "+15005550101", registrierung: "phnum_start_a" },
  { id: "num_start_b", e164: "+15005550102", registrierung: "phnum_start_b" },
]);

async function rollenDatenbank(t) {
  const db = await echteDatenbankMitRolle(t);
  if (!db) return null;
  const verwaltungsAdresse = new URL(process.env[POSTGRES_VARIABLE]);
  verwaltungsAdresse.pathname = new URL(db.adresse).pathname;
  const offene = [];
  const verbunden = async (adresse) => {
    const verbindung = new pg.Client({ connectionString: adresse });
    await verbindung.connect();
    offene.push(verbindung);
    return verbindung;
  };
  return {
    adresse: db.adresse,
    verbinden: () => verbunden(verwaltungsAdresse.href),
    schliessen: () => Promise.allSettled(offene.map((verbindung) => verbindung.end())),
  };
}

async function mitRollenDatenbank(t, lauf) {
  const db = await rollenDatenbank(t);
  if (!db) return;
  try {
    await lauf(db);
  } finally {
    await db.schliessen();
  }
}

function zaehleZeilen(instanzen, zeile) {
  return instanzen.filter((instanz) => instanz.ausgabe().includes(zeile)).length;
}

function ausgaben(instanzen) {
  return instanzen.map((instanz, nr) => `--- Instanz ${nr + 1} ---\n${instanz.ausgabe()}`).join("\n");
}

async function gleichstandHerstellen(db) {
  const verbindung = await db.verbinden();
  await verbindung.query("BEGIN");
  await verbindung.query(`LOCK TABLE ${GLEICHSTAND_TABELLE} IN ACCESS EXCLUSIVE MODE`);
  return verbindung;
}

async function wartendeAufGleichstand(verbindung) {
  const { rows } = await verbindung.query(
    `SELECT count(*)::int AS anzahl FROM pg_locks
      WHERE relation = $1::regclass AND NOT granted`,
    [GLEICHSTAND_TABELLE],
  );
  return rows[0].anzahl;
}

async function gleichstandFreigeben(verbindung) {
  const frist = Date.now() + GLEICHSTAND_FRIST_MS;
  while ((await wartendeAufGleichstand(verbindung)) < BEIDE && Date.now() < frist) {
    await echtWarten(GLEICHSTAND_TAKT_MS);
  }
  const wartende = await wartendeAufGleichstand(verbindung);
  await verbindung.query("COMMIT");
  return wartende;
}

async function schemaVorbereiten(db, nachher = async () => {}) {
  const erstStart = await startServerExpectExit({ env: { STORE_BACKEND: "pg", DATABASE_URL: db.adresse } });
  assert.match(erstStart.output, /Keine aktive Nummer im Store/, "Vorlauf legt nur das Schema an");
  const verbindung = await db.verbinden();
  const { rows } = await verbindung.query("SELECT id FROM tenant");
  assert.equal(rows.length, EINMAL, "der Vorlauf legt nur den Besitzer-Mandanten an");
  await nachher(verbindung, rows[0].id);
  return rows[0].id;
}

async function zaehle(db, tabelle) {
  const verbindung = await db.verbinden();
  const { rows } = await verbindung.query(`SELECT count(*)::int AS anzahl FROM ${tabelle}`);
  return rows[0].anzahl;
}

async function starteSmsAttrappe(t) {
  const attrappe = await starteAnbieterServer(({ req, body, res, vermerke }) => {
    vermerke({ pfad: req.url, text: JSON.parse(body || "{}").text ?? "" });
    void echtWarten(SMS_ANTWORT_VERZOEGERUNG_MS).then(() => res.writeHead(HTTP_OK, { "content-type": "application/json" }).end("{}"));
  });
  t.after(() => attrappe.close());
  return attrappe;
}

async function starteVorfallAttrappe(t) {
  const attrappe = await starteBetterStackAttrappe();
  t.after(() => attrappe.close());
  return attrappe;
}

function heilMeldungen(vorfaelle) {
  return vorfaelle.meldungen.filter((meldung) => HEIL_SMS.test(meldung.text)).length;
}

async function starteElAttrappe(t) {
  const abfragen = [];
  const attrappe = await starteAnbieterServer(({ req, res }) => {
    const registrierung = req.url.split("/").pop();
    const nummer = DIDS.find((did) => did.registrierung === registrierung);
    abfragen.push(registrierung);
    const antwort = {
      phone_number: nummer?.e164,
      assigned_agent: { agent_id: AGENT_ID },
      inbound_trunk: { has_auth_credentials: true, username: SIP_USER, allowed_numbers: [nummer?.e164] },
      outbound_trunk: {},
    };
    void echtWarten(EL_ANTWORT_VERZOEGERUNG_MS).then(() => res.writeHead(HTTP_OK, { "content-type": "application/json" }).end(JSON.stringify(antwort)));
  });
  t.after(() => attrappe.close());
  return { ...attrappe, abfragen };
}

async function nummernEinfuegen(verbindung, mandant) {
  await verbindung.query("BEGIN");
  await verbindung.query(`SELECT set_config('app.current_tenant', $1, true)`, [mandant]);
  for (const did of DIDS) {
    await verbindung.query(
      `INSERT INTO number (id, tenant_id, e164, provider, status, provider_agent_phone_number_id)
       VALUES ($1, $2, $3, 'telnyx', 'active', $4)`,
      [did.id, mandant, did.e164, did.registrierung],
    );
  }
  await verbindung.query("COMMIT");
}

async function nummerEinfuegenAnhalten(verbindung) {
  await verbindung.query(`
    CREATE FUNCTION start_sperre_test_verzoegern() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_lock(${HALTE_SCHLUESSEL}); PERFORM pg_advisory_unlock(${HALTE_SCHLUESSEL}); RETURN NEW; END $$`);
  await verbindung.query(`
    CREATE TRIGGER start_sperre_test_verzoegern BEFORE INSERT ON number
    FOR EACH ROW EXECUTE FUNCTION start_sperre_test_verzoegern()`);
}

async function zaehleSperren(verbindung, bedingung, parameter = []) {
  const { rows } = await verbindung.query(
    `SELECT count(*)::int AS anzahl FROM pg_locks WHERE locktype = 'advisory' AND ${bedingung}`,
    parameter,
  );
  return rows[0].anzahl;
}

async function bisErfuellt(pruefung, fristMs, was) {
  const frist = Date.now() + fristMs;
  while (!(await pruefung())) {
    assert.ok(Date.now() < frist, `nicht erreicht: ${was}`);
    await echtWarten(GLEICHSTAND_TAKT_MS);
  }
}

function bisHeilungDieSperreFreigibt(verbindung, instanz) {
  return bisErfuellt(
    async () =>
      instanz.ausgabe().includes(HEILUNG_FERTIG) &&
      (await zaehleSperren(verbindung, `objsubid = ${ZWEI_SCHLUESSEL_FORM} AND granted`)) === 0,
    HEILUNG_FRIST_MS,
    "A hat geheilt, committet und die Startsperre freigegeben",
  );
}

function bisAmGleichstand(verbindung) {
  return bisErfuellt(
    async () => (await wartendeAufGleichstand(verbindung)) > 0,
    GLEICHSTAND_FRIST_MS,
    "B hat die Nummern geladen und wartet vor der Startsperre",
  );
}

function heilUmgebung(sms, vorfaelle) {
  return { TELNYX_API_KEY: "test", TELNYX_API_BASE: sms.url, PLATFORM_ALERT_SMS_TO: ALARM_ZIEL, BETTERSTACK_ALERT_URL: vorfaelle.url };
}

function sweepUmgebung(el, mandant) {
  return {
    ELEVENLABS_INBOUND_ENABLED: "true",
    ELEVENLABS_INBOUND_TENANT_IDS: mandant,
    ...EL_INBOUND_ACCESS_BOOT_ENV,
    ELEVENLABS_API_KEY: "test",
    ELEVENLABS_API_BASE: el.url,
    ELEVENLABS_AGENT_ID: AGENT_ID,
  };
}

test(
  "Heilung: A und B starten gleichzeitig auf leerer Datenbank, es entsteht ein Mandant und eine Alarm-SMS",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitRollenDatenbank(t, async (db) => {
      const sms = await starteSmsAttrappe(t);
      const vorfaelle = await starteVorfallAttrappe(t);
      await schemaVorbereiten(db, nummerEinfuegenAnhalten);
      const halter = await db.verbinden();
      await halter.query("SELECT pg_advisory_lock($1)", [HALTE_SCHLUESSEL]);
      const umgebung = heilUmgebung(sms, vorfaelle);
      const gleichstand = await gleichstandHerstellen(db);
      const instanzen = parallelStarten(t, db.adresse, [umgebung, umgebung]);
      const amGleichstand = await gleichstandFreigeben(gleichstand);
      await waitUntil(() => zaehleZeilen(instanzen, HEILUNG_UEBERSPRUNGEN) > 0, { timeoutMs: UEBERSPRINGEN_FRIST_MS }).catch(() => {});
      await halter.query("SELECT pg_advisory_unlock($1)", [HALTE_SCHLUESSEL]);
      await Promise.all(instanzen.map((instanz) => instanz.bereit));
      await echtWarten(NACHLAUF_FUER_ZWEITE_SMS_MS);
      const belege = `\nam Gleichstand: ${amGleichstand}\n${ausgaben(instanzen)}`;
      assert.equal(await zaehle(db, "tenant"), EINMAL, `genau ein Mandant${belege}`);
      assert.equal(await zaehle(db, "number"), EINMAL, `genau eine Nummer${belege}`);
      assert.equal(heilMeldungen(vorfaelle), EINMAL, `genau eine Alarm-Meldung${belege}`);
      assert.equal(zaehleZeilen(instanzen, HEILUNG_UEBERSPRUNGEN), EINMAL, `die andere Instanz meldet das Ueberspringen${belege}`);
    }),
);

test(
  "Heilung: B bekommt die Sperre erst nach dem Commit von A, mit leerem Start-Schnappschuss, und heilt nicht erneut",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitRollenDatenbank(t, async (db) => {
      const sms = await starteSmsAttrappe(t);
      const vorfaelle = await starteVorfallAttrappe(t);
      await schemaVorbereiten(db);
      const verwaltung = await db.verbinden();
      const umgebung = heilUmgebung(sms, vorfaelle);
      const gleichstand = await gleichstandHerstellen(db);
      const [b] = parallelStarten(t, db.adresse, [umgebung]);
      await bisAmGleichstand(gleichstand);
      b.anhalten();
      await gleichstand.query("COMMIT");
      const [a] = parallelStarten(t, db.adresse, [umgebung]);
      await bisHeilungDieSperreFreigibt(verwaltung, a);
      b.fortsetzen();
      await Promise.all([a.bereit, b.bereit]);
      await echtWarten(NACHLAUF_FUER_ZWEITE_SMS_MS);
      const belege = `\n${ausgaben([a, b])}`;
      assert.equal(await zaehle(db, "tenant"), EINMAL, `genau ein Mandant${belege}`);
      assert.equal(await zaehle(db, "number"), EINMAL, `genau eine Nummer${belege}`);
      assert.equal(heilMeldungen(vorfaelle), EINMAL, `genau eine Alarm-Meldung${belege}`);
      assert.ok(b.ausgabe().includes(HEILUNG_UEBERSPRUNGEN), `B meldet das Ueberspringen${belege}`);
    }),
);

test(
  "Heilung: unter der Sperre hat ein anderer Mandant schon Nummern, B mit leerem Schnappschuss heilt nicht",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitRollenDatenbank(t, async (db) => {
      const sms = await starteSmsAttrappe(t);
      const vorfaelle = await starteVorfallAttrappe(t);
      await schemaVorbereiten(db);
      const verwaltung = await db.verbinden();
      const gleichstand = await gleichstandHerstellen(db);
      const [b] = parallelStarten(t, db.adresse, [heilUmgebung(sms, vorfaelle)]);
      await bisAmGleichstand(gleichstand);
      await verwaltung.query(`INSERT INTO tenant (id, status) VALUES ($1, 'active')`, [FREMDER_MANDANT]);
      await nummernEinfuegen(verwaltung, FREMDER_MANDANT);
      await gleichstand.query("COMMIT");
      await bisErfuellt(async () => b.ausgabe().includes(HEILUNG_UEBERSPRUNGEN) || b.ausgabe().includes(HEILUNG_FERTIG), HEILUNG_FRIST_MS, "B entscheidet ueber die Heilung");
      await echtWarten(NACHLAUF_FUER_ZWEITE_SMS_MS);
      const belege = `\n${ausgaben([b])}`;
      assert.ok(b.ausgabe().includes(HEILUNG_UEBERSPRUNGEN), `B meldet das Ueberspringen${belege}`);
      assert.equal(await zaehle(db, "number"), DIDS.length, `nur die Nummern des anderen Mandanten${belege}`);
      assert.equal(heilMeldungen(vorfaelle), 0, `keine Alarm-Meldung${belege}`);
    }),
);

test(
  "Start-Sweep: B startet, waehrend der Sweep von A laeuft, und fragt keine Nummer ein zweites Mal ab",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitRollenDatenbank(t, async (db) => {
      const el = await starteElAttrappe(t);
      const mandant = await schemaVorbereiten(db, nummernEinfuegen);
      const umgebung = sweepUmgebung(el, mandant);
      const instanzen = parallelStarten(t, db.adresse, [umgebung, umgebung]);
      assert.deepEqual(
        await Promise.all(instanzen.map((instanz) => instanz.bereit)),
        [true, true],
        `beide Instanzen laufen:\n${instanzen.map((instanz) => instanz.ausgabe()).join("\n---\n")}`,
      );
      await waitUntil(() => zaehleZeilen(instanzen, "[el-trunk] sweep fertig") >= EINMAL, { timeoutMs: SWEEP_LAEUFT_FRIST_MS });
      assert.deepEqual([...el.abfragen].sort(), DIDS.map((did) => did.registrierung), "je aktiver Nummer genau eine Abfrage");
      assert.equal(zaehleZeilen(instanzen, SWEEP_UEBERSPRUNGEN), EINMAL, "die andere Instanz meldet das Ueberspringen");
    }),
);

test(
  "Startsperre: Zwei-Schluessel-Form, ein gehaltener Ein-Schluessel-Lock laesst den Sweep nicht ausfallen",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitRollenDatenbank(t, async (db) => {
      const el = await starteElAttrappe(t);
      const mandant = await schemaVorbereiten(db, nummernEinfuegen);
      const halter = await db.verbinden();
      for (const wert of ["anmeldung@example.test", mandant, "2"]) {
        await halter.query("SELECT pg_advisory_lock(hashtext($1))", [wert]);
      }
      const [instanz] = parallelStarten(t, db.adresse, [sweepUmgebung(el, mandant)]);
      assert.equal(await instanz.bereit, true, instanz.ausgabe());
      await waitUntil(() => el.abfragen.length > 0, { timeoutMs: SWEEP_LAEUFT_FRIST_MS });
      const { rows } = await halter.query(
        `SELECT 1 FROM pg_locks
          WHERE locktype = 'advisory' AND objsubid = ${ZWEI_SCHLUESSEL_FORM} AND granted
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
      );
      assert.equal(rows.length, EINMAL, "der Sweep haelt genau eine Sperre in der Zwei-Schluessel-Form");
      await waitUntil(() => instanz.ausgabe().includes("[el-trunk] sweep fertig"), { timeoutMs: SWEEP_LAEUFT_FRIST_MS });
      assert.deepEqual([...el.abfragen].sort(), DIDS.map((did) => did.registrierung), "je aktiver Nummer genau eine Abfrage");
    }),
);
