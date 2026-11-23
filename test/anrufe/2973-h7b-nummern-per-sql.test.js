import assert from "node:assert/strict";
import { test } from "node:test";

import { TAUSCH_ERGEBNIS } from "../../src/store.js";
import { runNummerntausch } from "../../src/worker/nummerntausch.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { legeMandantAn, makePgStore, makePgTestStore } from "../pg-helpers.js";

const KUNDE = "t_h7b_kunde";
const FREMD = "t_h7b_fremd";
const NUMMER = "+4930555000771";
const ANDERE_NUMMER = "+4930555000772";
const GEGENSTELLE = "+4915112349971";
const LESEFEHLER = /call/;

async function zweiInstanzen() {
  const { store: b, runner, db } = await makePgTestStore();
  await legeMandantAn(b, KUNDE);
  await legeMandantAn(b, FREMD);
  await b.init();
  const a = makePgStore(runner);
  await a.init();
  return { a, b, db };
}

async function aktiverAnruf(store, { tenantId = KUNDE, from = NUMMER, to = GEGENSTELLE } = {}) {
  const call = store.createCall({ direction: "outbound", from, to, goal: "Test", tenantId, provider: "telnyx" });
  await store.persistCall(call.id);
  return call;
}

async function ohneLogs(lauf) {
  const geloggt = console.error;
  console.error = () => {};
  try {
    return await lauf();
  } finally {
    console.error = geloggt;
  }
}

async function ohneLesenDerAnrufe(db, lauf) {
  await db.exec("ALTER TABLE call RENAME TO call_weg");
  try {
    return await ohneLogs(lauf);
  } finally {
    await db.exec("ALTER TABLE call_weg RENAME TO call");
  }
}

test("H7b-1: ein aktiver Anruf von Instanz A mit dieser Nummer als Absender sperrt sie auf Instanz B", async () => {
  const { a, b } = await zweiInstanzen();
  await aktiverAnruf(a);
  assert.equal(await b.numberHasActiveCall(NUMMER), true);
});

test("H7b-2: ein aktiver Anruf von Instanz A mit dieser Nummer als Ziel sperrt sie auf Instanz B", async () => {
  const { a, b } = await zweiInstanzen();
  await aktiverAnruf(a, { from: GEGENSTELLE, to: NUMMER });
  assert.equal(await b.numberHasActiveCall(NUMMER), true);
});

test("H7b-3: eine Nummer ohne Anruf ist auf B frei, auch wenn A einen Anruf mit anderer Nummer fuehrt", async () => {
  const { a, b } = await zweiInstanzen();
  await aktiverAnruf(a);
  assert.equal(await b.numberHasActiveCall(ANDERE_NUMMER), false);
});

test("H7b-4: ein beendeter Anruf von A sperrt die Nummer auf B nicht mehr", async () => {
  const { a, b } = await zweiInstanzen();
  const call = await aktiverAnruf(a);
  await a.endCallRecord(call.id, "completed");
  assert.equal(await b.numberHasActiveCall(NUMMER), false);
});

test("H7b-5: ein aktiver Anruf eines anderen Mandanten sperrt die Nummer ebenfalls", async () => {
  const { a, b } = await zweiInstanzen();
  await aktiverAnruf(a, { tenantId: FREMD });
  assert.equal(await b.numberHasActiveCall(NUMMER), true);
});

test("H7b-6: ein Anruf, den nur der eigene Spiegel kennt, sperrt die Nummer", async () => {
  const { b } = await zweiInstanzen();
  b.createCall({ direction: "outbound", from: NUMMER, to: GEGENSTELLE, goal: "Test", tenantId: KUNDE, provider: "telnyx" });
  assert.equal(await b.numberHasActiveCall(NUMMER), true);
});

test("H7b-6b: ein im Spiegel beendeter Anruf sperrt die Nummer nicht", async () => {
  const { b } = await zweiInstanzen();
  const call = b.createCall({ direction: "outbound", from: NUMMER, to: GEGENSTELLE, goal: "Test", tenantId: KUNDE, provider: "telnyx" });
  await b.persistCall(call.id);
  await b.endCallRecord(call.id, "completed");
  assert.equal(await b.numberHasActiveCall(NUMMER), false);
});

test("H7b-7: ohne Nummer gilt nichts als belegt, auch nicht der Anruf ohne Ziel im Spiegel", async () => {
  const { a, b } = await zweiInstanzen();
  await aktiverAnruf(a);
  b.createCall({ direction: "inbound", from: GEGENSTELLE, to: null, goal: "Test", tenantId: KUNDE, provider: "telnyx" });
  assert.equal(await b.numberHasActiveCall(null), false);
});

test("H7b-8: ein Lesefehler wirft und gilt nie als frei", async () => {
  const { b, db } = await zweiInstanzen();
  await ohneLesenDerAnrufe(db, () =>
    assert.rejects(() => b.numberHasActiveCall(NUMMER), LESEFEHLER),
  );
});

test("H7b-8b: der Lesefehler wird mit seinem Text ins Log geschrieben", async () => {
  const { b, db } = await zweiInstanzen();
  const zeilen = [];
  await db.exec("ALTER TABLE call RENAME TO call_weg");
  const geloggt = console.error;
  console.error = (...teile) => zeilen.push(teile[0]);
  try {
    await assert.rejects(() => b.numberHasActiveCall(NUMMER), LESEFEHLER);
  } finally {
    console.error = geloggt;
    await db.exec("ALTER TABLE call_weg RENAME TO call");
  }
  assert.deepEqual(zeilen, ["[pg] anruf-nummern lesen fehlgeschlagen:"]);
});

const ALTE_NUMMER = "+4915799990771";
const ERSATZ = "+12025550771";
const NUMMERN_OBERGRENZE = 50;
const KONFIGURATION = withConfigNamespaces({
  provisioningEnabled: true,
  maxNumbers: NUMMERN_OBERGRENZE,
  maxNumbersPerTenant: 1,
  paymentEnabled: true,
});

function tauschFuer(store, { vorRegistrierung = async () => {} } = {}) {
  store.load().numbers.push({
    id: "n_h7b",
    tenantId: KUNDE,
    status: "active",
    provider: "telnyx",
    providerNumberId: "ext_h7b",
    e164: ALTE_NUMMER,
    country: "DE",
    language: "de",
    paymentIntentId: null,
  });
  const freigaben = [];
  const ergebnisse = [];
  const anbieter = {
    searchNumbers: async () => [{ e164: ERSATZ }],
    orderNumber: async ({ e164 }) => ({ e164, providerNumberId: "ext_h7b_neu" }),
    releaseNumber: async (id) => freigaben.push(id),
  };
  const sipRegistrar = {
    ensureRegistration: async ({ numberId }) => {
      await vorRegistrierung();
      return { phoneNumberId: `phnum_${numberId}`, angelegt: true };
    },
  };
  const logger = {
    log: (zeile) => ergebnisse.push(zeile),
    warn() {},
    error() {},
  };
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

test("H7b-9: der Tausch gibt die alte Nummer nicht frei, solange A einen Anruf auf ihr fuehrt", async () => {
  const { a, b } = await zweiInstanzen();
  await aktiverAnruf(a, { from: ALTE_NUMMER });
  const { lauf, freigaben, ergebnis } = tauschFuer(b);
  await lauf;
  assert.deepEqual(freigaben, []);
  assert.ok(ergebnis().endsWith(`ergebnis=${TAUSCH_ERGEBNIS.FREIGABE_FEHLGESCHLAGEN}`), ergebnis());
});

test("H7b-10: ein Lesefehler vor der Freigabe laesst die alte Nummer beim Anbieter", async () => {
  const { b, db } = await zweiInstanzen();
  const { lauf, freigaben, ergebnis } = tauschFuer(b, {
    vorRegistrierung: () => db.exec("ALTER TABLE call RENAME TO call_weg"),
  });
  await ohneLogs(() => lauf);
  assert.deepEqual(freigaben, []);
  assert.ok(ergebnis().endsWith(`ergebnis=${TAUSCH_ERGEBNIS.FREIGABE_FEHLGESCHLAGEN}`), ergebnis());
});

test("H7b-11: ohne aktiven Anruf wird die alte Nummer freigegeben", async () => {
  const { b } = await zweiInstanzen();
  const { lauf, freigaben, ergebnis } = tauschFuer(b);
  await lauf;
  assert.deepEqual(freigaben, ["ext_h7b"]);
  assert.ok(ergebnis().endsWith(`ergebnis=${TAUSCH_ERGEBNIS.GETAUSCHT}`), ergebnis());
});

function nachDemSchreibenVerandern(store, veraendern) {
  const schreiben = store.drainFlushes.bind(store);
  Object.assign(store, {
    drainFlushes: async () => {
      await schreiben();
      veraendern(store.load());
    },
  });
}

test("H7b-15: eine Nummer, die vor der Freigabe aus dem Zustand verschwindet, wird nicht beim Anbieter geloescht", async () => {
  const { b } = await zweiInstanzen();
  const { lauf, freigaben, ergebnis } = tauschFuer(b);
  nachDemSchreibenVerandern(b, (state) => {
    state.numbers.splice(state.numbers.findIndex((nummer) => nummer.id === "n_h7b"), 1);
  });
  await lauf;
  assert.deepEqual(freigaben, []);
  assert.ok(ergebnis().endsWith(`ergebnis=${TAUSCH_ERGEBNIS.FREIGABE_FEHLGESCHLAGEN}`), ergebnis());
});

test("H7b-16: eine Nummer, die vor der Freigabe nicht mehr aktiv ist, wird nicht beim Anbieter geloescht", async () => {
  const { b } = await zweiInstanzen();
  const { lauf, freigaben } = tauschFuer(b);
  nachDemSchreibenVerandern(b, (state) => {
    const nummer = state.numbers.find((eintrag) => eintrag.id === "n_h7b");
    Object.assign(nummer, { status: "released" });
  });
  await lauf;
  assert.deepEqual(freigaben, []);
});

test("H7b-17: eine Nummer, die vor der Freigabe plattformseitig belegt wird, bleibt beim Anbieter", async () => {
  const { b } = await zweiInstanzen();
  const { lauf, freigaben, ergebnis } = tauschFuer(b);
  nachDemSchreibenVerandern(b, (state) => {
    const belegung = { id: "pnu_h7b", e164: ALTE_NUMMER, purpose: "test", provider: "telnyx", tenantId: null };
    state.platformNumberUse.push({ ...belegung, boundAt: new Date().toISOString(), releasedAt: null });
  });
  await lauf;
  assert.deepEqual(freigaben, []);
  assert.ok(ergebnis().endsWith(`ergebnis=${TAUSCH_ERGEBNIS.FREIGABE_FEHLGESCHLAGEN}`), ergebnis());
});
