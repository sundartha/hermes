import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { mitVerbindung, POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { gemeinsameUmgebung } from "../gemeinsam/zwei-prozesse.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { startServer } from "../helpers.js";

const ZEITGRENZE_MS = 120_000;
const KENNUNG = /^.+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function mitOffenemSpeicher(t, lauf) {
  const db = await echteDatenbankMitRolle(t);
  if (!db) return;
  const schema = await startServer({ env: gemeinsameUmgebung(db.adresse, {}) });
  await schema.stop();
  Object.assign(process.env, gemeinsameUmgebung(db.adresse, {}));
  const speicher = await import("../../src/store.js");
  await speicher.oeffneSpeicher();
  const verwaltung = new URL(process.env[POSTGRES_VARIABLE]);
  verwaltung.pathname = new URL(db.adresse).pathname;
  const meldungen = mock.method(console, "error", () => {});
  t.after(() => meldungen.mock.restore());
  await mitVerbindung(verwaltung.href, (sql) => lauf({ db, sql, speicher, meldungen }));
}

const texte = (meldungen) => meldungen.mock.calls.map((aufruf) => aufruf.arguments.map(String).join(" "));

const MELDUNG_SCHREIBEN = "[instanz] Lebenszeichen nicht geschrieben: ";
const MELDUNG_ABMELDEN = "[instanz] Abmelden fehlgeschlagen: ";
const MELDUNG_LESEN = "[instanz] Lebenszeichen nicht lesbar: ";

test("Lebenszeichen: Fehler beim Schreiben, Abmelden und Lesen stehen im Log und halten den Betrieb nicht auf", { timeout: ZEITGRENZE_MS }, (t) =>
  mitOffenemSpeicher(t, async ({ db, sql, speicher, meldungen }) => {
    await sql.query(`REVOKE INSERT ON instanz_lebenszeichen FROM ${db.rolle}`);
    const takt = await speicher.starteInstanzTakt();
    await takt.stoppen();
    assert.ok(texte(meldungen).some((text) => text.startsWith(MELDUNG_SCHREIBEN) && text.includes("permission denied")), texte(meldungen).join("|"));
    assert.ok(!texte(meldungen).some((text) => text.includes("does not exist")), texte(meldungen).join("|"));

    await sql.query(`REVOKE DELETE ON instanz_lebenszeichen FROM ${db.rolle}`);
    await takt.abmelden();
    assert.ok(texte(meldungen).some((text) => text.startsWith(MELDUNG_ABMELDEN) && text.includes("permission denied")), texte(meldungen).join("|"));

    await sql.query(`REVOKE SELECT ON instanz_lebenszeichen FROM ${db.rolle}`);
    const lage = await speicher.besitzLage();
    assert.deepEqual(lage, { eigene: lage.eigene, lebende: null });
    assert.match(lage.eigene, KENNUNG);
    assert.ok(texte(meldungen).some((text) => text.startsWith(MELDUNG_LESEN) && text.includes("permission denied")), texte(meldungen).join("|"));
  }),
);
