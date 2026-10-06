import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import {
  voiceControl,
  messaging,
  webhookEvents,
  numberProvisioning,
  voiceRenderer,
  providerFromHeaders,
  inboundSignatureVerifier,
} from "../src/telephony/registry.js";
import { PROVIDER, DEFAULT_PROVIDER, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { telnyxVoice } from "../src/telephony/adapters/telnyx/voice.js";
import { renderDirectives as telnyxRenderDirectives } from "../src/telephony/adapters/telnyx/render.js";
import { telnyxNumberProvisioning } from "../src/telephony/adapters/telnyx/numbers.js";
import {
  makeDefaultState,
  createCall,
  seedBootstrapNumberFromConfig,
} from "../src/store/state-ops.js";
import { DIRECTIVE, VOICE_PROFILE } from "../src/telephony/directives.js";

const FULL_COVERAGE = [
  ["voiceControl", voiceControl],
  ["messaging", messaging],
  ["webhookEvents", webhookEvents],
  ["voiceRenderer", voiceRenderer],
];

test("pick liefert die exakte Adapter-Instanz je Provider", () => {
  config.safety.fakeOriginate = false;
  assert.equal(voiceControl(PROVIDER.TELNYX), telnyxVoice);
  assert.equal(numberProvisioning(PROVIDER.TELNYX), telnyxNumberProvisioning);
  const probe = [
    { kind: DIRECTIVE.GATHER, action: "/voice/turn?callId=c1", voiceProfile: VOICE_PROFILE.DE_FEMALE_NEURAL },
  ];
  assert.equal(
    voiceRenderer(PROVIDER.TELNYX).renderDirectives(probe),
    telnyxRenderDirectives(probe, { sttProfile: config.voice.sttProfile }),
  );
});

test("arg-lose Factories defaulten auf DEFAULT_PROVIDER (kein zweiter Anbieter-Default)", () => {
  config.safety.fakeOriginate = false;
  for (const [name, factory] of FULL_COVERAGE) {
    assert.equal(factory(), factory(DEFAULT_PROVIDER), `${name}: arg-los weicht ab`);
    assert.equal(factory(undefined), factory(DEFAULT_PROVIDER), `${name}: undefined weicht ab`);
  }
  assert.equal(numberProvisioning(), telnyxNumberProvisioning);
});

test("fakeOriginate-Override greift vor pick, fuer jeden Provider inkl. unbekannt", async () => {
  config.safety.fakeOriginate = true;
  try {
    const a = voiceControl(PROVIDER.TELNYX);
    assert.equal(a, voiceControl());
    assert.equal(a, voiceControl("nonsense"));
    assert.notEqual(a, telnyxVoice);
    assert.match((await a.originateCall()).sid, /^fake_/);
  } finally {
    config.safety.fakeOriginate = false;
  }
});

test("unbekannter Provider -> Wurf mit Provider-Namen, ohne Secret", () => {
  config.safety.fakeOriginate = false;
  for (const [name, factory] of FULL_COVERAGE) {
    assert.throws(() => factory("nonsense"), (e) => {
      assert.match(e.message, /nicht unterstuetzt/, name);
      assert.match(e.message, /nonsense/);
      assert.doesNotMatch(e.message, /token|key|secret/i);
      return true;
    });
  }
  assert.throws(() => numberProvisioning("twilio"), /nicht unterstuetzt/);
});

test("inboundSignatureVerifier wirft nie und liefert false", () => {
  config.server.publicUrl = "";
  config.telephony.telnyxPublicKey = "";
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

test("jeder PROVIDER-Wert ist in jedem Full-Coverage-Port registriert", () => {
  config.safety.fakeOriginate = false;
  for (const provider of Object.values(PROVIDER))
    for (const [name, factory] of FULL_COVERAGE)
      assert.doesNotThrow(() => factory(provider), `${name}/${provider} fehlt in ADAPTERS`);
});

test("call.provider-Eintrittspfade produzieren nur Enum-Werte", () => {
  assert.equal(providerFromHeaders({ "x-random": "1" }), null);
  const s = makeDefaultState();
  const c = createCall(s, {
    direction: "outbound",
    from: "+491",
    to: "+490",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  assert.equal(c.provider, DEFAULT_PROVIDER);
  seedBootstrapNumberFromConfig(s, "+15005550006", BOOTSTRAP_TENANT_ID, "twillio");
  assert.equal(s.numbers.length, 0, "Muell-Provider wird NICHT als Nummer geseedet");
  seedBootstrapNumberFromConfig(s, "+15005550006", BOOTSTRAP_TENANT_ID, PROVIDER.TELNYX);
  assert.equal(s.numbers.length, 1);
});
