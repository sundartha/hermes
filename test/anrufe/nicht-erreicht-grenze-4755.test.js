import assert from "node:assert/strict";
import { test } from "node:test";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";
import { NICHT_ERREICHT_FRIST_MS, nichtErreichtNachFrist } from "../../src/elevenlabs/nicht-erreicht-frist.ts";

const START_ISO = "2026-01-01T10:00:00.000Z";
const START_MS = Date.parse(START_ISO);
const KEIN_GESPRAECH = { transcript: [], metadata: { call_duration_secs: 0 } };
const GESPROCHEN = { transcript: [{ message: "Hallo" }], metadata: { call_duration_secs: 0 } };
const MIT_DAUER = { transcript: [], metadata: { call_duration_secs: 3 } };

const TABELLE = [
  { name: "74999 ms", versatz: NICHT_ERREICHT_FRIST_MS - 1, conversation: KEIN_GESPRAECH, erwartet: false },
  { name: "75000 ms", versatz: NICHT_ERREICHT_FRIST_MS, conversation: KEIN_GESPRAECH, erwartet: true },
  { name: "75001 ms", versatz: NICHT_ERREICHT_FRIST_MS + 1, conversation: KEIN_GESPRAECH, erwartet: true },
  { name: "75000 ms, gesprochenes Transkript", versatz: NICHT_ERREICHT_FRIST_MS, conversation: GESPROCHEN, erwartet: false },
  { name: "75000 ms, Anbieterdauer 3 s", versatz: NICHT_ERREICHT_FRIST_MS, conversation: MIT_DAUER, erwartet: false },
];

for (const zeile of TABELLE) {
  test(`4755 K1 Grenze: ${zeile.name}`, () => {
    const call = { costProfile: KOSTENPROFIL.EL_CONVAI_SIP, startedAt: START_ISO };
    const nowMs = START_MS + zeile.versatz;
    assert.equal(nichtErreichtNachFrist({ call, conversation: zeile.conversation, nowMs }), zeile.erwartet);
  });
}
