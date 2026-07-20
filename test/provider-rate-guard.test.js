// LCT P2 (Kurs-Guard): providerRateOutOfBand (src/boot-guard.js) prueft den Umrechnungskurs
// Provider-Waehrung -> Ziel-Bucket gegen ein Toleranzband. Reiner Unit-Teil (f1, Muster
// test/spend-cap-coherence.test.js: kein pglite, kein Netz - F.I.R.S.T.) + Boot-Beweis via
// startServer (f2, Muster test/boot-failclosed.test.js). Datei-Disziplin (p6a): Spawn hier,
// KEIN pglite (das lebt in test/call-actual-cost-roundtrip.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { providerRateOutOfBand, PROVIDER_RATE_FINDING } from "../src/boot-guard.js";
import { startServer, startServerExpectExit } from "./helpers.js";

// ---- (f1) Unit ----

test("F1-01: 920 (Zehnerpotenz-Vertipper) -> genau ein Befund, code+fatal", () => {
  const findings = providerRateOutOfBand(920);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, PROVIDER_RATE_FINDING.OUT_OF_BAND);
  assert.equal(findings[0].fatal, true, "LCT P4: der Kurs bewegt jetzt Geld");
});

test("F1-02: 920000 (Anker) -> []", () => {
  assert.deepEqual(providerRateOutOfBand(920000), []);
});

test("F1-03: Bandraender - 460000 und 1840000 -> [] (im Band)", () => {
  assert.deepEqual(providerRateOutOfBand(460000), []);
  assert.deepEqual(providerRateOutOfBand(1840000), []);
});

test("F1-04: Bandraender - 459999 und 1840001 -> je ein Befund (ausserhalb)", () => {
  assert.equal(providerRateOutOfBand(459999).length, 1);
  assert.equal(providerRateOutOfBand(1840001).length, 1);
});

// ---- (f2) Boot-Beweis, ohne jedes Flag-Setup ----

test("F2-01: PROVIDER_TO_BUCKET_RATE_MICRO=920 -> Boot-Refusal (LCT P4: der Kurs bewegt jetzt Geld)", async () => {
  const { code, output } = await startServerExpectExit({ env: { PROVIDER_TO_BUCKET_RATE_MICRO: "920" } });
  assert.equal(code, 1);
  assert.match(output, /Start abgebrochen/);
  assert.doesNotMatch(output, /Gateway laeuft/);
  assert.doesNotMatch(
    output,
    /COST_TRUING_BOOKING_ENABLED/,
    "der Guard haengt an keinem Flag - er prueft unkonditional, auch wenn die Buchung selbst ausgeschaltet ist",
  );
});

test("F2-02: Gegenprobe PROVIDER_TO_BUCKET_RATE_MICRO=920000 -> keine WARN-Zeile", async () => {
  const srv = await startServer({ env: { PROVIDER_TO_BUCKET_RATE_MICRO: "920000" } });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /PROVIDER_TO_BUCKET_RATE_MICRO=920000 liegt ausserhalb/);
    assert.doesNotMatch(srv.stdout, /COST_TRUING_BOOKING_ENABLED/);
  } finally {
    await srv.stop();
  }
});
