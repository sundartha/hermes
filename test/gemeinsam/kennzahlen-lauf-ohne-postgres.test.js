import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { oeffneSpeicher, rolleVorhanden, starteKennzahlenLauf } from "../../src/store.js";

const TAKT_MS = 60000;

test("Ohne Postgres gibt es keine Leserolle, und der Minutentakt wird nur einmal gestellt", async () => {
  await oeffneSpeicher();
  assert.equal(await rolleVorhanden("kennzahlen_leser"), false);
  const echtesStellen = globalThis.setInterval;
  const takte = [];
  mock.method(globalThis, "setInterval", (arbeit, dauer, ...rest) => {
    const uhr = echtesStellen(arbeit, dauer, ...rest);
    takte.push(dauer);
    return uhr;
  });
  await starteKennzahlenLauf();
  await starteKennzahlenLauf();
  mock.restoreAll();
  assert.deepEqual(takte, [TAKT_MS]);
});
