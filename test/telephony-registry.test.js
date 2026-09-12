// P5: ADAPTERS-Tabelle + pick(port, provider) im Registry-Kern. Beweist: pick() liefert
// die exakte, importierte Adapter-Bindung (Identitaet, keine Kopie), defaultet arg-los
// auf DEFAULT_PROVIDER, wirft fail-closed bei einem unbekannten Provider (Fehlertext OHNE
// Secret), und der fakeOriginate-Override (Sonderfall a) greift weiterhin VOR pick(). Die
// Vollstaendigkeits-Invariante faengt einen kuenftig vergessenen zweiten Provider VOR
// Deploy. Zusaetzlich: die realen call.provider-Eintrittspfade (Header, createCall-Default,
// Number-Seed) liefern fail-closed nur Enum-Werte VOR der Registry (Safety-Auflage
// PLAN-CLEAN-CODE.md P5). Offline (F.I.R.S.T.).
//
// C-P4: die Vollstaendigkeits-Invariante weiter unten ist BEWUSST unveraendert geblieben.
// Sie ist der Grund, warum PROVIDER.TWILIO und die ADAPTERS-Eintraege GEMEINSAM fallen
// mussten: haette man den Enum-Wert stehen lassen, waere sie zu Recht rot geworden. Sie
// abzuschwaechen, um die Suite gruen zu bekommen, waere der Fehler gewesen, den sie
// verhindern soll.
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
import { telnyxVoice } from "../src/telephony/adapters/telnyx/voice.js";
import { telnyxMedia } from "../src/telephony/adapters/telnyx/media.js";
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
  ["mediaTransport", mediaTransport],
  ["webhookEvents", webhookEvents],
  ["voiceRenderer", voiceRenderer],
];

// ---- Selektion: exakte Adapter-Identitaet je Port/Provider ----
test("pick liefert die exakte Adapter-Instanz je Provider", () => {
  config.safety.fakeOriginate = false;
  assert.equal(voiceControl(PROVIDER.TELNYX), telnyxVoice);
  assert.equal(mediaTransport(PROVIDER.TELNYX), telnyxMedia);
  assert.equal(numberProvisioning(PROVIDER.TELNYX), telnyxNumberProvisioning);
  // STT-A1: der Renderer ist hinter einem Lazy-Arrow registriert (config-Bindung an der
  // Kompositionsstelle, P15) - Referenz-Identitaet ist kein Kriterium mehr. Geprueft wird
  // die AUSGABE gegen den Adapter mit GENAU den Plattform-Werten, die die Registry
  // injiziert - seit IP3 ist das nur noch das STT-Profil; die ElevenLabs-Plattform-Stimme
  // wird nicht mehr injiziert (Relay-Zweig entfernt, s. render.js-Modulkopf).
  const probe = [
    { kind: DIRECTIVE.GATHER, action: "/voice/turn?callId=c1", voiceProfile: VOICE_PROFILE.DE_FEMALE_NEURAL },
  ];
  assert.equal(
    voiceRenderer(PROVIDER.TELNYX).renderDirectives(probe),
    telnyxRenderDirectives(probe, { sttProfile: config.voice.sttProfile }),
  );
});

// ---- Default-Byte-Identitaet: arg-los -> DEFAULT_PROVIDER ----
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
    const a = voiceControl(PROVIDER.TELNYX);
    assert.equal(a, voiceControl()); // dieselbe Fake-Instanz, auch arg-los
    assert.equal(a, voiceControl("nonsense")); // Override -> KEIN pick-Wurf
    assert.notEqual(a, telnyxVoice);
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
  // numberProvisioning steht NICHT in FULL_COVERAGE (eigener Default, Geld-Pfad) und
  // braucht deshalb seine eigene fail-closed-Gegenprobe. 'twilio' ist seit C-P4 kein
  // Enum-Wert mehr, kann aber als Altzeile in einer Bestands-DB stehen - genau dieser
  // Weg darf keinen Nummernkauf ausloesen.
  assert.throws(() => numberProvisioning("twilio"), /nicht unterstuetzt/);
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
