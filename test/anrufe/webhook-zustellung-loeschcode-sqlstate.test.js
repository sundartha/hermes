import assert from "node:assert/strict";
import { test } from "node:test";

import { mitDatenbankVorDemStart, zeilenBis } from "./zwei-instanzen-postgres.js";

const LOESCHFEHLER_ZEILE = "[webhook-zustellung] loeschen_fehlgeschlagen";
const ENV_KURZER_TAKT = { WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS: "500" };

const loeschfehlerIn = (log) => log.split("\n").filter((zeile) => zeile.includes(LOESCHFEHLER_ZEILE));

const FALLTUER_SQL = (sqlstate) => `
  CREATE FUNCTION loeschen_verweigern() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN RAISE EXCEPTION 'verweigert' USING ERRCODE = '${sqlstate}'; END $$;
  CREATE TRIGGER loeschen_verweigern BEFORE DELETE ON webhook_zustellung
    FOR EACH STATEMENT EXECUTE FUNCTION loeschen_verweigern()`;

const FAELLE = [
  { sqlstate: "55P03", erwartet: "code=55P03" },
  { sqlstate: "57014", erwartet: "code=57014" },
  { sqlstate: "XX000", erwartet: "code=XX000" },
];

for (const { sqlstate, erwartet } of FAELLE) {
  test(`AK1: scheitert das Löschen mit SQLSTATE ${sqlstate}, steht ${erwartet} im Log`, async (t) => {
    await mitDatenbankVorDemStart(t, { env: ENV_KURZER_TAKT }, async ({ sql, starte }) => {
      await sql(FALLTUER_SQL(sqlstate));
      const instanz = await starte();
      const log = await zeilenBis(async () => instanz.stdout, (text) => loeschfehlerIn(text).length > 0);
      const zeilen = loeschfehlerIn(log);
      assert.ok(zeilen.length > 0, `Fehlerzeile fehlt:\n${log}`);
      for (const zeile of zeilen) assert.ok(zeile.endsWith(` ${erwartet}`), `falscher Code: ${zeile}`);
    });
  });
}
