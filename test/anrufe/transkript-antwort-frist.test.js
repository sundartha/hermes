import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { speicherBereiche } from "../../src/store.js";

const FRIST_MS = 500;
const ANRUF = "call_frist_1";

function mitSpeicher(addTranscript) {
  return speicherBereiche({ addTranscript }).anrufe;
}

test("Transkript-Frist: ein haengendes Schreiben haelt die Antwort nach genau 0,5 s nicht mehr auf", async (t) => {
  t.mock.method(console, "warn", () => {});
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  let fertig = false;
  const anrufe = mitSpeicher(() => new Promise(() => {}));

  const warten = anrufe.addTranscript(ANRUF, "agent", "Hallo").then(() => {
    fertig = true;
  });
  mock.timers.tick(FRIST_MS - 1);
  await Promise.resolve();
  assert.equal(fertig, false);
  mock.timers.tick(1);
  await warten;

  assert.equal(fertig, true);
  assert.equal(console.warn.mock.callCount(), 1);
});

test("Transkript-Frist: ein Schreibfehler wirft weiter und gilt nicht als Frist", async (t) => {
  t.mock.method(console, "warn", () => {});
  const anrufe = mitSpeicher(() => Promise.reject(new Error("schreiben kaputt")));

  await assert.rejects(anrufe.addTranscript(ANRUF, "agent", "Hallo"), /schreiben kaputt/);

  assert.equal(console.warn.mock.callCount(), 0);
});

test("Transkript-Frist: ein rechtzeitiges Schreiben gibt sein Ergebnis zurueck und warnt nicht", async (t) => {
  t.mock.method(console, "warn", () => {});
  const anrufe = mitSpeicher(async () => ({ id: ANRUF }));

  assert.deepEqual(await anrufe.addTranscript(ANRUF, "agent", "Hallo"), { id: ANRUF });
  assert.equal(console.warn.mock.callCount(), 0);
});
