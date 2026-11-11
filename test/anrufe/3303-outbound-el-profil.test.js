import { test } from "node:test";
import assert from "node:assert/strict";

import { EL_INBOUND_ACCESS_BOOT_ENV, seedCall, seedState, startServer, waitForLog } from "../helpers.js";
import { BRIDGE_STATE, bridgeStateOf, uebergabeGescheitert } from "../../src/elevenlabs/inbound-bridge-state.js";
import { AUSFALL_KLASSE } from "../../src/telephony/outage-classes.js";
import { outageWindow } from "../../src/telephony/outage-detection.js";

const OUTBOUND_EL = "telnyx_outbound_el_convai";
const INBOUND_EL = "telnyx_inbound_el_convai";
const ABGEHOBEN = "2026-11-07T10:00:00.000Z";
const ENDE = "2026-11-07T10:01:00.000Z";
const JETZT_MS = Date.parse("2026-11-07T10:02:00.000Z");
const FENSTER_MS = 600000;
const KONV_ID = "conv_3303";

const BRUECKENZUSTAND = [
  { fall: "ausgehend klingelt (ohne answeredAt)", call: { costProfile: OUTBOUND_EL }, soll: BRIDGE_STATE.KEIN_EL_INBOUND, gescheitert: false },
  { fall: "ausgehend abgehoben, ungebunden", call: { costProfile: OUTBOUND_EL, answeredAt: ABGEHOBEN }, soll: BRIDGE_STATE.WARTET, gescheitert: true },
  { fall: "ausgehend abgehoben, gebunden", call: { costProfile: OUTBOUND_EL, answeredAt: ABGEHOBEN, elevenlabsConversationId: KONV_ID }, soll: BRIDGE_STATE.GEBUNDEN, gescheitert: false },
  { fall: "ausgehend abgehoben, Rueckfall", call: { costProfile: OUTBOUND_EL, answeredAt: ABGEHOBEN, elFallbackAt: ENDE }, soll: BRIDGE_STATE.RUECKFALL, gescheitert: true },
  { fall: "Gegenfall inbound ohne answeredAt bleibt WARTET", call: { costProfile: INBOUND_EL }, soll: BRIDGE_STATE.WARTET, gescheitert: true },
  { fall: "Gegenfall inbound gebunden", call: { costProfile: INBOUND_EL, elevenlabsConversationId: KONV_ID }, soll: BRIDGE_STATE.GEBUNDEN, gescheitert: false },
];

for (const { fall, call, soll, gescheitert } of BRUECKENZUSTAND) {
  test(`3303-K6: bridgeStateOf/uebergabeGescheitert | ${fall}`, () => {
    assert.equal(bridgeStateOf(call), soll);
    assert.equal(uebergabeGescheitert(call), gescheitert);
  });
}

const KLINGELT_ID = "call_3303_klingelt";
const ABGEHOBEN_ID = "call_3303_abgehoben";
const LOG_FRIST_MS = 8000;
const FRIST_UEBERSCHRITTEN_MS = 35000;
const MAX_DAUER_S = 600;

function neustartSeed() {
  const abgehobenAt = new Date(Date.now() - FRIST_UEBERSCHRITTEN_MS).toISOString();
  const gemeinsam = { direction: "outbound", provider: "telnyx", maxDurationS: MAX_DAUER_S, costProfile: OUTBOUND_EL };
  return seedState({
    settings: { allowSummaries: false },
    calls: [
      seedCall({ ...gemeinsam, id: KLINGELT_ID, twilioSid: "v3:klingelt" }),
      seedCall({ ...gemeinsam, id: ABGEHOBEN_ID, twilioSid: "v3:abgehoben", answeredAt: abgehobenAt, startedAt: abgehobenAt }),
    ],
  });
}

test("3303-K6: Neustart re-armiert nur den abgehobenen ausgehenden Anruf, der klingelnde loest keine Umleitung aus", async () => {
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      ELEVENLABS_INBOUND_ENABLED: "true",
      ELEVENLABS_INBOUND_TENANT_IDS: "t_3303",
      ...EL_INBOUND_ACCESS_BOOT_ENV,
    },
    seed: neustartSeed(),
  });
  try {
    await waitForLog(srv, /\[el-inbound\] Fristen re-armiert: 1 Anrufe/, LOG_FRIST_MS);
    await waitForLog(srv, new RegExp(`\\[el-inbound\\] frist_abgelaufen call=${ABGEHOBEN_ID}`), LOG_FRIST_MS);
    assert.ok(!srv.stdout.includes(`call=${KLINGELT_ID}`), "der klingelnde Anruf darf keine el-inbound-Zeile erzeugen");
  } finally {
    await srv.stop();
  }
});

function beendet(call) {
  return { tenantId: "t1", endedAt: ENDE, ...call };
}

const AUSFALLZAEHLUNG = [
  { fall: "ausgehend, Rueckfall: weder Versuch noch Fehler", call: { direction: "outbound", costProfile: OUTBOUND_EL, answeredAt: ABGEHOBEN, elFallbackAt: ENDE }, soll: { versuche: 0, fehler: 0, erfolge: 0 } },
  { fall: "ausgehend, gebunden: kein Versuch", call: { direction: "outbound", costProfile: OUTBOUND_EL, answeredAt: ABGEHOBEN, elevenlabsConversationId: KONV_ID }, soll: { versuche: 0, fehler: 0, erfolge: 0 } },
  { fall: "Richtung outbound schlaegt jedes EL-Profil: kein Versuch", call: { direction: "outbound", costProfile: INBOUND_EL, elFallbackAt: ENDE }, soll: { versuche: 0, fehler: 0, erfolge: 0 } },
  { fall: "Gegenfall inbound, Rueckfall: Versuch und Fehler", call: { direction: "inbound", costProfile: INBOUND_EL, elFallbackAt: ENDE }, soll: { versuche: 1, fehler: 1, erfolge: 0 } },
  { fall: "Gegenfall inbound, gebunden: Versuch und Erfolg", call: { direction: "inbound", costProfile: INBOUND_EL, elevenlabsConversationId: KONV_ID }, soll: { versuche: 1, fehler: 0, erfolge: 1 } },
];

for (const { fall, call, soll } of AUSFALLZAEHLUNG) {
  test(`3303-K7: Inbound-Ausfallzaehlung | ${fall}`, () => {
    const zahlen = outageWindow([beendet(call)], {
      nowMs: JETZT_MS,
      windowMs: FENSTER_MS,
      bucket: "egal",
      zaehlweise: AUSFALL_KLASSE.INBOUND_EL.zaehlweise,
    });
    assert.deepEqual({ versuche: zahlen.versuche, fehler: zahlen.fehler, erfolge: zahlen.erfolge }, soll);
  });
}
