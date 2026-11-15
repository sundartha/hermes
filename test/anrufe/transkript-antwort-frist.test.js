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
  const { calls: warnAufrufe } = console.warn.mock;
  const [warnung] = warnAufrufe[0].arguments;
  assert.match(warnung, /\[transkript\] schreiben ueber die Frist/);
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

test("Transkript-Frist: Fehler nach der Frist wird gemeldet", async (t) => {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  let scheitern;
  const anrufe = mitSpeicher(
    () =>
      new Promise((_, abgelehnt) => {
        scheitern = abgelehnt;
      }),
  );

  const warten = anrufe.addTranscript(ANRUF, "agent", "Hallo");
  mock.timers.tick(FRIST_MS);
  await warten;
  assert.equal(console.error.mock.callCount(), 0);
  scheitern(new Error("spaet kaputt"));
  await new Promise((fertig) => setImmediate(fertig));

  assert.equal(console.error.mock.callCount(), 1);
  const { calls: fehlerAufrufe } = console.error.mock;
  const [fehlerText] = fehlerAufrufe[0].arguments;
  const meldung = String(fehlerText);
  assert.match(meldung, /call_frist_1/);
  assert.match(meldung, /spaet kaputt/);
});

test("Transkript-Frist: Fehler vor der Frist wirft und wird nicht zusaetzlich gemeldet", async (t) => {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  const anrufe = mitSpeicher(() => Promise.reject(new Error("frueh kaputt")));

  await assert.rejects(anrufe.addTranscript(ANRUF, "agent", "Hallo"), /frueh kaputt/);
  mock.timers.tick(FRIST_MS);
  await new Promise((fertig) => setImmediate(fertig));

  assert.equal(console.error.mock.callCount(), 0);
});

test("Transkript-Frist: ein Speicher, der synchron und ohne Versprechen schreibt (JSON), antwortet ohne Warnung", async (t) => {
  t.mock.method(console, "warn", () => {});
  const anrufe = mitSpeicher(() => undefined);

  assert.equal(await anrufe.addTranscript(ANRUF, "agent", "Hallo"), undefined);
  assert.equal(console.warn.mock.callCount(), 0);
});
