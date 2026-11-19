import { test } from "node:test";
import assert from "node:assert/strict";

import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const NEWSLETTER_SQL = `SELECT newsletter_consent, newsletter_consent_at, newsletter_recipients, newsletter_confirm_mail_log FROM tenant WHERE id = $1`;
const JETZT = "2026-11-19T10:00:00.000Z";
const ABLAUF = "2026-11-20T10:00:00.000Z";

function runnerFuer(db, vorQuery = () => {}) {
  const client = {
    query: async (text, params) => {
      await vorQuery(text);
      return db.query(text, params);
    },
    exec: (sql) => db.exec(sql),
  };
  return { withClient: (fn) => fn(client) };
}

async function instanz(runner) {
  const speicher = makePgStoreMitSperre(runner);
  await speicher.init();
  return speicher;
}

const gemeinsam = await pgliteAlsRolleOhneSuperuser();
await instanz(runnerFuer(gemeinsam));
let laufendeNummer = 0;

async function zweiInstanzen(vorQuery) {
  laufendeNummer += 1;
  const tenant = `t_news_${laufendeNummer}`;
  await gemeinsam.query(`INSERT INTO tenant (id, status, country) VALUES ($1, 'active', 'DE')`, [tenant]);
  const a = await instanz(runnerFuer(gemeinsam));
  const b = await instanz(runnerFuer(gemeinsam, vorQuery));
  return { a, b, tenant };
}


const zeile = async (tenantId) => (await gemeinsam.query(NEWSLETTER_SQL, [tenantId])).rows[0];

test("Entfernen einer unbekannten Adresse durch eine veraltete Instanz überschreibt die Empfänger der anderen nicht", async () => {
  const { a, b, tenant } = await zweiInstanzen();

  a.addNewsletterRecipient(tenant, {
    email: "cc@example.com",
    tokenHash: "hash-1",
    tokenExpiresAt: ABLAUF,
    unsubToken: "unsub-1",
    now: JETZT,
  });
  await a.drainFlushes();
  const entfernt = b.removeNewsletterRecipient(tenant, "unbekannt@example.com");
  await b.drainFlushes();

  assert.equal(entfernt, false);
  const stand = await zeile(tenant);
  assert.equal(stand.newsletter_recipients.length, 1);
  assert.equal(stand.newsletter_recipients[0].email, "cc@example.com");
});
