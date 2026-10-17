import { test } from "node:test";
import assert from "node:assert/strict";
import { gebauteKonfiguration } from "./gebaute-konfiguration.js";

const MINDESTPROBEN = "billing.costCalibrationMinSamples";
const SYNTHESE_FRIST = "voice.elevenLabsPlayTts.synthTimeoutMs";
const STUNDENLIMIT = "safety.maxCallsPerHour";
const MINDESTPROBEN_STANDARD = 20;
const MINDESTPROBEN_GESETZT = 7;
const SYNTHESE_FRIST_STANDARD = 2000;
const STUNDENLIMIT_TESTBASIS = 100;
const STUNDENLIMIT_STANDARD = 6;

test("ohne gesetzte Variable liefert die gebaute Konfiguration den Standardwert, auch verschachtelt", () => {
  assert.deepEqual(gebauteKonfiguration({}, [MINDESTPROBEN, SYNTHESE_FRIST]), {
    [MINDESTPROBEN]: MINDESTPROBEN_STANDARD,
    [SYNTHESE_FRIST]: SYNTHESE_FRIST_STANDARD,
  });
});

test("eine gesetzte Variable landet im gebauten Feld", () => {
  const gebaut = gebauteKonfiguration({ COST_CALIBRATION_MIN_SAMPLES: String(MINDESTPROBEN_GESETZT) }, [MINDESTPROBEN]);
  assert.deepEqual(gebaut, { [MINDESTPROBEN]: MINDESTPROBEN_GESETZT });
});

test("undefined entfernt eine Variable aus der Testbasis, sodass der Standardwert greift", () => {
  assert.deepEqual(gebauteKonfiguration({}, [STUNDENLIMIT]), { [STUNDENLIMIT]: STUNDENLIMIT_TESTBASIS });
  const gebaut = gebauteKonfiguration({ MAX_CALLS_PER_HOUR: undefined }, [STUNDENLIMIT]);
  assert.deepEqual(gebaut, { [STUNDENLIMIT]: STUNDENLIMIT_STANDARD });
});

test("ein verlangtes Feld ohne Wert in der gebauten Konfiguration bricht ab, statt still zu fehlen", () => {
  const OHNE_WERT = `${STUNDENLIMIT}.gibtEsNicht`;
  assert.throws(() => gebauteKonfiguration({}, [OHNE_WERT, STUNDENLIMIT]), (fehler) => fehler.message.includes(OHNE_WERT));
});

test("ein übergebenes NODE_ENV außer test bricht ab, statt still verworfen zu werden", () => {
  for (const nodeEnv of ["production", undefined]) {
    assert.throws(
      () => gebauteKonfiguration({ NODE_ENV: nodeEnv }, [STUNDENLIMIT]),
      (fehler) => fehler.message.includes("NODE_ENV") && fehler.message.includes(String(nodeEnv)),
    );
  }
});

test("ein übergebenes NODE_ENV=test ändert nichts an der gebauten Konfiguration", () => {
  assert.deepEqual(gebauteKonfiguration({ NODE_ENV: "test" }, [STUNDENLIMIT]), { [STUNDENLIMIT]: STUNDENLIMIT_TESTBASIS });
});
