import assert from "node:assert/strict";
import { test } from "node:test";

import { elSipUri, elSipZiel } from "../../src/elevenlabs/inbound-sip-uri.ts";
import { isInboundElScope } from "../../src/elevenlabs/inbound-scope.ts";
import { legRunsOurTurnLoop } from "../../src/telephony/leg-turn-loop.ts";
import { isSttProfile } from "../../src/telephony/stt-profile.ts";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";

const NUMMER = "+4915112345678";

test("3399-v2: Nicht-Text als Nummer wird abgelehnt, auch wenn er wie E.164 aussieht", () => {
  const wieNummer = { toString: () => NUMMER };
  assert.throws(() => elSipUri({ did: wieNummer, token: "t" }), /DID ist keine E\.164-Nummer/);
  assert.throws(() => elSipZiel(wieNummer), /Absender ist keine E\.164-Nummer/);
  assert.equal(elSipZiel(NUMMER), `sip:${NUMMER}@sip.rtc.elevenlabs.io`);
});

test("3399-v2: SIP-Adresse traegt Port, Transport und das kodierte Bindungs-Token", () => {
  assert.equal(
    elSipUri({ did: NUMMER, token: "a b/c" }),
    `sip:${NUMMER}@sip.rtc.elevenlabs.io:5060;transport=tcp?X-Hermes-Call-Binding=a%20b%2Fc`,
  );
});

test("3399-v2: fehlendes oder kein Text als Bindungs-Token wird abgelehnt", () => {
  for (const token of [undefined, null, "", 5, {}]) {
    assert.throws(() => elSipUri({ did: NUMMER, token }), /Bindungs-Token fehlt/);
  }
});

test("3399-v2: Bereich und Sprachprofil erkennen nur ihre bekannten Werte", () => {
  const tabelle = [
    [isInboundElScope, "allowlist", true],
    [isInboundElScope, "registrierte_dids", true],
    [isInboundElScope, "alle", false],
    [isInboundElScope, undefined, false],
    [isSttProfile, "accurate", true],
    [isSttProfile, "fast", false],
    [isSttProfile, undefined, false],
  ];
  for (const [pruefe, wert, erwartet] of tabelle) assert.equal(pruefe(wert), erwartet, `${wert}`);
});

test("3399-v2: eigene Gespraechsschleife je Kostenprofil, unbekannt oder fehlend laeuft mit", () => {
  const tabelle = [
    [{ costProfile: KOSTENPROFIL.TELNYX_BUDGET }, true],
    [{ costProfile: KOSTENPROFIL.TELNYX_INBOUND_BUDGET }, true],
    [{ costProfile: KOSTENPROFIL.EL_CONVAI_SIP }, false],
    [{ costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI }, false],
    [{ costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI }, false],
    [{ costProfile: "unbekannt" }, true],
    [{ costProfile: "toString" }, true],
    [{}, true],
    [null, true],
    [undefined, true],
  ];
  for (const [call, erwartet] of tabelle) assert.equal(legRunsOurTurnLoop(call), erwartet, JSON.stringify(call));
});
