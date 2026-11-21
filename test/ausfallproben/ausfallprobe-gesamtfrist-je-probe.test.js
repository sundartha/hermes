import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BEREIT_FRIST_MS,
  SCHWELLEN,
  gesamtFristMs,
} from "../../scripts/ausfallproben/schwellen.mjs";

const RESERVE_MS = 20_000;
const STOPP_FRIST_MS = 10_000;
const BIS_NICHT_BEREIT_MS = {
  "elevenlabs-aus": BEREIT_FRIST_MS + STOPP_FRIST_MS + BEREIT_FRIST_MS,
  "elevenlabs-langsam": BEREIT_FRIST_MS + STOPP_FRIST_MS + BEREIT_FRIST_MS,
  "postgres-neustart": BEREIT_FRIST_MS,
  "instanz-tod": 3 * BEREIT_FRIST_MS,
  "deploy-bei-anruf": BEREIT_FRIST_MS,
};
const SCHLIMMSTER_PFAD_MS = {
  "elevenlabs-aus": 2 * BEREIT_FRIST_MS + STOPP_FRIST_MS + 5 * (500 + 10_000),
  "elevenlabs-langsam": 2 * BEREIT_FRIST_MS + STOPP_FRIST_MS + 5 * (500 + 10_000),
  "postgres-neustart": BEREIT_FRIST_MS + 10_000 + 30_000,
  "instanz-tod": 3 * BEREIT_FRIST_MS + 10_000 + 2000,
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

for (const [probe, bisNichtBereit] of Object.entries(BIS_NICHT_BEREIT_MS)) {
  test(`gesamtfrist: ${probe} meldet "nicht bereit" vor der Zeitueberschreitung`, () => {
    assert.ok(gesamtFristMs(probe) > bisNichtBereit);
  });
}
