import assert from "node:assert/strict";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { startServer } from "../helpers.js";
import { echteDatenbank } from "../gemeinsam/echtes-postgres.js";
import { vorgaengerStarten } from "../gemeinsam/vorgaenger.js";
import { gemeinsameUmgebung } from "../gemeinsam/zwei-prozesse.js";
import { mandantenAbruf, postgresVorhanden } from "./hermes-mit-postgres.js";
import {
  kontoAdresse,
  mailsBis,
  meldeNichtZustandeGekommen,
  mitHermesMitMailUndNeustart,
  seedeAusgehendenAnruf,
  seedeNichtZustandeGekommenenAnruf,
  wartePruefendAufEnde,
} from "./hermes-mit-mail-neustart.js";

const HTTP_OK = 200;
const ZEITGRENZE_MS = 180_000;
const MS_PRO_MINUTE = 60_000;
const MINUTEN_PRO_STUNDE = 60;
const ENTPRELLUNG_INNERHALB_MIN = 10;
const ENTPRELLUNG_DARUEBER_MIN = 61;
const PLATTFORM_ADRESSE = "betreiber@mail-neustart.invalid";
const ANRUF_ERSTER = "call_mail_erster";
const ANRUF_ZWEITER = "call_mail_zweiter";
const ANRUF_DRITTER = "call_mail_dritter";
const ANRUF_VORAB = "call_mail_vorab";
const ERSTE_BENACHRICHTIGUNG = 1;
const ZWEITE_BENACHRICHTIGUNG = 2;
const ALARM_ENV = {
  OUTAGE_ALERT_WINDOW_MS: String(MINUTEN_PRO_STUNDE * MS_PRO_MINUTE),
  OUTAGE_ALERT_MIN_FAILURES: "2",
  OUTAGE_ALERT_RETRY_MS: "0",
  PLATFORM_ALERT_MAIL_TO: PLATTFORM_ADRESSE,
};

const MANDANT = Object.freeze({
  id: "tenant_mail_neustart",
  sub: "sub-mail-neustart",
  e164: "+4930555000201",
});

const KONTO = kontoAdresse(MANDANT);
const MAIL_BETREFF = "Anruf nicht zustande gekommen";
const MAIL_TEXT =
  "+4915112340101 (Status: failed, Grund: der Anruf konnte auf unserer Seite nicht aufgebaut werden)\n\n" +
  "Der Fehler lag auf unserer Seite, nicht bei dir. Wir kuemmern uns darum; du kannst es spaeter erneut versuchen.";

const vorMinuten = (minuten) => new Date(Date.now() - minuten * MS_PRO_MINUTE).toISOString();
const endeSetzen = (anruf, minuten) => (sql) =>
  sql("UPDATE call SET ended_at = $2 WHERE id = $1", [anruf, vorMinuten(minuten)]);

function mitMail(t, optionen, lauf) {
  return mitHermesMitMailUndNeustart(t, { mandanten: [MANDANT], ...optionen }, lauf);
}

async function ersteMeldungMitMail(hermes, anruf = ANRUF_ERSTER) {
  await seedeAusgehendenAnruf(hermes.sql, { id: anruf, mandant: MANDANT });
  await meldeNichtZustandeGekommen(hermes.srv, anruf);
  await mailsBis(hermes.mail, KONTO, 1);
  await wartePruefendAufEnde(hermes.sql, anruf, ERSTE_BENACHRICHTIGUNG);
}

test(
  "S2: nach versendeter Mail und Neustart löst die erneute Meldung desselben Anrufs keine zweite Mail aus",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitMail(t, {}, async (hermes) => {
      await ersteMeldungMitMail(hermes);
      await hermes.neustart();
      await meldeNichtZustandeGekommen(hermes.srv, ANRUF_ERSTER);
      await wartePruefendAufEnde(hermes.sql, ANRUF_ERSTER, ZWEITE_BENACHRICHTIGUNG);
      assert.equal(hermes.mail.an(KONTO).length, 1);
      const { rows } = await hermes.sql("SELECT not_placed_mail_sent_at FROM call WHERE id = $1", [
        ANRUF_ERSTER,
      ]);
      assert.ok(rows[0].not_placed_mail_sent_at, "der Marker steht nach dem Versand am Anruf");
    });
  },
);

test(
  "B1: scheitert der erste Versand, kommt die Mail nach Neustart und erneuter Meldung genau einmal",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitMail(t, {}, async (hermes) => {
      hermes.mail.lehneNaechsteAb();
      await seedeAusgehendenAnruf(hermes.sql, { id: ANRUF_ERSTER, mandant: MANDANT });
      await meldeNichtZustandeGekommen(hermes.srv, ANRUF_ERSTER);
      await wartePruefendAufEnde(hermes.sql, ANRUF_ERSTER, ERSTE_BENACHRICHTIGUNG);
      assert.equal(hermes.mail.versuche(), 1);
      assert.equal(hermes.mail.an(KONTO).length, 0);
      await hermes.neustart();
      await meldeNichtZustandeGekommen(hermes.srv, ANRUF_ERSTER);
      await mailsBis(hermes.mail, KONTO, 1);
      await wartePruefendAufEnde(hermes.sql, ANRUF_ERSTER, ZWEITE_BENACHRICHTIGUNG);
      assert.equal(hermes.mail.an(KONTO).length, 1);
    });
  },
);

test(
  "B2: ein zweiter Anruf 10 Minuten nach dem ersten bringt keine weitere Mail",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitMail(t, {}, async (hermes) => {
      await ersteMeldungMitMail(hermes);
      await seedeAusgehendenAnruf(hermes.sql, { id: ANRUF_ZWEITER, mandant: MANDANT });
      await hermes.neustart(endeSetzen(ANRUF_ERSTER, ENTPRELLUNG_INNERHALB_MIN));
      await meldeNichtZustandeGekommen(hermes.srv, ANRUF_ZWEITER);
      await wartePruefendAufEnde(hermes.sql, ANRUF_ZWEITER, ERSTE_BENACHRICHTIGUNG);
      assert.equal(hermes.mail.an(KONTO).length, 1);
    });
  },
);

test(
  "B2: ein dritter Anruf 61 Minuten nach dem ersten bringt eine weitere Mail",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitMail(t, {}, async (hermes) => {
      await ersteMeldungMitMail(hermes);
      await seedeAusgehendenAnruf(hermes.sql, { id: ANRUF_DRITTER, mandant: MANDANT });
      await hermes.neustart(endeSetzen(ANRUF_ERSTER, ENTPRELLUNG_DARUEBER_MIN));
      await meldeNichtZustandeGekommen(hermes.srv, ANRUF_DRITTER);
      await mailsBis(hermes.mail, KONTO, 2);
      await wartePruefendAufEnde(hermes.sql, ANRUF_DRITTER, ERSTE_BENACHRICHTIGUNG);
      assert.equal(hermes.mail.an(KONTO).length, 2);
    });
  },
);

test(
  "B3: der Alarm an die Plattform-Adresse geht auch für einen erneut gemeldeten Anruf mit gesetztem Marker raus",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitMail(t, { env: ALARM_ENV }, async (hermes) => {
      await ersteMeldungMitMail(hermes);
      const { rows } = await hermes.sql("SELECT ended_at FROM call WHERE id = $1", [ANRUF_ERSTER]);
      const endedAt = new Date(Date.parse(rows[0].ended_at) - MS_PRO_MINUTE).toISOString();
      await hermes.neustart((sql) =>
        seedeNichtZustandeGekommenenAnruf(sql, { id: ANRUF_VORAB, mandant: MANDANT, endedAt }),
      );
      await meldeNichtZustandeGekommen(hermes.srv, ANRUF_ERSTER);
      await mailsBis(hermes.mail, PLATTFORM_ADRESSE, 1);
      assert.equal(hermes.mail.an(PLATTFORM_ADRESSE).length, 1);
    });
  },
);

test(
  "B4/B6: die Anrufansicht verbirgt den Marker, der Mailtext bleibt, die Migration 0006 steht in schema_migrations",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitMail(t, {}, async (hermes) => {
      await ersteMeldungMitMail(hermes);
      await hermes.neustart();
      const antwort = await mandantenAbruf(hermes.srv, MANDANT.sub).hole(
        `/api/calls/${ANRUF_ERSTER}`,
      );
      assert.equal(antwort.status, HTTP_OK);
      const anruf = await antwort.json();
      assert.equal(anruf.status, "failed");
      assert.equal("notPlacedMailSentAt" in anruf, false);
      const [mail] = hermes.mail.an(KONTO);
      assert.equal(mail.betreff, MAIL_BETREFF);
      assert.equal(mail.text, MAIL_TEXT);
      const { rows } = await hermes.sql(
        "SELECT version::text AS version, name FROM schema_migrations WHERE version = 6",
      );
      assert.deepEqual(rows, [{ version: "6", name: "0006_not_placed_mail_marker" }]);
    });
  },
);

async function schemaAbbild(db) {
  const verbindung = await db.verbinden();
  const { rows } = await verbindung.query(
    "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name",
  );
  return rows;
}

test(
  "B5: der Vorgängerstand startet gegen die neu migrierte Datenbank, das Schema bleibt dabei gleich",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    let neu = null;
    t.after(() => neu?.stop());
    const db = await echteDatenbank(t);
    if (!db) return;
    neu = await startServer({ env: gemeinsameUmgebung(db.adresse, {}) });
    const schemaVorher = await schemaAbbild(db);
    assert.ok(
      schemaVorher.some(
        (s) => s.table_name === "call" && s.column_name === "not_placed_mail_sent_at",
      ),
      "die neue Version migriert die Spalte",
    );
    const vorgaenger = await vorgaengerStarten(t, { adresse: db.adresse, env: {} });
    const healthz = await abrufMitFrist(`${vorgaenger.localUrl}/healthz`);
    assert.equal(healthz.status, HTTP_OK);
    assert.deepEqual(await schemaAbbild(db), schemaVorher);
  },
);
