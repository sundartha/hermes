import assert from "node:assert/strict";
import { test } from "node:test";

import { mitInstanzenAufPostgres, zeilenBis } from "./zwei-instanzen-postgres.js";

const ABLAGE_TABELLE = "webhook_zustellung";
const KURZER_TAKT_MS = "500";
const FEHLER_FRIST_MS = 2_000;
const LOESCHFEHLER_ZEILE = "[webhook-zustellung] loeschen_fehlgeschlagen";
const FRIST_CODE = /code=(frist|55P03)$/;
const UNBEKANNTER_CODE = /code=unbekannt$/;
const ENV_KURZER_TAKT = { WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS: KURZER_TAKT_MS };

const loeschfehlerIn = (log) => log.split("\n").filter((zeile) => zeile.includes(LOESCHFEHLER_ZEILE));

test("AK1: bei gesperrter Tabelle steht spätestens 2 s nach Sperrbeginn loeschen_fehlgeschlagen code=frist im Log, nie code=unbekannt", async (t) => {
  await mitInstanzenAufPostgres(t, { anzahl: 1, env: ENV_KURZER_TAKT }, async ({ instanzen: [a], sql }) => {
    await sql("BEGIN");
    try {
      await sql(`LOCK TABLE ${ABLAGE_TABELLE} IN ACCESS EXCLUSIVE MODE`);
      const beginn = Date.now();
      const log = await zeilenBis(async () => a.stdout, (text) => loeschfehlerIn(text).length > 0);
      const zeilen = loeschfehlerIn(log);
      assert.ok(zeilen.some((zeile) => FRIST_CODE.test(zeile)), `Frist-Code fehlt:\n${log}`);
      assert.ok(Date.now() - beginn <= FEHLER_FRIST_MS, "Fehlerzeile später als 2 s nach Sperrbeginn");
      for (const zeile of zeilen) {
        assert.doesNotMatch(zeile, UNBEKANNTER_CODE, `unbekannter Code: ${zeile}`);
      }
    } finally {
      await sql("ROLLBACK");
    }
  });
});
