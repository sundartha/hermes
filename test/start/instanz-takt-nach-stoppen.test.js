import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { mitVerbindung, POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { gemeinsameUmgebung } from "../gemeinsam/zwei-prozesse.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";

const ZEITGRENZE_MS = 120_000;
const TAKT_MS = 10_000;
const BEOBACHTUNGEN = 15;

test("Lebenszeichen: ein Takt nach stoppen() schreibt die Zeile nach dem Abmelden nicht neu", { timeout: ZEITGRENZE_MS }, async (t) => {
  const db = await echteDatenbankMitRolle(t);
  if (!db) return;
  Object.assign(process.env, gemeinsameUmgebung(db.adresse, {}));
  const speicher = await import("../../src/store.js");
  await speicher.oeffneSpeicher();
  const verwaltung = new URL(process.env[POSTGRES_VARIABLE]);
  verwaltung.pathname = new URL(db.adresse).pathname;
  await mitVerbindung(verwaltung.href, async (sql) => {
    const zeilen = async () => (await sql.query(`SELECT kennung FROM instanz_lebenszeichen`)).rows;
    mock.timers.enable({ apis: ["setInterval"] });
    t.after(() => mock.timers.reset());
    const takt = await speicher.starteInstanzTakt();
    assert.equal((await zeilen()).length, 1, "der Start meldet die Instanz");
    await takt.stoppen();
    await takt.abmelden();
    assert.deepEqual(await zeilen(), []);
    mock.timers.tick(TAKT_MS);
    for (let beobachtung = 0; beobachtung < BEOBACHTUNGEN; beobachtung += 1) {
      await new Promise((fertig) => setImmediate(fertig));
      assert.deepEqual(await zeilen(), [], "kein Takt schreibt nach stoppen() noch");
    }
  });
});
