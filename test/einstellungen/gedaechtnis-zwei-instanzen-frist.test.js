import assert from "node:assert/strict";
import test from "node:test";

import {
  BOOTSTRAP_TENANT_ID,
  einstellungenNachladenVon,
  makePgStore,
  pgliteAlsRolleOhneSuperuser,
} from "../pg-helpers.js";

const GROSSZUEGIGE_FRIST_MS = 60_000;
const KURZE_FRIST_MS = 60;

function runnerFuer(db, vorQuery = async () => {}) {
  const client = {
    query: async (text, params) => {
      await vorQuery(text);
      return db.query(text, params);
    },
    exec: (sql) => db.exec(sql),
  };
  return { withClient: (fn) => fn(client) };
}

async function instanz(runner, optionen) {
  const store = makePgStore(runner, optionen);
  await store.init();
  return Object.assign(store, {
    einstellungenNachladen: (tenantId) => einstellungenNachladenVon(store.load(), tenantId),
  });
}

const gedaechtnisAn = (store) => store.tenantContext(BOOTSTRAP_TENANT_ID).settings.allowCallMemory;

async function mitGedaechtnisAufA(runner) {
  const a = await instanz(runner);
  a.updateSettings(BOOTSTRAP_TENANT_ID, { allowCallMemory: true });
  await a.drainFlushes();
  return a;
}

test("Kriterium 1 (Frist): B laedt das Anrufgedaechtnis von A nach, solange das Lesen innerhalb der Frist antwortet", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = runnerFuer(db);
  await mitGedaechtnisAufA(runner);
  const b = await instanz(runner, { einstellungenFristMs: GROSSZUEGIGE_FRIST_MS });

  assert.equal(await b.einstellungenNachladen(BOOTSTRAP_TENANT_ID), true);
  assert.equal(gedaechtnisAn(b), true);
});

test("Kriterium 2 (Frist): schaltet A das Anrufgedaechtnis ab, liest B danach false", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = runnerFuer(db);
  const a = await mitGedaechtnisAufA(runner);
  const b = await instanz(runner, { einstellungenFristMs: GROSSZUEGIGE_FRIST_MS });
  assert.equal(await b.einstellungenNachladen(BOOTSTRAP_TENANT_ID), true);
  assert.equal(gedaechtnisAn(b), true);

  a.updateSettings(BOOTSTRAP_TENANT_ID, { allowCallMemory: false });
  await a.drainFlushes();

  assert.equal(await b.einstellungenNachladen(BOOTSTRAP_TENANT_ID), true);
  assert.equal(gedaechtnisAn(b), false);
});

test("Kriterium 3 (Frist): haengt das Lesen laenger als die Frist, schaltet B das Anrufgedaechtnis fail-closed ab", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  let freigeben;
  const tor = new Promise((weiter) => (freigeben = weiter));
  const haengt = { an: false };
  const runner = runnerFuer(db, async (text) => {
    if (haengt.an && /FROM settings WHERE/.test(text)) await tor;
  });
  await mitGedaechtnisAufA(runner);
  const b = await instanz(runner, { einstellungenFristMs: KURZE_FRIST_MS });
  assert.equal(await b.einstellungenNachladen(BOOTSTRAP_TENANT_ID), true);
  assert.equal(gedaechtnisAn(b), true);

  const meldungen = [];
  const original = console.error;
  console.error = (...teile) => meldungen.push(teile.join(" "));
  try {
    haengt.an = true;
    assert.equal(await b.einstellungenNachladen(BOOTSTRAP_TENANT_ID), false);
    assert.equal(gedaechtnisAn(b), false);
    assert.ok(meldungen.some((m) => m.includes("[pg] einstellungen nachladen fehlgeschlagen")));
  } finally {
    freigeben();
    console.error = original;
  }
});
