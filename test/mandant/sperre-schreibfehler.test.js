import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FRIST_SQL,
  HTTP_OK,
  HTTP_UNAVAILABLE,
  NICHT_GESCHRIEBEN,
  SCHREIBFEHLER_LOG,
  SPAETERE_SPERRE,
  TENANT,
  UNBEKANNTER_MANDANT,
  ZAHLUNGSSPERRE,
  ZAHLUNG_OFFEN,
  pausiertEreignis,
  protokolliert,
  schreibenKaputtBei,
  sperreVon,
  sperreZeile,
  webhookAntwort,
  zweiInstanzen,
} from "./sperre-hilfe.js";

test("Schreibfehler: fehlt der Mandant in der Datenbank, bekommt der Aufrufer den Fehler", async (t) => {
  const { db, b } = await zweiInstanzen();
  const fehlerausgabe = t.mock.method(console, "error", () => {});
  await db.query(`DELETE FROM tenant WHERE id = $1`, [TENANT]);

  await assert.rejects(b.setBillingHold(TENANT, { reason: ZAHLUNGSSPERRE }), NICHT_GESCHRIEBEN);

  assert.ok(protokolliert(fehlerausgabe, SCHREIBFEHLER_LOG, "Mandant nicht in der Datenbank"));
});

test("Schreiben: eine Sperre fuer einen Mandanten, den keine Instanz kennt, schreibt nichts und wirft nicht", async () => {
  const { db, b } = await zweiInstanzen();

  await b.setBillingHold(UNBEKANNTER_MANDANT, { reason: ZAHLUNGSSPERRE });

  assert.equal((await db.query(`SELECT id FROM tenant WHERE id = $1`, [UNBEKANNTER_MANDANT])).rows.length, 0);
});

test("Schreibfehler: scheitert das Schreiben einer Zahlungssperre, bekommt der Aufrufer den Fehler und die Kopie bleibt gesperrt", async (t) => {
  const zustand = { kaputt: false };
  const { db, b } = await zweiInstanzen(undefined, schreibenKaputtBei(zustand));
  const fehlerausgabe = t.mock.method(console, "error", () => {});
  await sperreVon(b);

  zustand.kaputt = true;
  await assert.rejects(b.setBillingHold(TENANT, { reason: ZAHLUNGSSPERRE }), NICHT_GESCHRIEBEN);
  zustand.kaputt = false;

  assert.equal(b.billingHoldActive(TENANT), ZAHLUNGSSPERRE, "die Kopie entsperrt nicht");
  assert.equal((await sperreZeile(db)).stripe_billing_hold, null);
  assert.ok(protokolliert(fehlerausgabe, SCHREIBFEHLER_LOG, "Datenbank weg"), "der Fehler steht im Log");
  await sperreVon(b);
  assert.equal(b.billingHoldActive(TENANT), ZAHLUNGSSPERRE, "auch nach dem naechsten Lesen bleibt die Kopie gesperrt");
});

test("Schreibfehler: scheitert das Schreiben einer Suspendierung, bekommt der Aufrufer den Fehler", async () => {
  const zustand = { kaputt: false };
  const { b } = await zweiInstanzen(undefined, schreibenKaputtBei(zustand));

  zustand.kaputt = true;
  await assert.rejects(b.setSuspendedAtIfAbsent(TENANT));
  zustand.kaputt = false;

  assert.ok(b.tenantSuspendedAt(TENANT), "die Kopie behaelt die Suspendierung");
});

test("Schreibfehler: scheitert das Schreiben der Zahlungssperre aus einem Stripe-Ereignis, antwortet der Webhook 503 und protokolliert die Ereignis-ID", async (t) => {
  const zustand = { kaputt: false };
  const { db, b } = await zweiInstanzen(undefined, schreibenKaputtBei(zustand));
  const fehlerausgabe = t.mock.method(console, "error", () => {});

  zustand.kaputt = true;
  const antwort = await webhookAntwort(b, pausiertEreignis("evt_sperre_kaputt", TENANT));
  zustand.kaputt = false;

  assert.equal(antwort.status, HTTP_UNAVAILABLE, "Stripe stellt das Ereignis erneut zu");
  assert.deepEqual(antwort.koerper, { error: "event not applied" });
  assert.ok(protokolliert(fehlerausgabe, "event=evt_sperre_kaputt"), "das Log nennt die Ereignis-ID");
  assert.equal(b.billingHoldActive(TENANT), ZAHLUNGSSPERRE);
  assert.equal((await sperreZeile(db)).stripe_billing_hold, null);

  const erneut = await webhookAntwort(b, pausiertEreignis("evt_sperre_kaputt", TENANT));
  assert.equal(erneut.status, HTTP_OK, "die erneute Zustellung wird angewendet");
  assert.equal((await sperreZeile(db)).stripe_billing_hold, ZAHLUNGSSPERRE);
});

test("Kriterium 15: eine Zahlung, die eine Aktion verlangt, schreibt die Sperre mit Frist in die Datenbank", async () => {
  const { db, b } = await zweiInstanzen();

  const antwort = await webhookAntwort(b, pausiertEreignis("evt_sperre_frist", TENANT, ZAHLUNG_OFFEN));

  assert.equal(antwort.status, HTTP_OK);
  const { rows } = await db.query(FRIST_SQL, [TENANT]);
  assert.equal(rows[0].stripe_billing_hold, SPAETERE_SPERRE);
  assert.ok(rows[0].stripe_billing_hold_due_at, "die Frist steht in der Datenbank");
});
