import assert from "node:assert/strict";
import { test } from "node:test";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";
import { NICHT_ERREICHT_FRIST_MS, nichtErreichtNachFrist } from "../../src/elevenlabs/nicht-erreicht-frist.ts";

const START_ISO = "2026-01-01T10:00:00.000Z";
const START_MS = Date.parse(START_ISO);
const KEIN_GESPRAECH = { transcript: [], metadata: { call_duration_secs: 0 } };
const GESPROCHEN = { transcript: [{ message: "Hallo" }], metadata: { call_duration_secs: 0 } };
const MIT_DAUER = { transcript: [], metadata: { call_duration_secs: 3 } };
const ABFRAGE_PROFILE = [KOSTENPROFIL.EL_CONVAI_SIP, KOSTENPROFIL.TELNYX_BUDGET];
const OHNE_ABFRAGE_FRIST = [KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI, KOSTENPROFIL.TELNYX_INBOUND_BUDGET, KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI];

const frage = (costProfile, versatz, conversation) =>
  nichtErreichtNachFrist({ call: { costProfile, startedAt: START_ISO }, conversation, nowMs: START_MS + versatz });

for (const profil of ABFRAGE_PROFILE) {
  test(`4898 K2/K3 ${profil}: 74999 ms beendet nicht, 75000 ms beendet`, () => {
    assert.equal(frage(profil, NICHT_ERREICHT_FRIST_MS - 1, KEIN_GESPRAECH), false);
    assert.equal(frage(profil, NICHT_ERREICHT_FRIST_MS, KEIN_GESPRAECH), true);
  });

  test(`4898 K4 ${profil}: gesprochene Zeilen oder Anbieterdauer belegen die Annahme`, () => {
    assert.equal(frage(profil, NICHT_ERREICHT_FRIST_MS * 2, GESPROCHEN), false);
    assert.equal(frage(profil, NICHT_ERREICHT_FRIST_MS * 2, MIT_DAUER), false);
  });
}

for (const profil of OHNE_ABFRAGE_FRIST) {
  test(`4898 ${profil}: die Abfrage-Frist beendet diesen Anruf auch nach 150 s nicht`, () => {
    assert.equal(frage(profil, NICHT_ERREICHT_FRIST_MS * 2, KEIN_GESPRAECH), false);
  });
}
