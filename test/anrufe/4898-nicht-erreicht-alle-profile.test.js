import assert from "node:assert/strict";
import { test } from "node:test";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { NICHT_ERREICHT_FRIST_MS, nichtErreichtNachFrist } from "../../src/elevenlabs/nicht-erreicht-frist.ts";

const START_ISO = "2026-01-01T10:00:00.000Z";
const START_MS = Date.parse(START_ISO);
const KEIN_GESPRAECH = { transcript: [], metadata: { call_duration_secs: 0 } };
const GESPROCHEN = { transcript: [{ message: "Hallo" }], metadata: { call_duration_secs: 0 } };
const MIT_DAUER = { transcript: [], metadata: { call_duration_secs: 3 } };

const AUSGEHEND = [KOSTENPROFIL.EL_CONVAI_SIP, KOSTENPROFIL.TELNYX_BUDGET, KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI];
const EINGEHEND = [KOSTENPROFIL.TELNYX_INBOUND_BUDGET, KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI];

const frage = (costProfile, versatz, conversation) =>
  nichtErreichtNachFrist({ call: { costProfile, startedAt: START_ISO }, conversation, nowMs: START_MS + versatz });

for (const profil of AUSGEHEND) {
  test(`4898 K2/K3: ${profil} endet bei 75000 ms, nicht bei 74999 ms`, () => {
    assert.equal(frage(profil, NICHT_ERREICHT_FRIST_MS - 1, KEIN_GESPRAECH), false);
    assert.equal(frage(profil, NICHT_ERREICHT_FRIST_MS, KEIN_GESPRAECH), true);
  });

  test(`4898 K4: ${profil} mit gesprochenen Zeilen oder Anbieterdauer bleibt aktiv`, () => {
    assert.equal(frage(profil, NICHT_ERREICHT_FRIST_MS * 2, GESPROCHEN), false);
    assert.equal(frage(profil, NICHT_ERREICHT_FRIST_MS * 2, MIT_DAUER), false);
  });
}

for (const profil of EINGEHEND) {
  test(`4898: eingehendes Profil ${profil} wird von der Frist nicht berührt`, () => {
    assert.equal(frage(profil, NICHT_ERREICHT_FRIST_MS * 2, KEIN_GESPRAECH), false);
  });
}
