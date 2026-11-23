import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore, makePgStore } from "../pg-helpers.js";
import { config } from "../../src/config.ts";

const OKTOBER = "2026-10-15T10:00:00.000Z";
const NOVEMBER = "2026-11-15T10:00:00.000Z";
const KEIN_DATUM = "kein-datum";
const KONTINGENT = 1000;
const WARNSCHWELLE_PROZENT = 75;
const EIGENTUEMER = "owner";
const ZEILE_SQL = "SELECT cycle_key, characters, warned_cycle, kostenstelle_zeichen FROM platform_tts_usage";

async function zweiInstanzen() {
  config.billing.ttsCharacterQuota = KONTINGENT;
  config.billing.ttsCharacterQuotaWarnPercent = WARNSCHWELLE_PROZENT;
  config.billing.ttsQuotaCycleAnchorDay = 1;
  const { store: a, runner, db } = await makePgTestStore();
  const b = makePgStore(runner);
  await b.init();
  const zeilen = async () =>
    (await db.query(ZEILE_SQL)).rows.map((zeile) => ({
      cycleKey: zeile.cycle_key,
      characters: Number(zeile.characters),
      warnedCycle: zeile.warned_cycle,
      kostenstelle: Number(zeile.kostenstelle_zeichen),
    }));
  return { a, b, zeilen, db, runner };
}

test("Instanz B liest die Zeichen von Instanz A ohne Neustart", async () => {
  const { a, b } = await zweiInstanzen();
  await a.recordTtsCharacters(238, OKTOBER);
  assert.deepEqual(await b.platformTtsUsageView(OKTOBER), {
    characters: 238,
    quota: KONTINGENT,
    warnPercent: WARNSCHWELLE_PROZENT,
    cycleKey: "2026-10",
  });
});

test("Zeichen von Instanz A und Instanz B addieren sich und die Kostenstelle zaehlt mit", async () => {
  const { a, b, zeilen } = await zweiInstanzen();
  await a.recordTtsCharacters(100, OKTOBER);
  await b.recordTtsCharacters(50, OKTOBER);
  await a.recordTtsCharacters(25, OKTOBER);
  assert.deepEqual(await zeilen(), [
    { cycleKey: "2026-10", characters: 175, warnedCycle: null, kostenstelle: 175 },
  ]);
});

test("Gleichzeitig gebuchte Zeichen einer Instanz gehen nicht verloren", async () => {
  const { a, zeilen } = await zweiInstanzen();
  const buchungen = [];
  for (let i = 0; i < 20; i += 1) buchungen.push(a.recordTtsCharacters(10, OKTOBER));
  await Promise.all(buchungen);
  assert.equal((await zeilen())[0].characters, 200);
});

test("Das Speichern anderer Daten durch Instanz A setzt die Zeichen von Instanz B nicht zurueck", async () => {
  const { a, b, zeilen } = await zweiInstanzen();
  await b.recordTtsCharacters(77, OKTOBER);
  await a.save();
  await a.drainFlushes();
  assert.deepEqual(await zeilen(), [
    { cycleKey: "2026-10", characters: 77, warnedCycle: null, kostenstelle: 77 },
  ]);
});

test("Die Warnung beim Ueberschreiten der Schwelle kommt genau einmal ueber beide Instanzen", async () => {
  const { a, b, zeilen } = await zweiInstanzen();
  assert.equal(await a.recordTtsCharacters(700, OKTOBER), null);
  assert.deepEqual(await b.recordTtsCharacters(100, OKTOBER), {
    characters: 800,
    quota: KONTINGENT,
    cycleKey: "2026-10",
  });
  assert.equal(await a.recordTtsCharacters(50, OKTOBER), null);
  assert.equal((await zeilen())[0].warnedCycle, "2026-10");
});

test("Ist das Kontingent bei Instanz A erschoepft, meldet Instanz B beim naechsten Buchen erschoepft", async () => {
  const { a, b } = await zweiInstanzen();
  await a.recordTtsCharacters(KONTINGENT, OKTOBER);
  assert.deepEqual(await b.recordTtsCharacters(10, OKTOBER), {
    characters: KONTINGENT + 10,
    quota: KONTINGENT,
    cycleKey: "2026-10",
    exhausted: true,
  });
});

test("Ein neuer Zyklus von Instanz B beginnt bei null und Instanz A liest ihn", async () => {
  const { a, b, zeilen } = await zweiInstanzen();
  await a.recordTtsCharacters(100, OKTOBER);
  await b.recordTtsCharacters(7, NOVEMBER);
  assert.deepEqual(await zeilen(), [
    { cycleKey: "2026-11", characters: 7, warnedCycle: null, kostenstelle: 107 },
  ]);
  assert.equal((await a.platformTtsUsageView(NOVEMBER)).characters, 7);
});

test("Ein spaeterer Zeitpunkt auf Instanz A setzt den Zyklus von Instanz B nicht zurueck", async () => {
  const { a, b, zeilen } = await zweiInstanzen();
  await b.recordTtsCharacters(7, NOVEMBER);
  await a.recordTtsCharacters(3, OKTOBER);
  assert.deepEqual(await zeilen(), [
    { cycleKey: "2026-11", characters: 10, warnedCycle: null, kostenstelle: 10 },
  ]);
});

test("Relay-Zeichen zaehlen im Plattform-Kontingent, nicht in der Kostenstelle", async () => {
  const { a, b, zeilen } = await zweiInstanzen();
  await b.recordTtsCharacters(10, OKTOBER);
  assert.equal(await a.recordRelayTtsCharacters(EIGENTUEMER, 40, OKTOBER), null);
  assert.equal((await b.platformTtsUsageView(OKTOBER)).characters, 50);
  assert.deepEqual(await zeilen(), [
    { cycleKey: "2026-10", characters: 50, warnedCycle: null, kostenstelle: 10 },
  ]);
});

test("Relay-Zeichen warnen ueber beide Instanzen genau einmal", async () => {
  const { a, b } = await zweiInstanzen();
  await a.recordTtsCharacters(700, OKTOBER);
  assert.deepEqual(await b.recordRelayTtsCharacters(EIGENTUEMER, 100, OKTOBER), {
    characters: 800,
    quota: KONTINGENT,
    cycleKey: "2026-10",
  });
  assert.equal(await a.recordRelayTtsCharacters(EIGENTUEMER, 10, OKTOBER), null);
});

test("Relay mit null Zeichen buchen nichts und legen keine Zeile an", async () => {
  const { a, zeilen } = await zweiInstanzen();
  assert.equal(await a.recordRelayTtsCharacters(EIGENTUEMER, 0, OKTOBER), null);
  assert.deepEqual(await zeilen(), []);
});

test("Ein ungueltiger Zeitpunkt bucht nichts und legt keine Zeile an", async () => {
  const { a, zeilen } = await zweiInstanzen();
  assert.equal(await a.recordTtsCharacters(5, KEIN_DATUM), null);
  assert.deepEqual(await zeilen(), []);
});

test("Ohne Zeile zeigt die Ansicht null Zeichen und das Lesen legt keine Zeile an", async () => {
  const { a, zeilen } = await zweiInstanzen();
  assert.deepEqual(await a.platformTtsUsageView(OKTOBER), {
    characters: 0,
    quota: KONTINGENT,
    warnPercent: WARNSCHWELLE_PROZENT,
    cycleKey: "2026-10",
  });
  assert.deepEqual(await zeilen(), []);
});

test("Ein Neustart liest die gebuchten Zeichen aus der Datenbank", async () => {
  const { a, runner } = await zweiInstanzen();
  await a.recordTtsCharacters(238, OKTOBER);
  const neu = makePgStore(runner);
  await neu.init();
  assert.equal((await neu.platformTtsUsageView(OKTOBER)).characters, 238);
});

async function mitDefekterTabelle() {
  const { runner } = await zweiInstanzen();
  const defekt = {
    withClient: (arbeit) =>
      runner.withClient((client) =>
        arbeit({
          ...client,
          query: (text, parameter) =>
            text.includes("platform_tts_usage")
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

test("Ein Fehler beim Buchen wird gemeldet und an den Aufrufer weitergegeben", async () => {
  const { store, meldungen } = await mitDefekterTabelle();
  await assert.rejects(store.recordTtsCharacters(10, OKTOBER), /Tabelle weg/);
  assert.ok(meldungen.includes("[pg] tts-zaehler fehlgeschlagen: Tabelle weg"));
});

test("Ein Fehler beim Lesen wird gemeldet und an den Aufrufer weitergegeben", async () => {
  const { store, meldungen } = await mitDefekterTabelle();
  await assert.rejects(store.platformTtsUsageView(OKTOBER), /Tabelle weg/);
  assert.ok(meldungen.includes("[pg] tts-zaehler fehlgeschlagen: Tabelle weg"));
});

function mitProtokoll(runner, ablehnen) {
  const texte = [];
  const store = makePgStore({
    withClient: (arbeit) =>
      runner.withClient((client) =>
        arbeit({
          ...client,
          query: (text, parameter) => {
            if (text.includes("platform_tts_usage") || text === "COMMIT" || text === "ROLLBACK" || text === "BEGIN")
              texte.push(text);
            return ablehnen?.test(text)
              ? Promise.reject(new Error("Schreiben abgelehnt"))
              : client.query(text, parameter);
          },
        }),
      ),
  });
  return { store, texte };
}

test("Das Buchen laeuft in einer Transaktion mit gesperrter Zeile", async () => {
  const { runner } = await zweiInstanzen();
  const { store, texte } = mitProtokoll(runner);
  await store.init();
  texte.length = 0;
  await store.recordTtsCharacters(10, OKTOBER);
  assert.equal(texte[0], "BEGIN");
  assert.ok(texte[2].endsWith("FOR UPDATE"));
  assert.ok(texte[3].startsWith("UPDATE platform_tts_usage"));
  assert.equal(texte.at(-1), "COMMIT");
  assert.equal(texte.length, 5);
});

test("Schlaegt das Schreiben fehl, bleibt keine Zeile zurueck", async () => {
  const { runner, zeilen } = await zweiInstanzen();
  const { store, texte } = mitProtokoll(runner, /^UPDATE platform_tts_usage/);
  await store.init();
  texte.length = 0;
  mock.method(console, "error", () => {});
  await assert.rejects(store.recordTtsCharacters(10, OKTOBER), /Schreiben abgelehnt/);
  assert.equal(texte.at(-1), "ROLLBACK");
  assert.deepEqual(await zeilen(), []);
});
