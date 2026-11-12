import { test } from "node:test";
import assert from "node:assert/strict";
import { config, stripTrailingSlash } from "../src/config.js";

test("Proxy-Guard: unbekannter Top-Level-Key wirft TypeError statt undefined", () => {
  assert.throws(() => config.doesNotExistTopLevel, TypeError);
});

test("Proxy-Guard: unbekannter verschachtelter Key wirft TypeError", () => {
  assert.throws(() => config.telnyx.telnyxElevenLabs.doesNotExistNested, TypeError);
});

test("Proxy-Guard: legitimer Zugriff liefert weiterhin den echten Default-Wert", () => {
  assert.equal(typeof config.voice.elevenLabsPlayTts.outputFormat, "string");
  assert.equal(config.voice.elevenLabsPlayTts.outputFormat, "mp3_44100_128");
});

test("Proxy-Guard: Arrays bleiben unverpackte echte Arrays (keine Namens-Zugriffe)", () => {
  assert.ok(Array.isArray(config.safety.allowedCountryCodes));
  assert.ok(config.safety.allowedCountryCodes.includes("+49"));
});

test("OUT-23 (Mechanismus, gruen) - Laendercode-Praefixe sind casing-frei per Konstruktion (E.164 kennt kein Casing)", () => {
  const E164_PREFIX_OR_WILDCARD = /^(\*|\+\d+)$/;
  for (const code of config.safety.allowedCountryCodes) {
    assert.match(code, E164_PREFIX_OR_WILDCARD, `ALLOWED_COUNTRY_CODES-Eintrag '${code}' ist kein E.164-Praefix`);
  }
  for (const prefix of config.billing.voiceTariffDomesticPrefixes) {
    assert.match(prefix, /^\+\d+$/, `Inlands-Vorwahl '${prefix}' ist kein E.164-Praefix`);
  }
});

test("Proxy-Guard: Symbol-Zugriffe werden NICHT bewacht (kein Crash bei util.inspect)", () => {
  assert.equal(config[Symbol.for("nichts")], undefined);
});

test("Proxy-Guard: JSON.stringify auf eine Config-Gruppe wirft nicht (toJSON-Duck-Typing)", () => {
  assert.doesNotThrow(() => JSON.stringify(config.telnyx.telnyxElevenLabs));
  assert.deepEqual(JSON.parse(JSON.stringify(config.telnyx.telnyxElevenLabs)), { voiceId: "" });
});

test("Proxy-Guard: JSON.stringify auf die Top-Level-Config wirft nicht (toJSON-Duck-Typing)", () => {
  assert.doesNotThrow(() => JSON.stringify(config));
});

test("Proxy-Guard: await/Promise.resolve auf eine Config-Gruppe wirft nicht (then-Duck-Typing)", async () => {
  const awaited = await config.telnyx.telnyxElevenLabs;
  assert.equal(awaited.voiceId, "");
  const resolved = await Promise.resolve(config.telnyx.telnyxElevenLabs);
  assert.equal(resolved.voiceId, "");
});

test("Proxy-Guard: then/toJSON bleiben fuer echte unbekannte Keys weiterhin bewacht", () => {
  assert.throws(() => config.telnyx.telnyxElevenLabs.doesNotExistNested, TypeError);
});

test("telnyx-Namespace: telnyxAssistant existiert nicht mehr", () => {
  assert.throws(() => config.telnyx.telnyxAssistant, TypeError);
});

test("Flip: die Flach-Aliase existieren nicht mehr (Read wirft TypeError)", () => {
  const removedFlatKeys = [
    "platformSpendCapCents",
    "allowedCountryCodes",
    "telnyxAssistant",
    "telnyxElevenLabs",
    "elevenLabsPlayTts",
  ];
  for (const key of removedFlatKeys) {
    assert.throws(() => config[key], TypeError, `config.${key} sollte nicht mehr existieren`);
  }
});

test("MS_PER_DAY: perTargetWindowMs faellt bei unset auf genau 24h (86400000 ms)", () => {
  assert.equal(config.safety.perTargetWindowMs, 86400000);
});

test("PA-11: stripTrailingSlash entfernt genau EINEN abschliessenden Slash", () => {
  assert.equal(stripTrailingSlash("https://x.test/"), "https://x.test");
  assert.equal(stripTrailingSlash("https://x.test"), "https://x.test");
  assert.equal(stripTrailingSlash(""), "");
  assert.equal(stripTrailingSlash("https://x.test//"), "https://x.test/");
  assert.equal(stripTrailingSlash("https://x.test/p/y"), "https://x.test/p/y");
});

test("PA-11: die 6 eager URL-Configs strippen den Trailing-Slash exakt (git-HEAD-Wert)", async () => {
  const cases = [
    { env: "TELNYX_API_BASE", raw: "https://api.telnyx.com/", pick: (c) => c.telephony.telnyxApiBase, want: "https://api.telnyx.com" },
    { env: "STRIPE_API_BASE", raw: "https://api.stripe.com/", pick: (c) => c.billing.stripeApiBase, want: "https://api.stripe.com" },
    { env: "PUBLIC_URL", raw: "https://hermes.example.test/", pick: (c) => c.server.publicUrl, want: "https://hermes.example.test" },
    { env: "OAUTH_ISSUER_URL", raw: "https://idp.example.test/", pick: (c) => c.auth.oauthIssuerUrl, want: "https://idp.example.test" },
    { env: "WORKOS_API_BASE", raw: "https://api.workos.com/", pick: (c) => c.auth.workosApiBase, want: "https://api.workos.com" },
    { env: "ELEVENLABS_API_BASE", raw: "https://api.elevenlabs.io/", pick: (c) => c.voice.elevenLabsPlayTts.apiBase, want: "https://api.elevenlabs.io" },
  ];
  for (const [i, { env, raw, pick, want }] of cases.entries()) {
    const saved = process.env[env];
    try {
      process.env[env] = raw;
      const fresh = await import(`../src/config.js?pa11-${i}`);
      assert.equal(pick(fresh.config), want, `${env}: Trailing-Slash muss gestrippt sein`);
    } finally {
      if (saved === undefined) delete process.env[env];
      else process.env[env] = saved;
    }
  }
});

test("PA-11: ELEVENLABS_API_BASE trimmt VOR dem Strip (Whitespace nach dem Slash)", async () => {
  const saved = process.env.ELEVENLABS_API_BASE;
  try {
    process.env.ELEVENLABS_API_BASE = "https://api.elevenlabs.io/ ";
    const fresh = await import("../src/config.js?pa11-elevenws");
    assert.equal(fresh.config.voice.elevenLabsPlayTts.apiBase, "https://api.elevenlabs.io");
  } finally {
    if (saved === undefined) delete process.env.ELEVENLABS_API_BASE;
    else process.env.ELEVENLABS_API_BASE = saved;
  }
});
