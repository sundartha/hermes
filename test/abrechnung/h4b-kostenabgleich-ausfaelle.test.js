import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDefaultState } from "../../src/store/state-ops.js";
import { makeCostCrossCheck } from "../../src/billing/cost-cross-check.ts";
import { COST_LEDGER_MAP } from "../../src/billing/cost-ledger-map.ts";
import { USAGE_EVENT_KIND } from "../../src/begriffe/abrechnung.js";
import { makeStubStore, fakeConfig, fakeVoiceControl } from "../cost-truing-harness.js";
import { captureConsole } from "../helpers.js";

const NOW_ISO = "2026-08-15T12:00:00.000Z";

async function abgleichZeile(voiceControl) {
  const { runMonthlyCrossCheck } = makeCostCrossCheck({
    store: makeStubStore(makeDefaultState()),
    config: fakeConfig(),
    voiceControl,
  });
  const logs = await captureConsole(async () => {
    await runMonthlyCrossCheck(NOW_ISO);
  });
  return logs.find((zeile) => zeile.startsWith("[cost-cross-check] monat="));
}

test("h4b: Anbieter ohne Rechnungsabruf nennt port_missing in der Abgleichzeile", async () => {
  const zeile = await abgleichZeile(fakeVoiceControl({ telnyx: {} }));
  assert.equal(
    zeile,
    "[cost-cross-check] monat=2026-07 telnyx_rechnung=nicht_verfuegbar(reason=port_missing) ist_je_traeger=keine ist_gesamt_usd_micro_cent=0 gate_carrier_eur_cent=0",
  );
});

test("h4b: fehlender Telnyx-Anschluss nennt no_telnyx_adapter in der Abgleichzeile", async () => {
  const zeile = await abgleichZeile(fakeVoiceControl({}));
  assert.equal(
    zeile,
    "[cost-cross-check] monat=2026-07 telnyx_rechnung=nicht_verfuegbar(reason=no_telnyx_adapter) ist_je_traeger=keine ist_gesamt_usd_micro_cent=0 gate_carrier_eur_cent=0",
  );
});

test("h4b: Rechnung da, aber ohne Kostenbuch nennt kein_kostenbuch und null als Umrechnung", async () => {
  const zeile = await abgleichZeile(
    fakeVoiceControl({ telnyx: { fetchMonthlyInvoiceTotal: async () => ({ ok: true, totalMicroCents: 500 }) } }),
  );
  assert.match(zeile, /ist_telnyx_usd_micro_cent=null diff_rechnung_minus_ist=nicht_verfuegbar\(reason=kein_kostenbuch\) ist_je_traeger=keine /);
});

test("h4b: Kostenlandkarte Zeilen tragen Art, Ledger- und Gate-Flag unveraendert", () => {
  const flags = Object.entries(COST_LEDGER_MAP).map(([name, zeile]) => [name, zeile.kind, zeile.ledger, zeile.gate]);
  assert.deepEqual(flags, [
    ["voice_minute_outbound", USAGE_EVENT_KIND.VOICE_MINUTE, true, true],
    ["voice_minute_inbound", USAGE_EVENT_KIND.VOICE_MINUTE, true, true],
    ["ai_token", USAGE_EVENT_KIND.AI_TOKEN, true, true],
    ["research_fee", null, false, true],
    ["sms", USAGE_EVENT_KIND.SMS, true, false],
    ["number_month", USAGE_EVENT_KIND.NUMBER_MONTH, true, false],
    ["play_tts_characters", null, false, false],
  ]);
});
