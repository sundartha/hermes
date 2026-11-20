import { test } from "node:test";
import assert from "node:assert/strict";

import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const NEWSLETTER_SQL = `SELECT newsletter_recipients FROM tenant WHERE id = $1`;
const SCHREIBEN = /^UPDATE tenant SET newsletter_/;
const JETZT = "2026-11-19T10:00:00.000Z";
const ABLAUF = "2026-11-20T10:00:00.000Z";

function runnerFuer(db, vorQuery) {
  const client = {
    query: async (text, params) => {
      vorQuery(text);
      return db.query(text, params);
    },
    exec: (sql) => db.exec(sql),
  };
  return { withClient: (fn) => fn(client) };
}

test("ein Token ohne Treffer und ein unbekannter Empfänger setzen keine Newsletter-Schreibanfrage ab, ein echter Empfänger schon", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const tenant = "t_news_ohne_treffer";
  await makePgStoreMitSperre(runnerFuer(db, () => {})).init();
  await db.query(`INSERT INTO tenant (id, status, country) VALUES ($1, 'active', 'DE')`, [tenant]);
  const zaehler = { treffer: 0 };
  const speicher = makePgStoreMitSperre(runnerFuer(db, (text) => (zaehler.treffer += SCHREIBEN.test(text) ? 1 : 0)));
  await speicher.init();

  assert.equal(zaehler.treffer, 0);
  speicher.addNewsletterRecipient(tenant, {
    email: "eins@example.com",
    tokenHash: "hash-1",
    tokenExpiresAt: ABLAUF,
    unsubToken: "unsub-1",
    now: JETZT,
  });
  await speicher.drainFlushes();
  assert.ok(zaehler.treffer >= 1);

  zaehler.treffer = 0;
  assert.equal(speicher.confirmNewsletterRecipientByToken("falsch", JETZT), null);
  assert.equal(speicher.unsubscribeNewsletterRecipientByToken("falsch"), null);
  assert.equal(speicher.removeNewsletterRecipient(tenant, "niemand@example.com"), false);
  await speicher.drainFlushes();

  assert.equal(zaehler.treffer, 0);
  const stand = await db.query(NEWSLETTER_SQL, [tenant]);
  const liste = stand.rows[0].newsletter_recipients;
  assert.equal(liste.length, 1);
});
