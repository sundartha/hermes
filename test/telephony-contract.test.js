// P5: Port-Vertrag des Telefonie-Adapters. renderDirectives liefert einen String;
// sendSms ist aufrufbar und mappt (fetch gemockt); verifyInboundSignature (nur noch
// Telnyx, C-P3) liefert bool + ist fail-closed (manipuliert/fehlend -> false). Offline.
//
// C-P4: diese Datei fuehrte BEIDE Adapter und hiess im Kopf "beweist die Provider-
// Austauschbarkeit" (R5-Mitigation). Mit einem Adapter beweist sie das nicht mehr - eine
// Austauschbarkeits-Aussage braucht zwei Teilnehmer, und so zu tun, als gaebe es sie
// noch, waere die gefaehrlichere Variante. Was BLEIBT, ist der Vertrag selbst: welche
// FORM jede Port-Methode liefert. Genau daran misst sich der naechste Adapter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { say, hangup } from "../src/telephony/directives.js";
import { renderDirectives as telnyxRender } from "../src/telephony/adapters/telnyx/render.js";
import { telnyxMessaging } from "../src/telephony/adapters/telnyx/messaging.js";
import { verifyInboundSignature as telnyxVerify } from "../src/telephony/adapters/telnyx/signature.js";

test("renderDirectives liefert einen nicht-leeren String", () => {
  const out = telnyxRender([say("Hallo"), hangup()]);
  assert.equal(typeof out, "string", "liefert String");
  assert.ok(out.length > 0, "nicht leer");
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

test("sendSms ist aufrufbar und mappt (fetch gemockt)", async () => {
  // Der Adapter sieht die Port-Parameter {from,to,body}; der Test prueft die
  // Aufrufbarkeit + das Mapping, kein echter Netz-Call.
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
});
