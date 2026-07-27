// GAP-08 Review-Blocker (P2, Runde 2): providerRateOutOfBand (test/provider-rate-guard.test.js)
// prueft nur die Provider-Achse fuer sich gegen ein Toleranzband, nicht die LLM-Achse
// (config.llm.usdToEur) GEGEN die Provider-Achse (config.billing.providerToBucketRateMicro).
// Beide sind unabhaengig per Env setzbar (USD_TO_EUR bzw. PROVIDER_TO_BUCKET_RATE_MICRO) -
// setzt ein Operator bei einer Kurskorrektur nur eine der beiden Variablen, laufen die
// Achsen auseinander, obwohl jede fuer sich im gueltigen Bereich bleibt. Dieser Test deckt
// fxRateAxesDiverged (src/boot-guard.js) ab: den Kreuz-Check der beiden Achsen gegeneinander.
// Reiner Unit-Teil (f1, Muster test/provider-rate-guard.test.js: kein pglite, kein Netz -
// F.I.R.S.T.) + Boot-Beweis via startServer (f2, Muster test/boot-failclosed.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fxRateAxesDiverged, FX_RATE_FINDING } from "../src/boot-guard.js";
import { startServer, startServerExpectExit } from "./helpers.js";

// ---- (f1) Unit ----

test("F1-01: uebereinstimmende Achsen (0.92 vs. 920000 Mikro) -> []", () => {
  assert.deepEqual(
    fxRateAxesDiverged({ usdToEur: 0.92, providerToBucketRateMicro: 920000 }),
    [],
  );
});

test("F1-02: der urspruengliche GAP-08-Fehler (0.93 vs. 920000 Mikro = 0.92) -> genau ein Befund, code+fatal", () => {
  const findings = fxRateAxesDiverged({ usdToEur: 0.93, providerToBucketRateMicro: 920000 });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, FX_RATE_FINDING.AXES_DIVERGED);
  assert.equal(findings[0].fatal, true, "beide Achsen bewegen Geld - ein Auseinanderlaufen ist Schutzverlust");
});

test("F1-03: Abweichung knapp innerhalb der Toleranz -> []", () => {
  assert.deepEqual(
    fxRateAxesDiverged({ usdToEur: 0.924, providerToBucketRateMicro: 920000 }),
    [],
  );
});

test("F1-04: Abweichung knapp ausserhalb der Toleranz -> ein Befund", () => {
  assert.equal(
    fxRateAxesDiverged({ usdToEur: 0.926, providerToBucketRateMicro: 920000 }).length,
    1,
  );
});

// ---- (f2) Boot-Beweis, ohne jedes Flag-Setup ----

test("F2-01: USD_TO_EUR=0.5 waehrend PROVIDER_TO_BUCKET_RATE_MICRO=920000 bleibt -> Boot-Refusal", async () => {
  const { code, output } = await startServerExpectExit({
    env: { USD_TO_EUR: "0.5", PROVIDER_TO_BUCKET_RATE_MICRO: "920000" },
  });
  assert.equal(code, 1);
  assert.match(output, /Start abgebrochen/);
  assert.doesNotMatch(output, /Gateway laeuft/);
});

test("F2-02: Gegenprobe - beide Achsen zusammen auf 0.5 gesetzt -> keine Divergenz-Zeile, Boot laeuft", async () => {
  const srv = await startServer({ env: { USD_TO_EUR: "0.5", PROVIDER_TO_BUCKET_RATE_MICRO: "500000" } });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /weichen um mehr als/);
  } finally {
    await srv.stop();
  }
});
