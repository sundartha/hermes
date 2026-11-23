import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore, makePgStore } from "../pg-helpers.js";
import { speicherBereiche } from "../../src/store.js";

const JETZT = "2026-11-15T12:00:00.000Z";
const VORMONAT = "2026-10";
const FRUEHER = "2026-09";
const SPAETER = "2026-11";
const ZEILEN_SQL = "SELECT last_checked_month_key FROM cost_cross_check";

async function zweiInstanzen() {
  const { store: a, runner, db } = await makePgTestStore();
  const b = makePgStore(runner);
  await b.init();
  const geprueft = async () =>
    (await db.query(ZEILEN_SQL)).rows.map((zeile) => zeile.last_checked_month_key);
  const faellig = (store) => speicherBereiche(store).kostenabgleich.querpruefungMonat(JETZT);
  return { a, b, geprueft, faellig };
}

test("Instanz B sieht den von Instanz A gepruefte Vormonat ohne Neustart und nennt keinen Monat als faellig", async () => {
  const { a, b, geprueft, faellig } = await zweiInstanzen();
  assert.equal(await faellig(b), VORMONAT);
  await a.markCostCrossCheckAttempted(VORMONAT);
  await a.drainFlushes();
  assert.deepEqual(await geprueft(), [VORMONAT]);
  assert.equal(await faellig(b), null);
});

test("Instanz B ueberschreibt den Monat von Instanz A nicht mit einem frueheren", async () => {
  const { a, b, geprueft, faellig } = await zweiInstanzen();
  await a.markCostCrossCheckAttempted(VORMONAT);
  await b.markCostCrossCheckAttempted(FRUEHER);
  await b.drainFlushes();
  assert.deepEqual(await geprueft(), [VORMONAT]);
  assert.equal(await faellig(b), null);
});

test("Ein spaeterer Monat von Instanz B ersetzt den von Instanz A und wird von A gelesen", async () => {
  const { a, b, geprueft, faellig } = await zweiInstanzen();
  await a.markCostCrossCheckAttempted(VORMONAT);
  await b.markCostCrossCheckAttempted(SPAETER);
  await b.drainFlushes();
  assert.deepEqual(await geprueft(), [SPAETER]);
  assert.equal(await faellig(a), null);
});

test("Ein leerer Monatsschluessel aendert die gespeicherte Zeile nicht", async () => {
  const { a, geprueft } = await zweiInstanzen();
  await a.markCostCrossCheckAttempted(VORMONAT);
  await a.markCostCrossCheckAttempted(null);
  await a.drainFlushes();
  assert.deepEqual(await geprueft(), [VORMONAT]);
});

test("Das Speichern anderer Daten durch Instanz A setzt den Monat von Instanz B nicht zurueck", async () => {
  const { a, b, geprueft } = await zweiInstanzen();
  await b.markCostCrossCheckAttempted(VORMONAT);
  await b.drainFlushes();
  a.recordUsageEvent({ tenantId: "owner", kind: "voice_minute", quantity: 1, costCents: 0 });
  await a.save();
  await a.drainFlushes();
  assert.deepEqual(await geprueft(), [VORMONAT]);
});

test("Ohne gepruefte Monate nennt die Zeile keinen Monat und der Vormonat bleibt faellig", async () => {
  const { a, geprueft, faellig } = await zweiInstanzen();
  await a.drainFlushes();
  assert.deepEqual(await geprueft(), []);
  assert.equal(await faellig(a), VORMONAT);
});

test("Ohne Zeile nennt der Zustand keinen geprueften Monat", async () => {
  const { a } = await zweiInstanzen();
  assert.deepEqual(await a.costCrossCheckZustand(), {
    costCrossCheck: { lastCheckedMonthKey: null },
  });
});

async function mitDefekterTabelle() {
  const { runner } = await makePgTestStore();
  const defekt = {
    withClient: (arbeit) =>
      runner.withClient((client) =>
        arbeit({
          ...client,
          query: (text, parameter) =>
            text.includes("cost_cross_check")
              ? Promise.reject(new Error("Tabelle weg"))
              : client.query(text, parameter),
        }),
      ),
  };
  const store = makePgStore(defekt);
  await store.init();
  const meldungen = [];
  mock.method(console, "error", (...teile) => meldungen.push(teile.join(" ")));
  return { store, meldungen };
}

test("Ein Fehler beim Markieren wird gemeldet und an den Aufrufer weitergegeben", async () => {
  const { store, meldungen } = await mitDefekterTabelle();
  await assert.rejects(store.markCostCrossCheckAttempted(VORMONAT), /Tabelle weg/);
  assert.ok(meldungen.includes("[pg] kostenvergleich fehlgeschlagen: Tabelle weg"));
});

test("Ein Fehler beim Lesen wird gemeldet und der Vormonat gilt nie als geprueft", async () => {
  const { store, meldungen } = await mitDefekterTabelle();
  await assert.rejects(
    speicherBereiche(store).kostenabgleich.querpruefungMonat(JETZT),
    /Tabelle weg/,
  );
  assert.ok(meldungen.includes("[pg] kostenvergleich fehlgeschlagen: Tabelle weg"));
});
