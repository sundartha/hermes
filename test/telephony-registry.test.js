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
import { DIRECTIVE, VOICE_PROFILE } from "../src/telephony/directives.js";

const FULL_COVERAGE = [
  ["voiceControl", voiceControl],
  ["messaging", messaging],
  ["mediaTransport", mediaTransport],
  ["webhookEvents", webhookEvents],
  ["voiceRenderer", voiceRenderer],
];

// ---- Selektion: exakte Adapter-Identitaet je Port/Provider ----
test("pick liefert die exakte Adapter-Instanz je Provider", () => {
  config.safety.fakeOriginate = false;
  assert.equal(voiceControl(PROVIDER.TELNYX), telnyxVoice);
  assert.equal(voiceControl(PROVIDER.TWILIO), twilioVoice);
  assert.equal(mediaTransport(PROVIDER.TELNYX), telnyxMedia);
  assert.equal(mediaTransport(PROVIDER.TWILIO), twilioMedia);
  assert.equal(numberProvisioning(PROVIDER.TELNYX), telnyxNumberProvisioning);
  // STT-A1: beide Renderer sind jetzt hinter einem Lazy-Arrow registriert (config-Bindung
  // an der Kompositionsstelle, P15) - Referenz-Identitaet ist kein Kriterium mehr.
  // Geprueft wird die AUSGABE: die Registry liefert den Twilio-Renderer und injiziert das
  // Default-Profil, also exakt das arg-lose Bestandsergebnis.
  const probe = [
    { kind: DIRECTIVE.GATHER, action: "/voice/turn?callId=c1", voiceProfile: VOICE_PROFILE.DE_FEMALE_NEURAL },
  ];
  assert.equal(voiceRenderer(PROVIDER.TWILIO).renderDirectives(probe), twilioRenderDirectives(probe));
});

// ---- Default-Byte-Identitaet: arg-los -> Twilio (numberProvisioning -> Telnyx) ----
// C-P1b: JEDE Factory defaultet auf DEFAULT_PROVIDER - es darf keinen zweiten,
// eigenen Anbieter-Default geben. Genau das war nach C-P1 kurzzeitig kaputt: die fuenf
// Parameter-Defaults standen hartkodiert auf Twilio, waehrend DEFAULT_PROVIDER schon
// Telnyx war. Ein Aufrufer, der `call.provider` durchreicht und dort `undefined` hat
// (Call ohne Provider-Feld), bekam damit einen ANDEREN Anbieter als der Rueckfall in
// routes/voice.js - zwei Antworten auf dieselbe Frage.
//
// Bewusst gegen DEFAULT_PROVIDER formuliert und NICHT gegen "telnyx": so bleibt der Test
// gueltig, wenn der Rueckfall je wieder wechselt, und faengt trotzdem jeden neuen
// hartkodierten Default.
test("arg-lose Factories defaulten auf DEFAULT_PROVIDER (kein zweiter Anbieter-Default)", () => {
  config.safety.fakeOriginate = false;
  for (const [name, factory] of FULL_COVERAGE) {
    assert.equal(factory(), factory(DEFAULT_PROVIDER), `${name}: arg-los weicht ab`);
    assert.equal(factory(undefined), factory(DEFAULT_PROVIDER), `${name}: undefined weicht ab`);
  }
  // numberProvisioning hat nur EINE Implementierung (Telnyx) und keinen Provider-Param -
  // Bestand, hier nur mitgefuehrt, damit die Aussage vollstaendig bleibt.
  assert.equal(numberProvisioning(), telnyxNumberProvisioning);
});

// ---- fakeOriginate-Override VOR pick (Sonderfall a) ----
test("fakeOriginate-Override greift vor pick, fuer jeden Provider inkl. unbekannt", async () => {
  config.safety.fakeOriginate = true;
  try {
    const a = voiceControl(PROVIDER.TWILIO);
    assert.equal(a, voiceControl(PROVIDER.TELNYX)); // dieselbe Fake-Instanz
    assert.equal(a, voiceControl("nonsense")); // Override -> KEIN pick-Wurf
    assert.notEqual(a, twilioVoice);
    assert.match((await a.originateCall()).sid, /^fake_/);
  } finally {
    config.safety.fakeOriginate = false;
  }
});

// ---- fail-closed Wurf fuer unbekannten Provider, Fehlermeldung OHNE Secret ----
test("unbekannter Provider -> Wurf mit Provider-Namen, ohne Secret", () => {
  config.safety.fakeOriginate = false;
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

// ---- Vollstaendigkeits-Invariante: jeder bekannte Provider ist in jedem Full-Coverage-
//      Port registriert (faengt einen kuenftig vergessenen dritten Provider VOR Deploy) ----
test("jeder PROVIDER-Wert ist in jedem Full-Coverage-Port registriert", () => {
  config.safety.fakeOriginate = false;
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
