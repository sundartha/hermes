import { test } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "postfach@flush.invalid" });
const speicher = await import("../../src/store.js");
const MELDUNG = "Speicher bietet letzterFlushGelungen nicht an";
const TABELLE_DES_FLUSHS = "cost_cross_check";
const TABELLE_VERSTECKT = "cost_cross_check_versteckt";

async function flushMoeglichMachen(db) {
  await db.exec(`RESET ROLE; ALTER TABLE ${TABELLE_VERSTECKT} RENAME TO ${TABELLE_DES_FLUSHS}; SET ROLE kv2_app;`);
  speicher.save();
  await speicher.drainFlushes();
}

async function mitScheiterndemFlush(pruefung) {
  const { db } = laufendesHermes();
  await speicher.drainFlushes();
  await db.exec(`RESET ROLE; ALTER TABLE ${TABELLE_DES_FLUSHS} RENAME TO ${TABELLE_VERSTECKT}; SET ROLE kv2_app;`);
  try {
    await pruefung();
  } finally {
    await flushMoeglichMachen(db);
  }
}

test("Speicher meldet nach gelungenem Flush wahr, nach gescheitertem falsch, nach späterem gelungenem wieder wahr", async () => {
  assert.equal(typeof speicher.letzterFlushGelungen, "function", MELDUNG);

  speicher.save();
  assert.equal(await speicher.letzterFlushGelungen(), true, "nach gelungenem Flush wahr");

  await mitScheiterndemFlush(async () => {
    speicher.save();
    assert.equal(await speicher.letzterFlushGelungen(), false, "nach gescheitertem Flush falsch");
  });

  assert.equal(await speicher.letzterFlushGelungen(), true, "nach späterem gelungenem Flush wieder wahr");
});

test("[NIE1] Nach gescheitertem Flush nie wahr, bis ein späterer Flush gelingt", async () => {
  await mitScheiterndemFlush(async () => {
    speicher.save();
    await assert.rejects(speicher.drainFlushes(), Error, "erster Abruf nach dem gescheiterten Flush");
    await assert.rejects(speicher.drainFlushes(), Error, "zweiter Abruf, solange kein Flush gelang");
    assert.notEqual(await speicher.letzterFlushGelungen?.(), true);
  });
  await speicher.drainFlushes();
});

test("[NIE2] Gescheiterter Flush: save() wirft nicht, drainFlushes() wirft den Fehler weiter", async () => {
  await mitScheiterndemFlush(async () => {
    await assert.doesNotReject(async () => speicher.save());
    await assert.rejects(speicher.drainFlushes(), new RegExp(TABELLE_DES_FLUSHS));
  });
});

test("[NIE3] Fehlertext des gescheiterten Flushs gelangt nie in den Wert, er ist ein boolean", async () => {
  let wert;
  await mitScheiterndemFlush(async () => {
    speicher.save();
    await speicher.drainFlushes().catch(() => {});
    wert = await speicher.letzterFlushGelungen?.();
  });
  assert.equal(typeof wert, "boolean");
  assert.equal(typeof (await speicher.letzterFlushGelungen()), "boolean");
});

test("[NIE4] Fassade gibt letzterFlushGelungen als benannten Export heraus", () => {
  laufendesHermes();
  assert.equal(typeof speicher.letzterFlushGelungen, "function");
});
