import { test } from "node:test";
import assert from "node:assert/strict";

import { speicherBereiche } from "../../src/store.js";
import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const LISTE_SQL = "SELECT newsletter_recipients, newsletter_confirm_mail_log FROM tenant WHERE id = $1";
const ALT = "2026-11-17T09:00:00.000Z";
const JETZT = "2026-11-19T10:00:00.000Z";
const SPAETER = "2026-11-19T11:00:00.000Z";
const ABLAUF = "2026-11-20T10:00:00.000Z";
const ABGELAUFEN = "2026-11-19T10:30:00.000Z";

const runner = (db, vorQuery = () => {}) => ({
  withClient: (fn) =>
    fn({
      query: async (text, params) => {
        await vorQuery(text);
        return db.query(text, params);
      },
      exec: (sql) => db.exec(sql),
    }),
});

async function instanz(db, vorQuery) {
  const speicher = makePgStoreMitSperre(runner(db, vorQuery));
  await speicher.init();
  return speicher;
}

const gemeinsam = await pgliteAlsRolleOhneSuperuser();
await instanz(gemeinsam);
let laufendeNummer = 0;

async function zweiInstanzen() {
  laufendeNummer += 1;
  const tenant = `t_liste_${laufendeNummer}`;
  await gemeinsam.query("INSERT INTO tenant (id, status, country) VALUES ($1, 'active', 'DE')", [tenant]);
  const a = await instanz(gemeinsam);
  const b = await instanz(gemeinsam);
  return { a, b, tenant, bereichB: speicherBereiche(b).newsletter };
}

const zeile = async (tenantId) => (await gemeinsam.query(LISTE_SQL, [tenantId])).rows[0];
const eintraege = async (tenantId) => (await zeile(tenantId)).newsletter_recipients;
const adressen = async (tenantId) => (await eintraege(tenantId)).map((eintrag) => eintrag.email);

const empfaenger = (email, tenant, now = JETZT, ablauf = ABLAUF) => ({
  email,
  tokenHash: `${tenant}-hash-${email}`,
  tokenExpiresAt: ablauf,
  unsubToken: `${tenant}-unsub-${email}`,
  now,
});

async function eintragen(speicher, tenant, email, now, ablauf) {
  speicher.addNewsletterRecipient(tenant, empfaenger(email, tenant, now, ablauf));
  await speicher.drainFlushes();
}

test("Kriterium 1: A trägt X ein, B (veraltet) trägt Y ein: beide stehen in der Zeile", async () => {
  const { a, b, tenant } = await zweiInstanzen();

  await eintragen(a, tenant, "x@example.com");
  await eintragen(b, tenant, "y@example.com");

  assert.deepEqual(await adressen(tenant), ["x@example.com", "y@example.com"]);
  const [x, y] = await eintraege(tenant);
  assert.equal(x.status, "pending");
  assert.equal(y.tokenHash, `${tenant}-hash-y@example.com`);
});

test("Kriterium 2: B (veraltet) bestätigt Ys Token, X bleibt in der Zeile", async () => {
  const { a, b, tenant, bereichB } = await zweiInstanzen();
  await eintragen(a, tenant, "x@example.com");
  await eintragen(b, tenant, "y@example.com");

  const ergebnis = await bereichB.confirmNewsletterRecipientByToken(`${tenant}-hash-y@example.com`, SPAETER);
  await b.drainFlushes();

  assert.deepEqual(ergebnis, { tenantId: tenant, email: "y@example.com" });
  const [x, y] = await eintraege(tenant);
  assert.deepEqual([x.email, x.status], ["x@example.com", "pending"]);
  assert.deepEqual([y.email, y.status, y.confirmedAt, y.tokenHash, y.tokenExpiresAt], ["y@example.com", "confirmed", SPAETER, null, null]);
});

test("Kriterium 2: B bestätigt den nur auf A eingetragenen Token von X", async () => {
  const { a, b, tenant, bereichB } = await zweiInstanzen();
  await eintragen(a, tenant, "x@example.com");

  const ergebnis = await bereichB.confirmNewsletterRecipientByToken(`${tenant}-hash-x@example.com`, SPAETER);
  await b.drainFlushes();

  assert.deepEqual(ergebnis, { tenantId: tenant, email: "x@example.com" });
  const [x] = await eintraege(tenant);
  assert.deepEqual([x.status, x.confirmedAt], ["confirmed", SPAETER]);
});

test("Kriterium 3: B (veraltet) meldet X per Abmelde-Token ab, andere bleiben", async () => {
  const { a, b, tenant, bereichB } = await zweiInstanzen();
  await eintragen(a, tenant, "x@example.com");
  await eintragen(a, tenant, "z@example.com");
  await eintragen(b, tenant, "y@example.com");

  const ergebnis = await bereichB.unsubscribeNewsletterRecipientByToken(`${tenant}-unsub-x@example.com`);
  await b.drainFlushes();

  assert.deepEqual(ergebnis, { tenantId: tenant, email: "x@example.com" });
  assert.deepEqual(await adressen(tenant), ["z@example.com", "y@example.com"]);
});

test("Kriterium 4: B (veraltet) entfernt X, bei A eingetragenes Z bleibt", async () => {
  const { a, b, tenant, bereichB } = await zweiInstanzen();
  await eintragen(a, tenant, "x@example.com");
  await eintragen(a, tenant, "z@example.com");

  const entfernt = await bereichB.removeNewsletterRecipient(tenant, "x@example.com");
  await b.drainFlushes();

  assert.equal(entfernt, true);
  assert.deepEqual(await adressen(tenant), ["z@example.com"]);
});

test("Kriterium 5: das Mail-Log enthält beide Zeitstempel, Einträge älter als 24 Stunden fallen weg", async () => {
  const { a, b, tenant } = await zweiInstanzen();

  await eintragen(a, tenant, "alt@example.com", ALT);
  await eintragen(a, tenant, "x@example.com", JETZT);
  await eintragen(b, tenant, "y@example.com", SPAETER);

  assert.deepEqual((await zeile(tenant)).newsletter_confirm_mail_log, [JETZT, SPAETER]);
});

test("Kriterium 6: unbekannter und abgelaufener Token liefern null, unbekannte Adresse false, die Zeile bleibt", async () => {
  const { a, b, tenant, bereichB } = await zweiInstanzen();
  await eintragen(a, tenant, "x@example.com", JETZT, ABGELAUFEN);
  const vorher = await zeile(tenant);

  assert.equal(await bereichB.confirmNewsletterRecipientByToken("unbekannt", SPAETER), null);
  assert.equal(await bereichB.confirmNewsletterRecipientByToken(`${tenant}-hash-x@example.com`, ABLAUF), null);
  assert.equal(await bereichB.unsubscribeNewsletterRecipientByToken("unbekannt"), null);
  assert.equal(await bereichB.removeNewsletterRecipient(tenant, "niemand@example.com"), false);
  await b.drainFlushes();

  assert.deepEqual(await zeile(tenant), vorher);
});

test("eine Eintragung, die während des Abgleichs beginnt, bleibt in der Kopie der Instanz stehen", async () => {
  laufendeNummer += 1;
  const tenant = `t_liste_${laufendeNummer}`;
  await gemeinsam.query("INSERT INTO tenant (id, status, country) VALUES ($1, 'active', 'DE')", [tenant]);
  const a = await instanz(gemeinsam);
  let b;
  const lesend = (text) => {
    if (/^SELECT id, newsletter_recipients/.test(text)) b.addNewsletterRecipient(tenant, empfaenger("y@example.com", tenant));
  };
  b = await instanz(gemeinsam, lesend);
  await eintragen(a, tenant, "x@example.com");

  await b.newsletterAbgleichen();

  assert.deepEqual(b.tenantNewsletterRecipients(tenant).map((eintrag) => eintrag.email), ["y@example.com"]);
  await b.drainFlushes();
  assert.deepEqual(await adressen(tenant), ["x@example.com", "y@example.com"]);
});

test("der Abgleich übernimmt die Liste aus der Zeile in die Kopie, auch das Mail-Log", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  await eintragen(a, tenant, "x@example.com");

  await b.newsletterAbgleichen();

  assert.deepEqual(b.tenantNewsletterRecipients(tenant).map((eintrag) => eintrag.email), ["x@example.com"]);
  assert.equal(b.dailyNewsletterConfirmMailCount(tenant, JETZT), 1);
});

test("verschwindet der Mandant vor dem Schreiben, steht der Fehler im Log und der Aufrufer bekommt keinen", async (t) => {
  laufendeNummer += 1;
  const tenant = `t_liste_${laufendeNummer}`;
  await gemeinsam.query("INSERT INTO tenant (id, status, country) VALUES ($1, 'active', 'DE')", [tenant]);
  const b = await instanz(gemeinsam, async (text) => {
    if (/^UPDATE tenant SET newsletter_recipients = /.test(text)) await gemeinsam.query("DELETE FROM tenant WHERE id = $1", [tenant]);
  });
  const fehlerausgabe = t.mock.method(console, "error", () => {});

  await eintragen(b, tenant, "y@example.com");

  assert.ok(
    fehlerausgabe.mock.calls.some(
      (aufruf) =>
        aufruf.arguments[0] === "[pg] mandant-sperre schreiben fehlgeschlagen:" &&
        aufruf.arguments[1] === "Mandant nicht in der Datenbank",
    ),
  );
});

test("ein Speicher ohne Abgleich (JSON) entscheidet weiter über die eigene Kopie", async () => {
  const aufrufe = [];
  const speicher = {
    removeNewsletterRecipient: (tenantId, email) => aufrufe.push(["entfernen", tenantId, email]) && true,
    confirmNewsletterRecipientByToken: (hash, jetzt) => aufrufe.push(["bestaetigen", hash, jetzt]) && null,
    unsubscribeNewsletterRecipientByToken: (token) => aufrufe.push(["abmelden", token]) && null,
  };
  const { newsletter } = speicherBereiche(speicher);

  assert.equal(await newsletter.removeNewsletterRecipient("t", "a@example.com"), true);
  assert.equal(await newsletter.confirmNewsletterRecipientByToken("h", JETZT), null);
  assert.equal(await newsletter.unsubscribeNewsletterRecipientByToken("u"), null);
  assert.deepEqual(aufrufe, [["entfernen", "t", "a@example.com"], ["bestaetigen", "h", JETZT], ["abmelden", "u"]]);
});
