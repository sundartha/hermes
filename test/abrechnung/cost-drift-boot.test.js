import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { COST_TRUING_SOURCE } from "../../src/begriffe/abrechnung.ts";
import { mitDatenbankVorDemStart } from "../anrufe/zwei-instanzen-postgres.js";

test("P5-B3: BASE_ENV (leerer Alarmkanal) -> Server startet, genau eine PLATFORM_ALERT_SMS_TO-WARN, kein Boot-Refusal", async () => {
  const srv = await startServer({});
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    const matches = srv.stdout.match(/PLATFORM_ALERT_SMS_TO ist leer/g);
    assert.equal(matches ? matches.length : 0, 1, `erwartet genau eine WARN-Zeile, Output:\n${srv.stdout}`);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
  } finally {
    await srv.stop();
  }
});

test("P5-B4: PLATFORM_ALERT_SMS_TO gesetzt -> keine Alarmkanal-WARN, die Nummer erscheint NIRGENDS im Log", async () => {
  const NUMBER = "+491234567890";
  const srv = await startServer({ env: { PLATFORM_ALERT_SMS_TO: NUMBER } });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /PLATFORM_ALERT_SMS_TO ist leer/);
    assert.doesNotMatch(
      srv.stdout,
      new RegExp(NUMBER.replace("+", "\\+")),
      "die Zielnummer darf nirgends im Boot-Log erscheinen (Regel 4/PII)",
    );
  } finally {
    await srv.stop();
  }
});

test("P5-B5: genau eine [boot] Tarif-Drift:-Zeile, nicht eine je Praefix (WARN-Muedigkeit)", async () => {
  const srv = await startServer({});
  try {
    const matches = srv.stdout.match(/\[boot\] Tarif-Drift:/g);
    assert.equal(matches ? matches.length : 0, 1, `erwartet genau eine Zeile, Output:\n${srv.stdout}`);
  } finally {
    await srv.stop();
  }
});

const MINUTE_MS = 60_000;
const MICRO_CENTS_PER_CENT = 1_000_000;
const PROBE_KOSTEN_CENT = 5;
const PROBE_SQL = `UPDATE call SET from_e164 = '+4930123456', to_e164 = '+4915112345678',
  answered_at = $2, ended_at = $3, actual_cost_micro_cents = $4, cost_trued_source = $5 WHERE id = $1`;

test("Kriterium 4: Anruf nur in der Datenbank (andere Instanz) zaehlt in der Tarif-Drift-Zeile beim Start", async (t) => {
  await mitDatenbankVorDemStart(t, { anrufe: ["call_drift_probe"] }, async ({ sql, starte }) => {
    const jetzt = Date.now();
    await sql(PROBE_SQL, [
      "call_drift_probe",
      new Date(jetzt - 2 * MINUTE_MS).toISOString(),
      new Date(jetzt - MINUTE_MS).toISOString(),
      PROBE_KOSTEN_CENT * MICRO_CENTS_PER_CENT,
      COST_TRUING_SOURCE.DETAIL_RECORDS,
    ]);
    const srv = await starte();
    assert.match(srv.stdout, /\[boot\] Tarif-Drift: praefix=\+49 stichproben=1 /);
    assert.match(srv.stdout, /praefix=\+33 stichproben=0 /);
  });
});
