import { test } from "node:test";
import assert from "node:assert/strict";

import { BASE_ENV, tempDataDir } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID, makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

Object.assign(process.env, BASE_ENV, { DATA_DIR: tempDataDir(), STORE_BACKEND: "json" });

const store = await import("../../src/store.js");
const { speicherBereiche } = store;
await store.oeffneSpeicher();

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

const empfaenger = (email, tenant, { now = JETZT, ablauf = ABLAUF } = {}) => ({
  email,
  tokenHash: `${tenant}-hash-${email}`,
  tokenExpiresAt: ablauf,
  unsubToken: `${tenant}-unsub-${email}`,
  now,
});

async function eintragen(speicher, tenant, { email, ...zeiten }) {
  speicher.addNewsletterRecipient(tenant, empfaenger(email, tenant, zeiten));
  await speicher.drainFlushes();
}

test("Kriterium 1: A trägt X ein, B (veraltet) trägt Y ein: beide stehen in der Zeile", async () => {
  const { a, b, tenant } = await zweiInstanzen();

  await eintragen(a, tenant, { email: "x@example.com" });
  await eintragen(b, tenant, { email: "y@example.com" });

  assert.deepEqual(await adressen(tenant), ["x@example.com", "y@example.com"]);
  const [x, y] = await eintraege(tenant);
  assert.equal(x.status, "pending");
  assert.equal(y.tokenHash, `${tenant}-hash-y@example.com`);
});

test("Kriterium 2: B (veraltet) bestätigt Ys Token, X bleibt in der Zeile", async () => {
  const { a, b, tenant, bereichB } = await zweiInstanzen();
  await eintragen(a, tenant, { email: "x@example.com" });
  await eintragen(b, tenant, { email: "y@example.com" });

  const ergebnis = await bereichB.confirmNewsletterRecipientByToken(`${tenant}-hash-y@example.com`, SPAETER);
  await b.drainFlushes();

  assert.deepEqual(ergebnis, { tenantId: tenant, email: "y@example.com" });
  const [x, y] = await eintraege(tenant);
  assert.deepEqual([x.email, x.status], ["x@example.com", "pending"]);
  assert.deepEqual([y.email, y.status, y.confirmedAt, y.tokenHash, y.tokenExpiresAt], ["y@example.com", "confirmed", SPAETER, null, null]);
});

test("Kriterium 2: B bestätigt den nur auf A eingetragenen Token von X", async () => {
  const { a, b, tenant, bereichB } = await zweiInstanzen();
  await eintragen(a, tenant, { email: "x@example.com" });

  const ergebnis = await bereichB.confirmNewsletterRecipientByToken(`${tenant}-hash-x@example.com`, SPAETER);
  await b.drainFlushes();

  assert.deepEqual(ergebnis, { tenantId: tenant, email: "x@example.com" });
  const [x] = await eintraege(tenant);
  assert.deepEqual([x.status, x.confirmedAt], ["confirmed", SPAETER]);
});

test("Kriterium 3: B (veraltet) meldet X per Abmelde-Token ab, andere bleiben", async () => {
  const { a, b, tenant, bereichB } = await zweiInstanzen();
  await eintragen(a, tenant, { email: "x@example.com" });
  await eintragen(a, tenant, { email: "z@example.com" });
  await eintragen(b, tenant, { email: "y@example.com" });

  const ergebnis = await bereichB.unsubscribeNewsletterRecipientByToken(`${tenant}-unsub-x@example.com`);
  await b.drainFlushes();

  assert.deepEqual(ergebnis, { tenantId: tenant, email: "x@example.com" });
  assert.deepEqual(await adressen(tenant), ["z@example.com", "y@example.com"]);
});

test("Kriterium 4: B (veraltet) entfernt X, bei A eingetragenes Z bleibt", async () => {
  const { a, b, tenant, bereichB } = await zweiInstanzen();
  await eintragen(a, tenant, { email: "x@example.com" });
  await eintragen(a, tenant, { email: "z@example.com" });

  const entfernt = await bereichB.removeNewsletterRecipient(tenant, "x@example.com");
  await b.drainFlushes();

  assert.equal(entfernt, true);
  assert.deepEqual(await adressen(tenant), ["z@example.com"]);
});

test("Kriterium 5: das Mail-Log enthält beide Zeitstempel, Einträge älter als 24 Stunden fallen weg", async () => {
  const { a, b, tenant } = await zweiInstanzen();

  await eintragen(a, tenant, { email: "alt@example.com", now: ALT });
  await eintragen(a, tenant, { email: "x@example.com", now: JETZT });
  await eintragen(b, tenant, { email: "y@example.com", now: SPAETER });

  assert.deepEqual((await zeile(tenant)).newsletter_confirm_mail_log, [JETZT, SPAETER]);
});

test("Kriterium 6: unbekannter und abgelaufener Token liefern null, unbekannte Adresse false, die Zeile bleibt", async () => {
  const { a, b, tenant, bereichB } = await zweiInstanzen();
  await eintragen(a, tenant, { email: "x@example.com", ablauf: ABGELAUFEN });
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
  await eintragen(a, tenant, { email: "x@example.com" });

  await b.newsletterAbgleichen();

  assert.deepEqual(b.tenantNewsletterRecipients(tenant).map((eintrag) => eintrag.email), ["y@example.com"]);
  await b.drainFlushes();
  assert.deepEqual(await adressen(tenant), ["x@example.com", "y@example.com"]);
});

test("der Abgleich übernimmt die Liste aus der Zeile in die Kopie, auch das Mail-Log", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  await eintragen(a, tenant, { email: "x@example.com" });

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

  await eintragen(b, tenant, { email: "y@example.com" });

  assert.ok(
    fehlerausgabe.mock.calls.some(
      (aufruf) =>
        aufruf.arguments[0] === "[pg] mandant-sperre schreiben fehlgeschlagen:" &&
        aufruf.arguments[1] === "Mandant nicht in der Datenbank",
    ),
  );
});

test("die Kopie entscheidet zuerst, nur ein Fehlschlag gleicht mit der Zeile ab und fragt dann noch einmal", async () => {
  const aufrufe = [];
  const antworten = { entfernen: [false, true, true], bestaetigen: [null, { tenantId: "t", email: "a@example.com" }], abmelden: [null, null] };
  const speicher = {
    newsletterAbgleichen: async () => aufrufe.push("abgleichen"),
    removeNewsletterRecipient: () => (aufrufe.push("entfernen"), antworten.entfernen.shift()),
    confirmNewsletterRecipientByToken: () => (aufrufe.push("bestaetigen"), antworten.bestaetigen.shift()),
    unsubscribeNewsletterRecipientByToken: () => (aufrufe.push("abmelden"), antworten.abmelden.shift()),
  };
  const { newsletter } = speicherBereiche(speicher);

  assert.equal(await newsletter.removeNewsletterRecipient("t", "a@example.com"), true);
  assert.deepEqual(aufrufe.splice(0), ["entfernen", "abgleichen", "entfernen"]);
  assert.equal(await newsletter.removeNewsletterRecipient("t", "a@example.com"), true);
  assert.deepEqual(aufrufe.splice(0), ["entfernen"]);
  assert.deepEqual(await newsletter.confirmNewsletterRecipientByToken("h", JETZT), { tenantId: "t", email: "a@example.com" });
  assert.deepEqual(aufrufe.splice(0), ["bestaetigen", "abgleichen", "bestaetigen"]);
  assert.equal(await newsletter.unsubscribeNewsletterRecipientByToken("u"), null);
  assert.deepEqual(aufrufe.splice(0), ["abmelden", "abgleichen", "abmelden"]);
});

test("ein Speicher ohne Abgleich (JSON) entscheidet nur über die eigene Kopie", async () => {
  const aufrufe = [];
  const speicher = {
    removeNewsletterRecipient: () => (aufrufe.push("entfernen"), false),
    confirmNewsletterRecipientByToken: () => (aufrufe.push("bestaetigen"), null),
    unsubscribeNewsletterRecipientByToken: () => (aufrufe.push("abmelden"), null),
  };
  const { newsletter } = speicherBereiche(speicher);

  assert.equal(await newsletter.removeNewsletterRecipient("t", "a@example.com"), false);
  assert.equal(await newsletter.confirmNewsletterRecipientByToken("h", JETZT), null);
  assert.equal(await newsletter.unsubscribeNewsletterRecipientByToken("u"), null);
  assert.deepEqual(aufrufe, ["entfernen", "bestaetigen", "abmelden"]);
});

test("JSON-Speicher über die Fassade: unbekannter Token und unbekannte Adresse liefern null und false statt zu werfen", async () => {
  const newsletter = store.speicherBereiche(store).newsletter;

  assert.equal(await newsletter.confirmNewsletterRecipientByToken("unbekannt", JETZT), null);
  assert.equal(await newsletter.unsubscribeNewsletterRecipientByToken("unbekannt"), null);
  assert.equal(await newsletter.removeNewsletterRecipient(BOOTSTRAP_TENANT_ID, "niemand@example.com"), false);
});

test("ein gelungenes Schreiben der Liste bleibt ohne Fehler im Log", async (t) => {
  const { b, tenant } = await zweiInstanzen();
  const fehlerausgabe = t.mock.method(console, "error", () => {});

  await eintragen(b, tenant, { email: "y@example.com" });

  assert.equal(fehlerausgabe.mock.calls.length, 0);
  assert.equal(await b.newsletterAbgleichen(), undefined);
  assert.deepEqual(b.tenantNewsletterRecipients(tenant).map((eintrag) => eintrag.email), ["y@example.com"]);
});

test("der Abgleich wartet, bis ein laufendes Schreiben der Liste fertig ist, und liest erst danach", async () => {
  laufendeNummer += 1;
  const tenant = `t_liste_${laufendeNummer}`;
  await gemeinsam.query("INSERT INTO tenant (id, status, country) VALUES ($1, 'active', 'DE')", [tenant]);
  let schreibenBegonnen = false;
  let beimLesenBegonnen = null;
  const b = await instanz(gemeinsam, async (text) => {
    if (/^UPDATE tenant SET newsletter_recipients = /.test(text)) {
      for (let runde = 0; runde < 200; runde += 1) await Promise.resolve();
      schreibenBegonnen = true;
    }
    if (/^SELECT id, newsletter_recipients/.test(text)) beimLesenBegonnen = schreibenBegonnen;
  });

  b.addNewsletterRecipient(tenant, empfaenger("y@example.com", tenant));
  await b.newsletterAbgleichen();

  assert.equal(beimLesenBegonnen, true);
});
