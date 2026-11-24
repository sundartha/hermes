import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { STRIPE_ROUTEN_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";
import { fakeProvisioner } from "../helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { legeMandantAn, makePgStore, makePgTestStore } from "../pg-helpers.js";
import { makeStripeWebhookRoute } from "../../src/routes/stripe-webhook.ts";
import { TAUSCH_ERGEBNIS } from "../../src/store.js";
import { syncPlatformBindings } from "../../src/store/state-ops.js";
import { runNummerntausch } from "../../src/worker/nummerntausch.ts";

const KUNDE = "t_pnu_kunde";
const ABO = "sub_pnu_kunde";
const KUNDEN_NUMMER = "+4930555000881";
const ANDERE_NUMMER = "+4930555000882";
const NEUE_NUMMER = "+4930555000883";
const ERSATZ = "+12025550881";
const ZWECK_ANI = "ani_override";
const ALARM_ZWECK = "alert_sms_sender";
const BINDUNG_ABFRAGE = "SELECT id, purpose, released_at IS NULL AS offen FROM platform_number_use ORDER BY id";
const GESCHLOSSEN_ZEIT = "2026-11-24T10:00:00.000Z";
const MS_JE_SEKUNDE = 1_000;
const JETZT_MS = Date.parse("2026-11-24T10:00:00.000Z");
const NUMMERN_OBERGRENZE = 50;
const KONFIGURATION = withConfigNamespaces({
  provisioningEnabled: true,
  maxNumbers: NUMMERN_OBERGRENZE,
  maxNumbersPerTenant: 1,
  paymentEnabled: true,
});

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

const schliessen = (db, id) =>
  db.query(`UPDATE platform_number_use SET released_at = $1 WHERE id = $2`, [GESCHLOSSEN_ZEIT, id]);

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

function aboEnde() {
  const koerper = JSON.stringify({
    id: "evt_pnu_kunde",
    type: "customer.subscription.deleted",
    created: JETZT_MS / MS_JE_SEKUNDE,
    data: { object: { id: ABO, metadata: { tenant_ref: KUNDE } } },
  });
  const zeit = JETZT_MS / MS_JE_SEKUNDE;
  const mac = createHmac("sha256", STRIPE_ROUTEN_GEHEIMNIS).update(`${zeit}.${koerper}`).digest("hex");
  return { headers: { "Content-Type": "application/json", "stripe-signature": `t=${zeit},v1=${mac}` }, body: koerper };
}

async function kuendigen(t, store) {
  t.mock.timers.enable({ apis: ["Date"], now: JETZT_MS });
  store.setTenantSubscription(KUNDE, { subscriptionId: ABO, cancelAtPeriodEnd: true });
  const provisioner = fakeProvisioner();
  const handler = makeStripeWebhookRoute({
    config: withConfigNamespaces({ paymentEnabled: true, stripeWebhookSecret: STRIPE_ROUTEN_GEHEIMNIS }),
    store,
    audit: () => {},
    accounts: { setStatus: async () => {} },
    sessions: { invalidateByTenant: async () => {} },
    billing: {},
    provision: async () => {},
    numberProvisioner: provisioner,
    workos: null,
    auditStore: { record: () => Promise.resolve() },
  });
  const anfrage = aboEnde();
  const antwort = { status: () => antwort, json: () => antwort };
  await handler({ headers: anfrage.headers, rawBody: Buffer.from(anfrage.body) }, antwort);
  await store.drainFlushes();
  const mandant = store.load().tenants.find((eintrag) => eintrag.id === KUNDE);
  return { freigaben: provisioner.log.filter((zeile) => zeile.startsWith("release:")), mandant };
}

test("Eine Bindung, die Instanz A in der Tabelle setzt, haelt die Freigabe beim Vertragsende auf Instanz B ohne Neustart", async (t) => {
  const { b, db } = await zweiInstanzen();
  const nummer = nummerAnlegen(b);
  await bindungAnlegen(db, { id: "pnu_von_a", e164: KUNDEN_NUMMER });
  const { freigaben, mandant } = await kuendigen(t, b);
  assert.deepEqual(freigaben, []);
  assert.equal(mandant.numberReleasePending, true);
  assert.equal(nummer.status, "active");
});

test("Eine Bindung, die Instanz A geloest hat, haelt die Freigabe beim Vertragsende auf Instanz B nicht mehr auf", async (t) => {
  const { b, db } = await zweiInstanzen({ vorherBindungen: [{ id: "pnu_alt", e164: KUNDEN_NUMMER }] });
  nummerAnlegen(b);
  await b.plattformBindungenNachladen();
  const [geladen] = b.load().platformNumberUse;
  assert.equal(geladen.releasedAt, null);
  await schliessen(db, "pnu_alt");
  const { freigaben, mandant } = await kuendigen(t, b);
  assert.deepEqual(freigaben, [`release:ext_${KUNDEN_NUMMER}`]);
  assert.equal(mandant.numberReleasePending, false);
  assert.equal(geladen.releasedAt, GESCHLOSSEN_ZEIT);
});

test("Die Freigabe beim Vertragsende schliesst nur die eigene Bindung der Nummer in der Tabelle, eine fremde bleibt offen", async (t) => {
  const { b, db } = await zweiInstanzen();
  nummerAnlegen(b);
  await bindungAnlegen(db, { id: "pnu_eigen", e164: KUNDEN_NUMMER, tenantId: KUNDE });
  await bindungAnlegen(db, { id: "pnu_fremd", e164: ANDERE_NUMMER });
  const { freigaben } = await kuendigen(t, b);
  assert.deepEqual(freigaben, [`release:ext_${KUNDEN_NUMMER}`]);
  assert.deepEqual((await db.query(BINDUNG_ABFRAGE)).rows, [
    { id: "pnu_eigen", purpose: ZWECK_ANI, offen: false },
    { id: "pnu_fremd", purpose: ZWECK_ANI, offen: true },
  ]);
});

test("Ist die Tabelle der Bindungen nicht lesbar, bleibt die Nummer beim Vertragsende beim Anbieter", async (t) => {
  const { b, db } = await zweiInstanzen();
  const nummer = nummerAnlegen(b);
  await db.exec("ALTER TABLE platform_number_use RENAME TO platform_number_use_weg");
  const meldungen = [];
  const geloggt = console.error;
  console.error = (...teile) => meldungen.push(teile[0]);
  let ergebnis;
  try {
    ergebnis = await kuendigen(t, b);
  } finally {
    console.error = geloggt;
    await db.exec("ALTER TABLE platform_number_use_weg RENAME TO platform_number_use");
  }
  assert.deepEqual(ergebnis.freigaben, []);
  assert.equal(nummer.status, "active");
  assert.ok(meldungen.includes("[pg] plattform-nummern fehlgeschlagen:"), String(meldungen));
});

function tauschFuer(store, { vorRegistrierung = async () => {} } = {}) {
  nummerAnlegen(store);
  const freigaben = [];
  const ergebnisse = [];
  const anbieter = {
    searchNumbers: async () => [{ e164: ERSATZ }],
    orderNumber: async ({ e164 }) => ({ e164, providerNumberId: "ext_pnu_neu" }),
    releaseNumber: async (id) => freigaben.push(id),
  };
  const sipRegistrar = {
    ensureRegistration: async ({ numberId }) => {
      await vorRegistrierung();
      return { phoneNumberId: `phnum_${numberId}`, angelegt: true };
    },
  };
  const logger = { log: (zeile) => ergebnisse.push(zeile), warn() {}, error() {} };
  const lauf = runNummerntausch({
    store,
    config: KONFIGURATION,
    numberProvisioning: () => anbieter,
    sipRegistrar,
    inboundTrunkSchreiber: null,
    audit: { record: () => Promise.resolve() },
    logger,
  });
  return { lauf, freigaben, ergebnis: () => ergebnisse.find((zeile) => zeile.includes("ergebnis=")) };
}

test("Eine Bindung, die Instanz A mitten im Tausch setzt, haelt die Freigabe der alten Nummer unter der Sperre auf", async () => {
  const { b, db } = await zweiInstanzen();
  const { lauf, freigaben, ergebnis } = tauschFuer(b, {
    vorRegistrierung: () => bindungAnlegen(db, { id: "pnu_spaet", e164: KUNDEN_NUMMER }),
  });
  await lauf;
  assert.deepEqual(freigaben, []);
  assert.ok(ergebnis().endsWith(`ergebnis=${TAUSCH_ERGEBNIS.FREIGABE_FEHLGESCHLAGEN}`), ergebnis());
});

test("Ohne Bindung in der Tabelle gibt der Tausch die alte Nummer frei", async () => {
  const { b } = await zweiInstanzen();
  const { lauf, freigaben, ergebnis } = tauschFuer(b);
  await lauf;
  assert.deepEqual(freigaben, [`ext_${KUNDEN_NUMMER}`]);
  assert.ok(ergebnis().endsWith(`ergebnis=${TAUSCH_ERGEBNIS.GETAUSCHT}`), ergebnis());
});

test("Nachladen uebernimmt die Bindung einer anderen Instanz mit allen Feldern in den Spiegel", async () => {
  const { b, db } = await zweiInstanzen();
  await bindungAnlegen(db, { id: "pnu_von_a", e164: KUNDEN_NUMMER });
  await b.plattformBindungenNachladen();
  const [gelesen] = b.load().platformNumberUse;
  assert.deepEqual({ ...gelesen, boundAt: typeof gelesen.boundAt }, {
    id: "pnu_von_a", e164: KUNDEN_NUMMER, purpose: ZWECK_ANI, provider: "telnyx", tenantId: null,
    providerNumberId: null, boundAt: "string", releasedAt: null, note: null,
  });
});

test("Speichern auf Instanz B oeffnet eine Bindung nicht wieder, die Instanz A geschlossen hat", async () => {
  const { b, db } = await zweiInstanzen({ vorherBindungen: [{ id: "pnu_alt", e164: KUNDEN_NUMMER }] });
  await b.plattformBindungenNachladen();
  await schliessen(db, "pnu_alt");
  await b.plattformBindungenSchreiben();
  b.save();
  await b.drainFlushes();
  assert.deepEqual((await db.query(BINDUNG_ABFRAGE)).rows, [{ id: "pnu_alt", purpose: ZWECK_ANI, offen: false }]);
});

const alarmWunsch = (e164) => [{ purpose: ALARM_ZWECK, e164, provider: "telnyx" }];

test("Ableiten legt die Bindung in der Tabelle an und gibt die offenen Bindungen zurueck", async () => {
  const { b, db } = await zweiInstanzen();
  const offene = await b.mitPlattformBindungen(() => syncPlatformBindings(b.load(), alarmWunsch(KUNDEN_NUMMER)));
  assert.deepEqual(offene.map((bindung) => bindung.purpose), [ALARM_ZWECK]);
  const zeilen = (await db.query(BINDUNG_ABFRAGE)).rows;
  assert.deepEqual(zeilen.map((zeile) => [zeile.purpose, zeile.offen]), [[ALARM_ZWECK, true]]);
});

test("Ableiten uebernimmt die offene Bindung einer anderen Instanz statt eine zweite anzulegen", async () => {
  const { b, db } = await zweiInstanzen();
  await bindungAnlegen(db, { id: "pnu_alarm_a", e164: KUNDEN_NUMMER, purpose: ALARM_ZWECK });
  const offene = await b.mitPlattformBindungen(() => syncPlatformBindings(b.load(), alarmWunsch(KUNDEN_NUMMER)));
  assert.deepEqual(offene.map((bindung) => bindung.id), ["pnu_alarm_a"]);
  assert.deepEqual((await db.query(BINDUNG_ABFRAGE)).rows, [{ id: "pnu_alarm_a", purpose: ALARM_ZWECK, offen: true }]);
});

test("Wechselt die Nummer, schliesst das Ableiten die alte Bindung in der Tabelle und legt die neue an", async () => {
  const { b, db } = await zweiInstanzen({
    vorherBindungen: [{ id: "pnu_alarm_alt", e164: KUNDEN_NUMMER, purpose: ALARM_ZWECK }],
  });
  await b.mitPlattformBindungen(() => syncPlatformBindings(b.load(), alarmWunsch(NEUE_NUMMER)));
  const alarm = (
    await db.query(`SELECT id, e164, released_at IS NULL AS offen FROM platform_number_use ORDER BY e164`)
  ).rows;
  assert.deepEqual(
    alarm.map((zeile) => [zeile.id, zeile.e164, zeile.offen]),
    [
      ["pnu_alarm_alt", KUNDEN_NUMMER, false],
      [alarm[1].id, NEUE_NUMMER, true],
    ],
  );
});
