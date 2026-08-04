// Struct-3 (C6a, PLAN-FRAGILITY-REMEDIATION.md P5): Proxy-Guard-Mechanismus + erste
// Feature-Gruppierung (telnyxAssistant). Reiner Unit-Test, offline, kein Server-Spawn,
// keine .env (Muster config-prod-footguns.test.js).
// PA-11: zusaetzlich Fresh-Import-Regression fuer die Trailing-Slash-Configs, Env je
// Fall gesetzt+restauriert (Muster Query-String-Cache-Buster wie config-boolenv.test.js).
// PA-20 (Flip): alle Zugriffe auf config.<ns>.<key> umgestellt (Flach-Aliase entfernt).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config, stripTrailingSlash } from "../src/config.js";

// Teil 1: Proxy-Guard-Mechanismus (unabhaengig von der telnyxAssistant-Migration -
// nutzt bereits bestehende Gruppen/Keys, damit dieser Block auch VOR jeder Migration
// beweiskraeftig ist).
test("Proxy-Guard: unbekannter Top-Level-Key wirft TypeError statt undefined", () => {
  assert.throws(() => config.doesNotExistTopLevel, TypeError);
});

test("Proxy-Guard: unbekannter verschachtelter Key wirft TypeError", () => {
  assert.throws(() => config.telnyx.telnyxElevenLabs.doesNotExistNested, TypeError);
});

test("Proxy-Guard: legitimer Zugriff liefert weiterhin den echten Default-Wert", () => {
  assert.equal(typeof config.telnyx.telnyxElevenLabs.model, "string");
  assert.equal(config.telnyx.telnyxElevenLabs.model, "Default");
});

test("Proxy-Guard: Arrays bleiben unverpackte echte Arrays (keine Namens-Zugriffe)", () => {
  assert.ok(Array.isArray(config.safety.allowedCountryCodes));
  assert.ok(config.safety.allowedCountryCodes.includes("+49"));
});

// OUT-23: Laendercode-Praefixe sind reine E.164-Ziffernstrings - es gibt keinen Buchstaben,
// der eine Gross-/Kleinschreibung tragen koennte, deshalb braucht die Praefix-Achse (anders
// als die ISO-Land-Achse in languageForCountry, die per .toUpperCase() normalisiert - gepinnt
// von LANG-09 in test/f1-geo-port.test.js, hier bewusst NICHT wiederholt, G5) keine
// Casing-Normalisierung. Der Test schuetzt genau den Fehlgriff, den es dadurch gaebe: ein
// ISO-Code ("US") in einer Praefix-Liste wuerde lautlos NIE matchen.
// R-G-Abweichung: die Katalog-Schritte messen languageForCountry-Casing - das ist LANG-09s
// Gegenstand (W2-B1) und waere hier ein Duplikat.
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

// Review-Blocker S1-1: JSON.stringify prueft intern value.toJSON, await/Promise pruefen
// value.then - beides normale property-Reads, die der Guard sonst als unbekannten Key
// missversteht und einen TypeError wirft statt zu serialisieren/aufzuloesen.
test("Proxy-Guard: JSON.stringify auf eine Config-Gruppe wirft nicht (toJSON-Duck-Typing)", () => {
  assert.doesNotThrow(() => JSON.stringify(config.telnyx.telnyxAssistant));
  assert.deepEqual(JSON.parse(JSON.stringify(config.telnyx.telnyxAssistant)), {
    enabled: false,
    assistantId: "",
    callControlAppId: "",
    shimMaxTurnsPerMin: 30,
    deadAirTimeoutS: 45,
    openingSpeakTimeoutS: 45,
    loopGuardMaxEmptyTurns: 8,
    shimSharedSecret: "",
    shimApiKeyRef: "",
    shimDebugShape: false,
    shimTokenStreaming: false,
    // GQ-P1: neuer Schalter, DEFAULT AN (anders als die uebrigen Shim-Flags - der Riegel
    // ist der korrigierte Bestand, nicht ein Opt-in).
    shimSupersedeExtendedTurn: true,
    // GQ-P3: der Rueckweg fuer den Inbound-Handoff, DEFAULT AN (Muster
    // shimSupersedeExtendedTurn - Rueckweg der Phase, nicht ihr Ausloeser).
    inboundHandoffEnabled: true,
  });
});

test("Proxy-Guard: JSON.stringify auf die Top-Level-Config wirft nicht (toJSON-Duck-Typing)", () => {
  assert.doesNotThrow(() => JSON.stringify(config));
});

test("Proxy-Guard: await/Promise.resolve auf eine Config-Gruppe wirft nicht (then-Duck-Typing)", async () => {
  const awaited = await config.telnyx.telnyxAssistant;
  assert.equal(awaited.shimMaxTurnsPerMin, 30); // Objekt kommt unveraendert/lesbar durch
  const resolved = await Promise.resolve(config.telnyx.telnyxAssistant);
  assert.equal(resolved.shimMaxTurnsPerMin, 30);
});

test("Proxy-Guard: then/toJSON bleiben fuer echte unbekannte Keys weiterhin bewacht", () => {
  assert.throws(() => config.telnyx.telnyxAssistant.doesNotExistNested, TypeError);
});

// Teil 2: telnyxAssistant-Gruppierung (P5, erstes Feature-Grouping).
test("telnyxAssistant: alle 13 Keys existieren mit den dokumentierten Defaults (NODE_ENV=test, keine Env gesetzt)", () => {
  assert.equal(config.telnyx.telnyxAssistant.enabled, false);
  assert.equal(config.telnyx.telnyxAssistant.assistantId, "");
  assert.equal(config.telnyx.telnyxAssistant.callControlAppId, "");
  assert.equal(config.telnyx.telnyxAssistant.shimMaxTurnsPerMin, 30);
  assert.equal(config.telnyx.telnyxAssistant.deadAirTimeoutS, 45);
  assert.equal(config.telnyx.telnyxAssistant.openingSpeakTimeoutS, 45);
  assert.equal(config.telnyx.telnyxAssistant.loopGuardMaxEmptyTurns, 8);
  assert.equal(config.telnyx.telnyxAssistant.shimSharedSecret, "");
  assert.equal(config.telnyx.telnyxAssistant.shimApiKeyRef, "");
  assert.equal(config.telnyx.telnyxAssistant.shimDebugShape, false);
  assert.equal(config.telnyx.telnyxAssistant.shimTokenStreaming, false);
  assert.equal(config.telnyx.telnyxAssistant.shimSupersedeExtendedTurn, true);
  assert.equal(config.telnyx.telnyxAssistant.inboundHandoffEnabled, true);
});

// Regression: der alte flache Pfad existiert NACHWEISLICH nicht mehr - waere er
// (versehentlich re-addiert) doch da, faellt dieser Test durch statt den Sinn der
// Migration stillschweigend zu unterlaufen.
test("telnyxAssistant: die 10 alten flachen Config-Pfade existieren nicht mehr", () => {
  const oldFlatKeys = [
    "telnyxAiAssistantEnabled",
    "telnyxAssistantId",
    "telnyxCallControlAppId",
    "telnyxShimMaxTurnsPerMin",
    "telnyxDeadAirTimeoutS",
    "telnyxOpeningSpeakTimeoutS",
    "telnyxLoopGuardMaxEmptyTurns",
    "telnyxShimSharedSecret",
    "telnyxShimApiKeyRef",
    "telnyxShimDebugShape",
  ];
  for (const key of oldFlatKeys) {
    assert.throws(() => config[key], TypeError, `config.${key} sollte nicht mehr existieren`);
  }
});

// PA-20 (Flip): die Flach-Aliase (auch die 3 nested Blaetter selbst) sind entfernt - die
// Namespaces sind die EINZIGE Oberflaeche. Analoge Regression wie oben, diesmal fuer die
// obersten Flach-Keys statt der telnyxAssistant-internen Sub-Keys.
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

// P6: MS_PER_DAY-Dedup-Regressionsanker (perTargetWindowMs-Fallback nutzt jetzt die
// benannte Konstante statt des rohen 24h-ms-Literals, Wert bleibt identisch).
test("MS_PER_DAY: perTargetWindowMs faellt bei unset auf genau 24h (86400000 ms)", () => {
  assert.equal(config.safety.perTargetWindowMs, 86400000);
});

// PA-11 (G5-Dedup): stripTrailingSlash buendelt das 7x wiederholte
// ".replace(/\/$/, \"\")"-Idiom. Teil 1: reiner Unit-Test des Helfers.
test("PA-11: stripTrailingSlash entfernt genau EINEN abschliessenden Slash", () => {
  assert.equal(stripTrailingSlash("https://x.test/"), "https://x.test");
  assert.equal(stripTrailingSlash("https://x.test"), "https://x.test"); // ohne Slash unveraendert
  assert.equal(stripTrailingSlash(""), ""); // leer bleibt leer
  assert.equal(stripTrailingSlash("https://x.test//"), "https://x.test/"); // NICHT global: nur der letzte
  assert.equal(stripTrailingSlash("https://x.test/p/y"), "https://x.test/p/y"); // interne Slashes bleiben
});

// Teil 2: tabellarische Regression der 6 eager im rawConfig-Literal ausgewerteten
// URL-Configs (Site 7, resolveGatewayUrl, ist call-time und bereits durch den
// bestehenden Test in config-gateway.test.js abgedeckt). Jede Env wird mit
// Trailing-Slash gesetzt und gegen den bekannten git-HEAD-Wert (ohne Slash) geprueft.
// Fresh-Import mit Query-String-Cache-Buster, da rawConfig beim Modul-Import
// ausgewertet wird (Muster config-boolenv.test.js).
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

// Teil 3: ELEVENLABS_API_BASE ist der einzige der 7 Standorte, bei dem .trim() VOR
// dem Strip laufen muss (Reihenfolge load-bearing). Whitespace NACH dem Slash beweist
// das: strip-vor-trim wuerde "...io/ ".replace(/\/$/,"") === "...io/ " liefern (der
// Slash steht nicht am Stringende) und danach nur trimmen zu "...io/" - der Slash
// bliebe. trim-vor-strip liefert "...io/" -> strip -> "...io".
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
