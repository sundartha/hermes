import assert from "node:assert/strict";
import { test } from "node:test";

import * as boot from "../../src/boot.js";
import { releaseTenantNumbersOnErase, runReleaseReconcile } from "../../src/release-reconcile.ts";
import { legeMandantAn, makePgStore, makePgTestStore, BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";

const KUNDE = "t_pnu_kunde";
const KUNDEN_NUMMER = "+4930555000881";
const ANDERE_NUMMER = "+4930555000882";
const NEUE_ALARM_NUMMER = "+4930555000883";
const ALARM_ZWECK = "alert_sms_sender";
const HALT_ZWECK = "bootstrap_number_hold";
const ZWECK_ANI = "ani_override";
const BINDUNG_ABFRAGE = "SELECT id, purpose, released_at IS NULL AS offen FROM platform_number_use ORDER BY id";
const GESCHLOSSEN_ZEIT = "2026-11-24T10:00:00.000Z";

async function zweiInstanzen({ vorherBindungen = [] } = {}) {
  const { store: b, runner, db } = await makePgTestStore();
  await legeMandantAn(b, KUNDE);
  for (const bindung of vorherBindungen) await bindungAnlegen(db, bindung);
  await b.init();
  const a = makePgStore(runner);
  await a.init();
  return { a, b, db };
}

function bindungAnlegen(db, { id, e164, purpose = ZWECK_ANI, tenantId = null }) {
  return db.query(
    `INSERT INTO platform_number_use (id, e164, purpose, provider, tenant_id) VALUES ($1, $2, $3, 'telnyx', $4)`,
    [id, e164, purpose, tenantId],
  );
}

const nummerAnlegen = (store, e164 = KUNDEN_NUMMER) => {
  const nummer = {
    id: `n_${e164}`,
    tenantId: KUNDE,
    status: "active",
    provider: "telnyx",
    providerNumberId: `ext_${e164}`,
    e164,
    country: "DE",
    language: "de",
    paymentIntentId: null,
  };
  store.load().numbers.push(nummer);
  return nummer;
};

async function freigebenBeiLoeschung(store) {
  const freigaben = [];
  const ergebnis = await releaseTenantNumbersOnErase({
    store,
    provisioner: { releaseNumber: async (id) => freigaben.push(id) },
    audit: { record: () => Promise.resolve() },
    logger: { log() {}, warn() {}, error() {} },
    tenantId: KUNDE,
  });
  await store.drainFlushes();
  return { ergebnis, freigaben };
}

const alarmNummerAnlegen = (store, e164) =>
  store.load().numbers.push({
    id: `n_alarm_${e164}`,
    tenantId: BOOTSTRAP_TENANT_ID,
    status: "active",
    provider: "telnyx",
    providerNumberId: `ext_alarm_${e164}`,
    e164,
  });

test("Eine Bindung, die Instanz A speichert, haelt die Freigabe der Nummer auf Instanz B ohne Neustart", async () => {
  const { b, db } = await zweiInstanzen();
  const nummer = nummerAnlegen(b);
  await bindungAnlegen(db, { id: "pnu_von_a", e164: KUNDEN_NUMMER });
  const { ergebnis, freigaben } = await freigebenBeiLoeschung(b);
  assert.deepEqual(freigaben, []);
  assert.deepEqual(ergebnis, { released: 0, aborted: 1 });
  assert.equal(nummer.status, "active");
  const [gelesen] = b.load().platformNumberUse;
  assert.deepEqual({ ...gelesen, boundAt: typeof gelesen.boundAt }, {
    id: "pnu_von_a", e164: KUNDEN_NUMMER, purpose: ZWECK_ANI, provider: "telnyx", tenantId: null,
    providerNumberId: null, boundAt: "string", releasedAt: null, note: null,
  });
});

test("Ist die Tabelle der Bindungen nicht lesbar, wird keine Nummer beim Anbieter freigegeben", async () => {
  const { b, db } = await zweiInstanzen();
  nummerAnlegen(b);
  await db.exec("ALTER TABLE platform_number_use RENAME TO platform_number_use_weg");
  const meldungen = [];
  const geloggt = console.error;
  console.error = (...teile) => meldungen.push(teile[0]);
  const freigaben = [];
  try {
    await assert.rejects(
      releaseTenantNumbersOnErase({
        store: b,
        provisioner: { releaseNumber: async (id) => freigaben.push(id) },
        audit: { record: () => Promise.resolve() },
        logger: { log() {}, warn() {}, error() {} },
        tenantId: KUNDE,
      }),
      /platform_number_use/,
    );
  } finally {
    console.error = geloggt;
    await db.exec("ALTER TABLE platform_number_use_weg RENAME TO platform_number_use");
  }
  assert.deepEqual(freigaben, []);
  assert.ok(meldungen.includes("[pg] plattform-nummern fehlgeschlagen:"), String(meldungen));
});

test("Eine Bindung, die Instanz A geloest hat, haelt die Freigabe auf Instanz B nicht mehr auf", async () => {
  const { b, db } = await zweiInstanzen({ vorherBindungen: [{ id: "pnu_alt", e164: KUNDEN_NUMMER }] });
  nummerAnlegen(b);
  await b.plattformBindungenNachladen();
  const [geladen] = b.load().platformNumberUse;
  assert.equal(geladen.releasedAt, null);
  await db.query(`UPDATE platform_number_use SET released_at = $1 WHERE id = 'pnu_alt'`, [GESCHLOSSEN_ZEIT]);
  const { ergebnis, freigaben } = await freigebenBeiLoeschung(b);
  assert.deepEqual(freigaben, [`ext_${KUNDEN_NUMMER}`]);
  assert.deepEqual(ergebnis, { released: 1, aborted: 0 });
  const [gelesen] = b.load().platformNumberUse;
  assert.equal(gelesen.releasedAt, GESCHLOSSEN_ZEIT);
});

test("Die Freigabe schliesst nur die eigene Bindung der Nummer in der Tabelle, eine fremde bleibt offen", async () => {
  const { b, db } = await zweiInstanzen();
  nummerAnlegen(b);
  await bindungAnlegen(db, { id: "pnu_eigen", e164: KUNDEN_NUMMER, tenantId: KUNDE });
  await bindungAnlegen(db, { id: "pnu_fremd", e164: ANDERE_NUMMER });
  const { ergebnis } = await freigebenBeiLoeschung(b);
  assert.deepEqual(ergebnis, { released: 1, aborted: 0 });
  assert.deepEqual((await db.query(BINDUNG_ABFRAGE)).rows, [
    { id: "pnu_eigen", purpose: ZWECK_ANI, offen: false },
    { id: "pnu_fremd", purpose: ZWECK_ANI, offen: true },
  ]);
});

test("Speichern auf Instanz B oeffnet eine Bindung nicht wieder, die Instanz A geschlossen hat", async () => {
  const { b, db } = await zweiInstanzen({ vorherBindungen: [{ id: "pnu_alt", e164: KUNDEN_NUMMER }] });
  await db.query(`UPDATE platform_number_use SET released_at = $1 WHERE id = 'pnu_alt'`, [GESCHLOSSEN_ZEIT]);
  b.save();
  await b.drainFlushes();
  assert.deepEqual((await db.query(BINDUNG_ABFRAGE)).rows, [{ id: "pnu_alt", purpose: ZWECK_ANI, offen: false }]);
});

test("Der Start legt die Bindungen der Bootstrap-Nummer in der Tabelle an", async () => {
  const { b, db } = await zweiInstanzen();
  alarmNummerAnlegen(b, KUNDEN_NUMMER);
  const offene = await boot.bindungenAbleiten({ store: b });
  await b.drainFlushes();
  assert.deepEqual(offene.map((bindung) => bindung.purpose).sort(), [ALARM_ZWECK, HALT_ZWECK]);
  const zeilen = (await db.query(BINDUNG_ABFRAGE)).rows;
  assert.deepEqual(zeilen.map((zeile) => [zeile.purpose, zeile.offen]).sort(), [
    [ALARM_ZWECK, true],
    [HALT_ZWECK, true],
  ]);
});

test("Der Start uebernimmt die offene Bindung einer anderen Instanz statt eine zweite anzulegen", async () => {
  const { b, db } = await zweiInstanzen();
  alarmNummerAnlegen(b, KUNDEN_NUMMER);
  await bindungAnlegen(db, { id: "pnu_alarm_a", e164: KUNDEN_NUMMER, purpose: ALARM_ZWECK });
  const offene = await boot.bindungenAbleiten({ store: b });
  await b.drainFlushes();
  assert.ok(offene.some((bindung) => bindung.id === "pnu_alarm_a"));
  const alarm = (await db.query(BINDUNG_ABFRAGE)).rows.filter((zeile) => zeile.purpose === ALARM_ZWECK);
  assert.deepEqual(alarm, [{ id: "pnu_alarm_a", purpose: ALARM_ZWECK, offen: true }]);
});

test("Wechselt die Bootstrap-Nummer, schliesst der Start die alte Bindung in der Tabelle und legt die neue an", async () => {
  const { b, db } = await zweiInstanzen({
    vorherBindungen: [{ id: "pnu_alarm_alt", e164: KUNDEN_NUMMER, purpose: ALARM_ZWECK }],
  });
  alarmNummerAnlegen(b, NEUE_ALARM_NUMMER);
  await boot.bindungenAbleiten({ store: b });
  await b.drainFlushes();
  const alarm = (
    await db.query(
      `SELECT id, e164, released_at IS NULL AS offen FROM platform_number_use WHERE purpose = $1 ORDER BY e164`,
      [ALARM_ZWECK],
    )
  ).rows;
  assert.deepEqual(
    alarm.map((zeile) => [zeile.id, zeile.e164, zeile.offen]),
    [
      ["pnu_alarm_alt", KUNDEN_NUMMER, false],
      [alarm[1].id, NEUE_ALARM_NUMMER, true],
    ],
  );
});

test("Eine Bindung, die Instanz A erst nach der Auswahl setzt, haelt die Freigabe unter der Sperre noch auf", async () => {
  const { b, db } = await zweiInstanzen();
  const nummer = nummerAnlegen(b);
  const lauf = freigebenBeiLoeschung(b);
  await bindungAnlegen(db, { id: "pnu_spaet", e164: KUNDEN_NUMMER });
  const { ergebnis, freigaben } = await lauf;
  assert.deepEqual(freigaben, []);
  assert.deepEqual(ergebnis, { released: 0, aborted: 1 });
  assert.equal(nummer.status, "active");
});

test("Der Freigabe-Lauf nimmt eine Nummer, deren Bindung Instanz A inzwischen geloest hat, in die Auswahl", async () => {
  const { b, db } = await zweiInstanzen({ vorherBindungen: [{ id: "pnu_alt", e164: KUNDEN_NUMMER }] });
  nummerAnlegen(b);
  const mandant = b.load().tenants.find((eintrag) => eintrag.id === KUNDE);
  Object.assign(mandant, { status: "suspended", suspendedAt: "2026-01-01T00:00:00.000Z" });
  await b.plattformBindungenNachladen();
  await db.query(`UPDATE platform_number_use SET released_at = $1 WHERE id = 'pnu_alt'`, [GESCHLOSSEN_ZEIT]);
  const freigaben = [];
  const ergebnis = await runReleaseReconcile({
    store: b,
    provisioner: { releaseNumber: async (id) => freigaben.push(id) },
    audit: { record: () => Promise.resolve() },
    logger: { log() {}, warn() {}, error() {} },
    nowMs: Date.parse("2026-11-24T00:00:00.000Z"),
    graceMs: 1000,
  });
  assert.deepEqual(ergebnis, { released: 1, aborted: 0, observed: 0 });
  assert.deepEqual(freigaben, [`ext_${KUNDEN_NUMMER}`]);
});
