// P10 (Observability + Doku) + Phase telnyx-fix-live-schema-auth (E2): fail-closed
// Boot-Check fuer den C-Telnyx-AI-Assistant. Deckt Verhaltensweisen ab, die config.js
// einfuehrt:
//  (1) assertConfig() verweigert den Boot, wenn TELNYX_AI_ASSISTANT_ENABLED an ist,
//      aber TELNYX_ASSISTANT_ID/TELNYX_API_KEY/TELNYX_CONNECTION_ID/
//      TELNYX_SHIM_SHARED_SECRET fehlen.
//  (2) productionFootguns() sperrt einen absurd hohen TELNYX_SHIM_MAX_TURNS_PER_MIN
//      im Hosting bei aktivem Flag (die per-callId-Fraud-Bremse waere sonst inert).
// Muster: config-payment-guard.test.js (withConfig-Singleton-Mutation, kein Spawn)
// + config-prod-footguns.test.js (productionFootguns als reine Funktion, cfg injiziert).
// Jede node:test-Datei laeuft als eigener Kindprozess -> kein Cross-File-Leak.
import { test } from "node:test";
import assert from "node:assert/strict";
import { config, assertConfig, productionFootguns } from "../src/config.js";

function withConfig(overrides, fn) {
  const saved = {};
  for (const k of Object.keys(overrides)) saved[k] = config[k];
  Object.assign(config, overrides);
  try {
    return fn();
  } finally {
    Object.assign(config, saved);
  }
}

function captureConsoleError(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  try {
    fn();
  } finally {
    console.error = orig;
  }
  return lines;
}

// Alle Nicht-Telnyx-Pflichtfelder erfuellt + die drei Telnyx-Vars gesetzt -> NUR die
// jeweils mutierte Telnyx-Var entscheidet ueber das Urteil (Isolation).
const REQUIRED_OK = {
  anthropicApiKey: "x",
  twilioSid: "x",
  twilioToken: "x",
  publicUrl: "https://example.test",
  mcpAuth: "",
  storeBackend: "json",
  paymentEnabled: false,
  webDistDir: "",
  telnyxAiAssistantEnabled: true,
  telnyxAssistantId: "assistant-1",
  telnyxApiKey: "key-1",
  telnyxConnectionId: "conn-1",
  telnyxCallControlAppId: "ccapp-1",
  telnyxShimMaxTurnsPerMin: 30,
  telnyxShimSharedSecret: "shim-secret",
};

test("assertConfig: Flag an + TELNYX_ASSISTANT_ID leer -> fail-closed (false)", () => {
  withConfig({ ...REQUIRED_OK, telnyxAssistantId: "" }, () => {
    assert.equal(assertConfig(), false);
  });
});

test("assertConfig: Flag an + TELNYX_API_KEY leer -> fail-closed (false)", () => {
  withConfig({ ...REQUIRED_OK, telnyxApiKey: "" }, () => {
    assert.equal(assertConfig(), false);
  });
});

test("assertConfig: Flag an + TELNYX_CONNECTION_ID leer -> fail-closed (false)", () => {
  withConfig({ ...REQUIRED_OK, telnyxConnectionId: "" }, () => {
    assert.equal(assertConfig(), false);
  });
});

// Ohne Call-Control-App-ID kann originateViaCallControl nur den 422/10015 produzieren
// (Live-Bug 2026-07-10) - der Boot muss vorher fail-closed verweigern statt still zu starten.
test("assertConfig: Flag an + TELNYX_CALL_CONTROL_APP_ID leer -> fail-closed (false)", () => {
  withConfig({ ...REQUIRED_OK, telnyxCallControlAppId: "" }, () => {
    assert.equal(assertConfig(), false);
  });
});

test("assertConfig im Hosting: Flag an + TELNYX_CALL_CONTROL_APP_ID leer -> Boot-Refusal nennt die Var", () => {
  withConfig({ ...REQUIRED_OK, telnyxCallControlAppId: "" }, () => {
    const lines = captureConsoleError(() => {
      assert.equal(assertConfig(), false);
    });
    assert.match(lines.join("\n"), /TELNYX_CALL_CONTROL_APP_ID/);
  });
});

test("assertConfig: Flag an + TELNYX_SHIM_SHARED_SECRET leer -> fail-closed (false)", () => {
  withConfig({ ...REQUIRED_OK, telnyxShimSharedSecret: "" }, () => {
    assert.equal(assertConfig(), false);
  });
});

test("assertConfig im Hosting: Flag an + TELNYX_SHIM_SHARED_SECRET leer -> Boot-Refusal + nennt die Var", () => {
  withConfig({ ...REQUIRED_OK, telnyxShimSharedSecret: "" }, () => {
    const lines = captureConsoleError(() => {
      assert.equal(assertConfig(), false);
    });
    const out = lines.join("\n");
    assert.match(out, /Boot wird verweigert/);
    assert.match(out, /TELNYX_SHIM_SHARED_SECRET/);
  });
});

test("assertConfig: Flag an + alle fuenf gesetzt -> Boot ok (true, Gegenprobe)", () => {
  withConfig(REQUIRED_OK, () => {
    assert.equal(assertConfig(), true);
  });
});

test("assertConfig: Flag aus (alle fuenf leer) -> Boot ok (true, byte-identische Invariante)", () => {
  withConfig(
    {
      ...REQUIRED_OK,
      telnyxAiAssistantEnabled: false,
      telnyxAssistantId: "",
      telnyxApiKey: "",
      telnyxConnectionId: "",
      telnyxCallControlAppId: "",
      telnyxShimSharedSecret: "",
    },
    () => {
      assert.equal(assertConfig(), true);
    },
  );
});

test("assertConfig im Hosting: Flag an + fehlende ID -> Boot-Refusal + nennt die Var", () => {
  withConfig({ ...REQUIRED_OK, telnyxAssistantId: "" }, () => {
    const lines = captureConsoleError(() => {
      assert.equal(assertConfig(), false);
    });
    const out = lines.join("\n");
    assert.match(out, /Boot wird verweigert/);
    assert.match(out, /TELNYX_ASSISTANT_ID/);
  });
});

// Produktions-sichere Basis (Muster SAFE_PROD aus config-prod-footguns.test.js): alle
// vier Bestands-Footguns entschaerft. Tests variieren NUR die Telnyx-Felder.
const SAFE_PROD = {
  dashboardPassword: "geheim",
  mcpAuth: "",
  skipTwilioSignatureCheck: false,
  oauthIssuerUrl: "",
  storeBackend: "pg",
};

test("productionFootguns: Flag an + absurd hoher Turn-Deckel -> fatal (nennt Var)", () => {
  const errors = productionFootguns(
    { ...SAFE_PROD, telnyxAiAssistantEnabled: true, telnyxShimMaxTurnsPerMin: 10000 },
    true,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /TELNYX_SHIM_MAX_TURNS_PER_MIN/);
});

test("productionFootguns: Flag an + Default-Turn-Deckel (30) -> kein Footgun", () => {
  const errors = productionFootguns(
    { ...SAFE_PROD, telnyxAiAssistantEnabled: true, telnyxShimMaxTurnsPerMin: 30 },
    true,
  );
  assert.deepEqual(errors, []);
});

test("productionFootguns: Flag aus + absurd hoher Turn-Deckel -> inert (kein Footgun)", () => {
  const errors = productionFootguns(
    { ...SAFE_PROD, telnyxAiAssistantEnabled: false, telnyxShimMaxTurnsPerMin: 10000 },
    true,
  );
  assert.deepEqual(errors, [], "Bremse ohne aktiven Assistant ist nicht sicherheitsrelevant");
});
