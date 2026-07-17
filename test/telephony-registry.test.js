// P5: ADAPTERS-Tabelle + pick(port, provider) im Registry-Kern. Beweist: pick() liefert
// die exakte, importierte Adapter-Bindung (Identitaet, keine Kopie), defaultet arg-los
// byte-identisch auf Twilio (numberProvisioning -> Telnyx), wirft fail-closed bei einem
// unbekannten Provider (Fehlertext OHNE Secret), und der fakeOriginate-Override (Sonderfall
// a) greift weiterhin VOR pick(). Die Vollstaendigkeits-Invariante faengt einen kuenftig
// vergessenen dritten Provider VOR Deploy. Zusaetzlich: die realen call.provider-
// Eintrittspfade (Header, createCall-Default, Number-Seed) liefern fail-closed nur Enum-
// Werte VOR der Registry (Safety-Auflage PLAN-CLEAN-CODE.md P5). Offline (F.I.R.S.T.).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import {
  voiceControl,
  messaging,
  mediaTransport,
  webhookEvents,
  numberProvisioning,
  voiceRenderer,
  providerFromHeaders,
  inboundSignatureVerifier,
} from "../src/telephony/registry.js";
import { PROVIDER, DEFAULT_PROVIDER, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { twilioVoice } from "../src/telephony/adapters/twilio/voice.js";
import { telnyxVoice } from "../src/telephony/adapters/telnyx/voice.js";
import { twilioMedia } from "../src/telephony/adapters/twilio/media.js";
import { telnyxMedia } from "../src/telephony/adapters/telnyx/media.js";
import { renderDirectives as twilioRenderDirectives } from "../src/telephony/adapters/twilio/render.js";
import { telnyxNumberProvisioning } from "../src/telephony/adapters/telnyx/numbers.js";
import {
  makeDefaultState,
  createCall,
  seedBootstrapNumberFromConfig,
} from "../src/store/state-ops.js";

const FULL_COVERAGE = [
  ["voiceControl", voiceControl],
  ["messaging", messaging],
  ["mediaTransport", mediaTransport],
  ["webhookEvents", webhookEvents],
  ["voiceRenderer", voiceRenderer],
];

// ---- Selektion: exakte Adapter-Identitaet je Port/Provider ----
test("pick liefert die exakte Adapter-Instanz je Provider", () => {
  config.fakeOriginate = false;
  assert.equal(voiceControl(PROVIDER.TELNYX), telnyxVoice);
  assert.equal(voiceControl(PROVIDER.TWILIO), twilioVoice);
  assert.equal(mediaTransport(PROVIDER.TELNYX), telnyxMedia);
  assert.equal(mediaTransport(PROVIDER.TWILIO), twilioMedia);
  assert.equal(numberProvisioning(PROVIDER.TELNYX), telnyxNumberProvisioning);
  assert.equal(voiceRenderer(PROVIDER.TWILIO).renderDirectives, twilioRenderDirectives);
});

// ---- Default-Byte-Identitaet: arg-los -> Twilio (numberProvisioning -> Telnyx) ----
test("arg-lose Factories defaulten byte-identisch", () => {
  config.fakeOriginate = false;
  assert.equal(voiceControl(), twilioVoice);
  assert.equal(voiceControl(undefined), twilioVoice);
  assert.equal(mediaTransport(), twilioMedia);
  assert.equal(numberProvisioning(), telnyxNumberProvisioning);
});

// ---- fakeOriginate-Override VOR pick (Sonderfall a) ----
test("fakeOriginate-Override greift vor pick, fuer jeden Provider inkl. unbekannt", async () => {
  config.fakeOriginate = true;
  try {
    const a = voiceControl(PROVIDER.TWILIO);
    assert.equal(a, voiceControl(PROVIDER.TELNYX)); // dieselbe Fake-Instanz
    assert.equal(a, voiceControl("nonsense")); // Override -> KEIN pick-Wurf
    assert.notEqual(a, twilioVoice);
    assert.match((await a.originateCall()).sid, /^fake_/);
  } finally {
    config.fakeOriginate = false;
  }
});

// ---- fail-closed Wurf fuer unbekannten Provider, Fehlermeldung OHNE Secret ----
test("unbekannter Provider -> Wurf mit Provider-Namen, ohne Secret", () => {
  config.fakeOriginate = false;
  for (const [name, factory] of FULL_COVERAGE) {
    assert.throws(() => factory("nonsense"), (e) => {
      assert.match(e.message, /nicht unterstuetzt/, name);
      assert.match(e.message, /nonsense/); // Provider-Name im Text
      assert.doesNotMatch(e.message, /token|key|secret/i); // kein Secret
      return true;
    });
  }
  assert.throws(() => numberProvisioning(PROVIDER.TWILIO), /nicht unterstuetzt/);
});

// ---- Signatur-Gate wirft NIE (Sonderfall c) ----
test("inboundSignatureVerifier wirft nie und liefert false", () => {
  config.publicUrl = "";
  config.telnyxPublicKey = "";
  assert.doesNotThrow(() => {
    assert.equal(
      inboundSignatureVerifier().verifyInboundSignature({
        headers: {},
        rawBody: Buffer.from("{}"),
        url: "",
        params: {},
      }),
      false,
    );
    assert.equal(
      inboundSignatureVerifier().verifyInboundSignature({
        headers: { "telnyx-signature-ed25519": "x", "telnyx-timestamp": "1" },
        rawBody: Buffer.from("{}"),
      }),
      false,
    );
  });
});

// ---- Vollstaendigkeits-Invariante: jeder bekannte Provider ist in jedem Full-Coverage-
//      Port registriert (faengt einen kuenftig vergessenen dritten Provider VOR Deploy) ----
test("jeder PROVIDER-Wert ist in jedem Full-Coverage-Port registriert", () => {
  config.fakeOriginate = false;
  for (const provider of Object.values(PROVIDER))
    for (const [name, factory] of FULL_COVERAGE)
      assert.doesNotThrow(() => factory(provider), `${name}/${provider} fehlt in ADAPTERS`);
});

// ---- Eintrittspfade lehnen Unbekanntes fail-closed VOR pick ab (Safety-Auflage P5) ----
test("call.provider-Eintrittspfade produzieren nur Enum-Werte", () => {
  assert.equal(providerFromHeaders({ "x-random": "1" }), null); // Inbound nie Nicht-Enum
  const s = makeDefaultState();
  const c = createCall(s, {
    direction: "outbound",
    from: "+491",
    to: "+490",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  assert.equal(c.provider, DEFAULT_PROVIDER); // falsy -> Default
  seedBootstrapNumberFromConfig(s, "+15005550006", BOOTSTRAP_TENANT_ID, "twillio"); // Tippfehler
  assert.equal(s.numbers.length, 0, "Muell-Provider wird NICHT als Nummer geseedet");
  seedBootstrapNumberFromConfig(s, "+15005550006", BOOTSTRAP_TENANT_ID, PROVIDER.TELNYX);
  assert.equal(s.numbers.length, 1);
});
