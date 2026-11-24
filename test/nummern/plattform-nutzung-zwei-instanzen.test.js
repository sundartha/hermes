import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const E164 = "+15005550006";
const ZWEITE = "+15005550007";
const ABFRAGE = "SELECT e164, purpose, released_at IS NULL AS offen FROM platform_number_use ORDER BY e164";

const runnerFuer = (db) => ({
  withClient: (arbeit) => arbeit({ query: (text, werte) => db.query(text, werte), exec: (sql) => db.exec(sql) }),
});

async function neueInstanz(db) {
  const store = makePgStoreMitSperre(runnerFuer(db));
  await store.init();
  return store;
}

const binden = (store, e164) => {
  const bindung = { id: `pnu_${e164}`, e164, purpose: "outbound_ani", provider: "telnyx", tenantId: null, providerNumberId: null, boundAt: "2026-11-21T10:00:00.000Z", releasedAt: null, note: null };
  store.load().platformNumberUse.push(bindung);
  return bindung;
};

async function flushen(store) {
  await store.plattformBindungenSchreiben();
  store.save();
  await store.drainFlushes();
}

test("Eine Instanz mit veralteter Kopie loescht beim Flush die Bindung der anderen nicht", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await neueInstanz(db);
  const b = await neueInstanz(db);
  assert.deepEqual(b.load().platformNumberUse, []);
  binden(a, E164);
  await flushen(a);
  assert.deepEqual((await db.query(ABFRAGE)).rows, [{ e164: E164, purpose: "outbound_ani", offen: true }]);
  await flushen(b);
  assert.deepEqual((await db.query(ABFRAGE)).rows, [{ e164: E164, purpose: "outbound_ani", offen: true }]);
});

test("Eine neue Bindung und das Schliessen einer Bindung schreibt der Flush weiter", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await neueInstanz(db);
  const erste = binden(a, E164);
  binden(a, ZWEITE);
  await flushen(a);
  assert.deepEqual((await db.query(ABFRAGE)).rows.map((zeile) => zeile.offen), [true, true]);
  erste.releasedAt = "2026-11-22T10:00:00.000Z";
  await flushen(a);
  assert.deepEqual((await db.query(ABFRAGE)).rows.map((zeile) => [zeile.e164, zeile.offen]), [[E164, false], [ZWEITE, true]]);
});

const alsText = (wert) => (wert instanceof Date ? wert.toISOString() : wert);

const zeileAlsText = (zeile) => Object.fromEntries(Object.entries(zeile).map(([name, wert]) => [name, alsText(wert)]));

const kurzform = (text) => text.trim().split(/\s+/, 2).join(" ");

const aufzeichnenderRunner = (db, { ausfall = null, textZeiten = false } = {}) => {
  const aufgerufen = [];
  const query = async (text, werte) => {
    aufgerufen.push(kurzform(text));
    if (ausfall && text.includes(ausfall)) throw new Error("Schreiben fehlgeschlagen");
    const antwort = await db.query(text, werte);
    if (!textZeiten) return antwort;
    return { ...antwort, rows: antwort.rows.map(zeileAlsText) };
  };
  return { aufgerufen, runner: { withClient: (arbeit) => arbeit({ query, exec: (sql) => db.exec(sql) }) } };
};

test("Eine offene Bindung wird beim Flush nur angelegt und nicht noch einmal geschlossen", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const { aufgerufen, runner } = aufzeichnenderRunner(db);
  const store = makePgStoreMitSperre(runner);
  await store.init();
  binden(store, E164);
  aufgerufen.length = 0;
  await store.plattformBindungenSchreiben();
  assert.deepEqual(aufgerufen, ["BEGIN", "INSERT INTO", "COMMIT"]);
});

test("Scheitert das Schreiben einer Bindung, wird zurueckgerollt und der Fehler weitergegeben", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const { aufgerufen, runner } = aufzeichnenderRunner(db, { ausfall: "INSERT INTO platform_number_use" });
  const store = makePgStoreMitSperre(runner);
  await store.init();
  binden(store, E164);
  aufgerufen.length = 0;
  await assert.rejects(store.plattformBindungenSchreiben(), /Schreiben fehlgeschlagen/);
  assert.deepEqual(aufgerufen, ["BEGIN", "INSERT INTO", "ROLLBACK"]);
  assert.deepEqual((await db.query(ABFRAGE)).rows, []);
});

test("Zeiten, die die Datenbank als Text liefert, bleiben beim Nachladen unveraendert", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await neueInstanz(db);
  const bindung = binden(a, E164);
  await flushen(a);
  const { runner } = aufzeichnenderRunner(db, { textZeiten: true });
  const b = makePgStoreMitSperre(runner);
  await b.init();
  await b.plattformBindungenNachladen();
  const [geladen] = b.load().platformNumberUse;
  assert.equal(geladen.boundAt, "2026-11-21T10:00:00.000Z");
  bindung.releasedAt = "2026-11-22T10:00:00.000Z";
  await flushen(a);
  await b.plattformBindungenNachladen();
  assert.equal(geladen.releasedAt, "2026-11-22T10:00:00.000Z");
});

test("Nachladen nimmt die Bindung der anderen Instanz neben einer schon vorhandenen auf", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await neueInstanz(db);
  const b = await neueInstanz(db);
  binden(b, E164);
  await flushen(b);
  binden(a, ZWEITE);
  await flushen(a);
  await b.plattformBindungenNachladen();
  assert.deepEqual(b.load().platformNumberUse.map((bindung) => bindung.e164), [E164, ZWEITE]);
});

test("Nachladen oeffnet eine lokal geschlossene Bindung nicht wieder", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const b = await neueInstanz(db);
  const bindung = binden(b, E164);
  await flushen(b);
  bindung.releasedAt = "2026-11-22T10:00:00.000Z";
  await b.plattformBindungenNachladen();
  const [geladen] = b.load().platformNumberUse;
  assert.equal(geladen.releasedAt, "2026-11-22T10:00:00.000Z");
});

test("Die Notiz einer Bindung steht nach dem Flush in der Datenbank", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await neueInstanz(db);
  binden(a, E164).note = "Testnotiz";
  await flushen(a);
  assert.deepEqual((await db.query("SELECT note FROM platform_number_use")).rows, [{ note: "Testnotiz" }]);
});

test("Eine geschlossene Bindung derselben Nummer neben einer offenen bleibt mit Freigabezeit gespeichert", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await neueInstanz(db);
  const b = await neueInstanz(db);
  const offene = binden(a, E164);
  await flushen(a);
  const geschlossene = { ...binden(b, E164), id: "pnu_b", releasedAt: "2026-11-22T10:00:00.000Z" };
  b.load().platformNumberUse.splice(0, 1, geschlossene);
  await flushen(b);
  const zeilen = (await db.query("SELECT id, released_at FROM platform_number_use ORDER BY id")).rows;
  assert.deepEqual(zeilen.map((zeile) => [zeile.id, alsText(zeile.released_at)]), [[offene.id, null], ["pnu_b", "2026-11-22T10:00:00.000Z"]]);
});
