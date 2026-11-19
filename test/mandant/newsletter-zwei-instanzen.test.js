import { test } from "node:test";
import assert from "node:assert/strict";

import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const SCHREIBFEHLER_LOG = "[pg] mandant-sperre schreiben fehlgeschlagen:";
const NEWSLETTER_SQL = `SELECT newsletter_consent, newsletter_consent_at, newsletter_recipients, newsletter_confirm_mail_log FROM tenant WHERE id = $1`;
const JETZT = "2026-11-19T10:00:00.000Z";
const SPAETER = "2026-11-19T11:00:00.000Z";
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
const empfaenger = (email, token, unsub) => ({
  email,
  tokenHash: token,
  tokenExpiresAt: ABLAUF,
  unsubToken: unsub,
  now: JETZT,
});

test("Kriterium 1: Einwilligung von A und Empfänger von B stehen nach den letzten Flushs beide in der Zeile", async () => {
  const { a, b, tenant } = await zweiInstanzen();

  a.setNewsletterConsent(tenant, true);
  await a.drainFlushes();
  b.addNewsletterRecipient(tenant, empfaenger("cc@example.com", "hash-1", "unsub-1"));
  await b.drainFlushes();
  a.save();
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();

  const stand = await zeile(tenant);
  assert.equal(stand.newsletter_consent, true);
  assert.match(stand.newsletter_consent_at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(stand.newsletter_recipients.length, 1);
  assert.equal(stand.newsletter_recipients[0].email, "cc@example.com");
  assert.deepEqual(stand.newsletter_confirm_mail_log, [JETZT]);
});

test("Kriterium 2: ein letzter Flush einer veralteten Instanz setzt Einwilligung, Empfänger und Mail-Log nicht zurück", async () => {
  const { a, b, tenant } = await zweiInstanzen();

  a.setNewsletterConsent(tenant, true);
  a.addNewsletterRecipient(tenant, empfaenger("cc@example.com", "hash-1", "unsub-1"));
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();

  const stand = await zeile(tenant);
  assert.equal(stand.newsletter_consent, true);
  assert.notEqual(stand.newsletter_consent_at, null);
  assert.equal(stand.newsletter_recipients[0].email, "cc@example.com");
  assert.deepEqual(stand.newsletter_confirm_mail_log, [JETZT]);
});

test("Kriterium 2: der Widerruf der Einwilligung überlebt den letzten Flush einer veralteten Instanz", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  a.setNewsletterConsent(tenant, true);
  await a.drainFlushes();

  a.setNewsletterConsent(tenant, false);
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();

  assert.equal((await zeile(tenant)).newsletter_consent, false);
});

test("Kriterium 3: Bestätigen, Entfernen und Abmelden per Token schreiben die Empfängerliste gezielt", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  a.addNewsletterRecipient(tenant, empfaenger("eins@example.com", `${tenant}-hash-1`, `${tenant}-unsub-1`));
  a.addNewsletterRecipient(tenant, empfaenger("zwei@example.com", `${tenant}-hash-2`, `${tenant}-unsub-2`));
  a.addNewsletterRecipient(tenant, empfaenger("drei@example.com", `${tenant}-hash-3`, `${tenant}-unsub-3`));
  await a.drainFlushes();

  const bestaetigt = a.confirmNewsletterRecipientByToken(`${tenant}-hash-1`, SPAETER);
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();
  assert.deepEqual(bestaetigt, { tenantId: tenant, email: "eins@example.com" });
  const nachBestaetigung = (await zeile(tenant)).newsletter_recipients;
  assert.equal(nachBestaetigung[0].status, "confirmed");
  assert.equal(nachBestaetigung[0].confirmedAt, SPAETER);

  const abgemeldet = a.unsubscribeNewsletterRecipientByToken(`${tenant}-unsub-2`);
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();
  assert.deepEqual(abgemeldet, { tenantId: tenant, email: "zwei@example.com" });
  assert.deepEqual(
    (await zeile(tenant)).newsletter_recipients.map((eintrag) => eintrag.email),
    ["eins@example.com", "drei@example.com"],
  );

  assert.equal(a.removeNewsletterRecipient(tenant, "drei@example.com"), true);
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();
  assert.deepEqual(
    (await zeile(tenant)).newsletter_recipients.map((eintrag) => eintrag.email),
    ["eins@example.com"],
  );
});

test("Kriterium 3: ein Token ohne Treffer und ein unbekannter Empfänger schreiben nichts", async (t) => {
  const { a, tenant } = await zweiInstanzen();
  a.addNewsletterRecipient(tenant, empfaenger("eins@example.com", "hash-1", "unsub-1"));
  await a.drainFlushes();
  const fehlerausgabe = t.mock.method(console, "error", () => {});
  const anfragen = t.mock.method(a, "stammdatenSchreiben");

  assert.equal(a.confirmNewsletterRecipientByToken("falsch", SPAETER), null);
  assert.equal(a.unsubscribeNewsletterRecipientByToken("falsch"), null);
  assert.equal(a.removeNewsletterRecipient(tenant, "niemand@example.com"), false);
  await a.drainFlushes();

  assert.equal(fehlerausgabe.mock.calls.length, 0);
  assert.equal((await zeile(tenant)).newsletter_recipients.length, 1);
  assert.equal(anfragen.mock.calls.length, 0);
});

const SCHREIBWEGE = [
  ["Einwilligung", /^UPDATE tenant SET newsletter_consent = /, (speicher, tenant) => speicher.setNewsletterConsent(tenant, true)],
  [
    "Empfänger",
    /^UPDATE tenant SET newsletter_recipients = /,
    (speicher, tenant) => speicher.addNewsletterRecipient(tenant, empfaenger("cc@example.com", "hash-1", "unsub-1")),
  ],
];

for (const [name, muster, setzen] of SCHREIBWEGE) {
  test(`Kriterium 4: scheitert das gezielte Schreiben von ${name}, steht der Fehler im Log und der Aufrufer bekommt keinen`, async (t) => {
    const zustand = { kaputt: false };
    const { b, tenant } = await zweiInstanzen((text) => {
      if (zustand.kaputt && muster.test(text)) throw new Error("Datenbank weg");
    });
    const fehlerausgabe = t.mock.method(console, "error", () => {});

    zustand.kaputt = true;
    await setzen(b, tenant);
    await b.drainFlushes();

    assert.ok(
      fehlerausgabe.mock.calls.some(
        (aufruf) => aufruf.arguments[0] === SCHREIBFEHLER_LOG && aufruf.arguments[1] === "Datenbank weg",
      ),
    );
  });
}
