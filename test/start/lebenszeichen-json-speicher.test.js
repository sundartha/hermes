import assert from "node:assert/strict";
import { test } from "node:test";

const KENNUNG = /^.+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("Lebenszeichen: unter dem JSON-Speicher lebt nur die eigene Instanz und der Takt laesst sich stoppen und abmelden", async () => {
  const speicher = await import("../../src/store.js");
  await speicher.oeffneSpeicher();
  const lage = await speicher.besitzLage();
  assert.match(lage.eigene, KENNUNG);
  assert.deepEqual(lage.lebende, [lage.eigene]);
  const takt = await speicher.starteInstanzTakt();
  assert.equal(typeof takt.stoppen, "function");
  assert.equal(typeof takt.abmelden, "function");
  assert.equal(await takt.stoppen(), undefined);
  assert.equal(await takt.abmelden(), undefined);
});
