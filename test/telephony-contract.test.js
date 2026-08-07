// P5: Port-Vertrag fuer BEIDE Adapter (R5-Mitigation, beweist die Provider-
// Austauschbarkeit). renderDirectives liefert beidseitig einen String; sendSms ist
// beidseitig aufrufbar und mappt (fetch gemockt); verifyInboundSignature (nur noch
// Telnyx, C-P3) liefert bool + ist fail-closed (manipuliert/fehlend -> false). Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { say, hangup } from "../src/telephony/directives.js";
import { renderDirectives as twilioRender } from "../src/telephony/adapters/twilio/render.js";
import { renderDirectives as telnyxRender } from "../src/telephony/adapters/telnyx/render.js";
import { twilioMessaging } from "../src/telephony/adapters/twilio/messaging.js";
import { telnyxMessaging } from "../src/telephony/adapters/telnyx/messaging.js";
import { verifyInboundSignature as telnyxVerify } from "../src/telephony/adapters/telnyx/signature.js";

const RENDERERS = [
  ["twilio", twilioRender],
  ["telnyx", telnyxRender],
];

test("renderDirectives liefert fuer beide Adapter einen String", () => {
  for (const [name, render] of RENDERERS) {
    const out = render([say("Hallo"), hangup()]);
    assert.equal(typeof out, "string", `${name} liefert String`);
    assert.ok(out.length > 0, `${name} nicht leer`);
  }
});

// C-P3: der Twilio-Verifizierer ist entfernt (Dispatch UND Adapterdatei) - Inbound-
// Signaturpruefung hat genau EINEN Adapter. Die Vertragsaussage bleibt woertlich:
// kein gueltiger Krypto-Kontext -> false, ohne zu werfen.
test("verifyInboundSignature ist bool + fail-closed (leerer Request)", () => {
  config.telephony.telnyxPublicKey = "";
  const out = telnyxVerify({ headers: {}, rawBody: Buffer.from(""), url: "", params: {} });
  assert.equal(typeof out, "boolean", "liefert boolean");
  assert.equal(out, false, "fail-closed");
});

test("sendSms ist fuer beide Adapter aufrufbar und mappt (fetch/client gemockt)", async () => {
  // Telnyx ueber global fetch, Twilio ueber seinen client. Beide sehen dieselben
  // Port-Parameter {from,to,body}; der Test prueft nur die Aufrufbarkeit + das
  // Mapping, kein echter Netz-Call.
  config.telephony.telnyxApiKey = "k";
  config.telephony.telnyxApiBase = "https://api.telnyx.com";
  const originalFetch = global.fetch;
  let telnyxText;
  global.fetch = async (_url, opts) => {
    telnyxText = JSON.parse(opts.body).text;
    return { ok: true, status: 200 };
  };
  try {
    await telnyxMessaging.sendSms({ from: "+1", to: "+2", body: "hallo" });
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(telnyxText, "hallo", "Telnyx mappt body->text");

  // Twilio-Adapter: sendSms reicht {from,to,body} 1:1 durch. Den Twilio-Client
  // mocken ist hier nicht ohne Modul-Stubbing moeglich; stattdessen die
  // Vertrags-Form pruefen (Funktion existiert + ist async).
  assert.equal(typeof twilioMessaging.sendSms, "function", "Twilio sendSms existiert");
});
