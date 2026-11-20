import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BEREIT_FRIST_MS,
  SCHWELLEN,
  gesamtFristMs,
} from "../../scripts/ausfallproben/schwellen.mjs";

const RESERVE_MS = 20_000;
const SCHLIMMSTER_PFAD_MS = {
  "elevenlabs-aus": BEREIT_FRIST_MS + 5 * (500 + 10_000),
  "elevenlabs-langsam": BEREIT_FRIST_MS + 5 * (500 + 10_000),
  "postgres-neustart": BEREIT_FRIST_MS + 10_000 + 30_000,
  "instanz-tod": 2 * BEREIT_FRIST_MS + 10_000 + 2000,
  "deploy-bei-anruf": BEREIT_FRIST_MS + 8000 + 10_000 + 60_000,
};

for (const [probe, erwartet] of Object.entries(SCHLIMMSTER_PFAD_MS)) {
  test(`gesamtfrist: ${probe} hat Kinder mal Bereit-Frist plus Laufzeit plus Reserve`, () => {
    assert.equal(gesamtFristMs(probe), erwartet + RESERVE_MS);
    assert.ok(gesamtFristMs(probe) > erwartet);
  });
}

test("gesamtfrist: jede Probe in SCHWELLEN hat eine Gesamtfrist", () => {
  assert.deepEqual(Object.keys(SCHWELLEN).sort(), Object.keys(SCHLIMMSTER_PFAD_MS).sort());
});

test("gesamtfrist: ein Kind kurz vor der Bereit-Frist laesst jede Probe durchlaufen, ein nie bereites Kind scheitert an der Bereit-Frist zuerst", () => {
  for (const probe of Object.keys(SCHLIMMSTER_PFAD_MS)) {
    assert.ok(
      gesamtFristMs(probe) > BEREIT_FRIST_MS + (SCHLIMMSTER_PFAD_MS[probe] - BEREIT_FRIST_MS),
    );
    assert.ok(gesamtFristMs(probe) >= BEREIT_FRIST_MS + RESERVE_MS);
  }
});
