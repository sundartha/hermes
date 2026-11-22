import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { mitVerbindung, POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { gemeinsameUmgebung } from "../gemeinsam/zwei-prozesse.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";

const ZEITGRENZE_MS = 120_000;
const TAKT_MS = 10_000;
const WARTE_FRIST_MS = 30_000;

async function bis(bedingung, beschreibung) {
  const frist = AbortSignal.timeout(WARTE_FRIST_MS);
  while (!(await bedingung())) {
    assert.ok(!frist.aborted, beschreibung);
    await new Promise((fertig) => setImmediate(fertig));
  }
}

test("Lebenszeichen: eine haengende Uebernahme haelt das Lebenszeichen nicht auf und wird nicht angereiht", { timeout: ZEITGRENZE_MS }, async (t) => {
  const db = await echteDatenbankMitRolle(t);
  if (!db) return;
  Object.assign(process.env, gemeinsameUmgebung(db.adresse, {}));
  const speicher = await import("../../src/store.js");
  await speicher.oeffneSpeicher();
  const verwaltung = new URL(process.env[POSTGRES_VARIABLE]);
  verwaltung.pathname = new URL(db.adresse).pathname;
  await mitVerbindung(verwaltung.href, async (sql) => {
    const gemeldet = async () => (await sql.query(`SELECT gemeldet_um::text AS um FROM instanz_lebenszeichen`)).rows.map((zeile) => zeile.um);
    mock.timers.enable({ apis: ["setInterval"] });
    t.after(() => mock.timers.reset());
    let aufrufe = 0;
    let freigeben = () => {};
    const takt = await speicher.starteInstanzTakt({
      nachMeldung: () => {
        aufrufe += 1;
        return new Promise((fertig) => {
          freigeben = fertig;
        });
      },
    });
    const [start] = await gemeldet();
    mock.timers.tick(TAKT_MS);
    await bis(() => aufrufe === 1, "die Uebernahme startet im ersten Takt");
    mock.timers.tick(TAKT_MS);
    await bis(async () => (await gemeldet())[0] !== start, "das Lebenszeichen wird trotz haengender Uebernahme neu geschrieben");
    const zweiter = (await gemeldet())[0];
    mock.timers.tick(TAKT_MS);
    await bis(async () => (await gemeldet())[0] !== zweiter, "auch der dritte Takt schreibt das Lebenszeichen");
    assert.equal(aufrufe, 1, "solange die Uebernahme laeuft, startet kein Takt eine zweite");
    freigeben();
    await bis(() => {
      mock.timers.tick(TAKT_MS);
      return aufrufe === 2;
    }, "nach dem Ende der Uebernahme laeuft sie im naechsten Takt wieder");
    freigeben();
    await takt.stoppen();
    await takt.abmelden();
    assert.deepEqual(await gemeldet(), []);
  });
});
