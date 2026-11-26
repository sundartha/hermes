import { test } from "node:test";
import assert from "node:assert/strict";

import { BASE_ENV, tempDataDir } from "../helpers.js";
import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

Object.assign(process.env, BASE_ENV, { DATA_DIR: tempDataDir(), STORE_BACKEND: "json" });

const { speicherBereiche } = await import("../../src/store.js");

const JETZT = "2026-11-19T10:00:00.000Z";
const ABLAUF = "2026-11-20T10:00:00.000Z";

const gemeinsam = await pgliteAlsRolleOhneSuperuser();
const gelesen = [];

function runnerFuer(db, mitschnitt) {
  const client = {
    query: async (text, params) => {
      if (mitschnitt && /^\s*SELECT/i.test(text) && text.includes("newsletter_recipients")) mitschnitt.push({ text, params });
      return db.query(text, params);
    },
    exec: (sql) => db.exec(sql),
  };
  return { withClient: (fn) => fn(client) };
}

async function instanz(mitschnitt) {
  const speicher = makePgStoreMitSperre(runnerFuer(gemeinsam, mitschnitt));
  await speicher.init();
  return speicher;
}

await instanz();
await gemeinsam.query("INSERT INTO tenant (id, status, country) VALUES ('t_zeile_a', 'active', 'DE'), ('t_zeile_b', 'active', 'DE')");
const veraltet = await instanz(gelesen);
const schreiber = await instanz();

const eintrag = (kennung) => ({ email: `${kennung}@example.com`, tokenHash: `hash-${kennung}`, tokenExpiresAt: ABLAUF, unsubToken: `unsub-${kennung}`, now: JETZT });
schreiber.addNewsletterRecipient("t_zeile_a", eintrag("a"));
schreiber.addNewsletterRecipient("t_zeile_b", eintrag("b"));
await schreiber.drainFlushes();

const newsletter = speicherBereiche(veraltet).newsletter;
const kopie = (tenantId) => veraltet.tenantNewsletterRecipients(tenantId).length;

test("Entfernen mit Fehlschlag auf der Kopie liest nur die Zeile des Mandanten und findet den Eintrag der anderen Instanz", async () => {
  gelesen.length = 0;

  const entfernt = await newsletter.removeNewsletterRecipient("t_zeile_a", "a@example.com");

  assert.equal(entfernt, true);
  assert.equal(gelesen.length, 1);
  assert.match(gelesen[0].text, /WHERE id = \$1/);
  assert.deepEqual(gelesen[0].params, ["t_zeile_a"]);
  assert.equal(kopie("t_zeile_b"), 0);
});

test("Bestätigen mit Fehlschlag auf der Kopie liest nur Zeilen mit dem Token und bestätigt den Eintrag der anderen Instanz", async () => {
  gelesen.length = 0;

  const ergebnis = await newsletter.confirmNewsletterRecipientByToken("hash-b", JETZT);

  assert.deepEqual(ergebnis, { tenantId: "t_zeile_b", email: "b@example.com" });
  assert.equal(gelesen.length, 1);
  assert.match(gelesen[0].text, /tokenHash/);
  assert.deepEqual(gelesen[0].params, ["hash-b"]);
});

test("Abmelden mit Fehlschlag auf der Kopie liest nur Zeilen mit dem Abmelde-Token und meldet den Eintrag der anderen Instanz ab", async () => {
  schreiber.addNewsletterRecipient("t_zeile_a", eintrag("c"));
  await schreiber.drainFlushes();
  gelesen.length = 0;

  const ergebnis = await newsletter.unsubscribeNewsletterRecipientByToken("unsub-c");

  assert.deepEqual(ergebnis, { tenantId: "t_zeile_a", email: "c@example.com" });
  assert.equal(gelesen.length, 1);
  assert.match(gelesen[0].text, /unsubToken/);
  assert.deepEqual(gelesen[0].params, ["unsub-c"]);
});

test("ein unbekannter Token übernimmt keine fremden Mandantenlisten in die Kopie", async () => {
  schreiber.addNewsletterRecipient("t_zeile_a", eintrag("d"));
  await schreiber.drainFlushes();
  const vorher = kopie("t_zeile_a");
  gelesen.length = 0;

  assert.equal(await newsletter.confirmNewsletterRecipientByToken("geraten", JETZT), null);
  assert.equal(await newsletter.unsubscribeNewsletterRecipientByToken("geraten"), null);

  assert.equal(gelesen.length, 2);
  assert.equal(kopie("t_zeile_a"), vorher);
});
