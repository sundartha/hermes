import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LANGUAGE, setWorldDefaultLanguageEnabled } from "../src/store/defaults.js";
import { RENDER_ENV, prodEnv } from "./prod-env.js";

test("setWorldDefaultLanguageEnabled: Code-Default ist 'en' (byte-identisch zum Bestand)", () => {
  assert.equal(DEFAULT_LANGUAGE, "en");
});

test("setWorldDefaultLanguageEnabled(false) -> 'de', setWorldDefaultLanguageEnabled(true) -> 'en'", () => {
  try {
    setWorldDefaultLanguageEnabled(false);
    assert.equal(DEFAULT_LANGUAGE, "de", "Schalter aus -> Rueckfall auf de (Vor-Flip)");
    setWorldDefaultLanguageEnabled(true);
    assert.equal(DEFAULT_LANGUAGE, "en", "Schalter an -> Weltdefault en");
  } finally {
    setWorldDefaultLanguageEnabled(true);
  }
});

after(() => {
  setWorldDefaultLanguageEnabled(true);
});

test("Aktivierungsfenster: render.yaml haelt WORLD_DEFAULT_LANGUAGE_ENABLED auf 'false', bis P13 abgenommen ist", () => {
  assert.equal(
    RENDER_ENV.WORLD_DEFAULT_LANGUAGE_ENABLED,
    "false",
    "SOLL: der Blueprint darf den Weltdefault-Flip nicht scharf schalten, bevor P13 " +
      "abgenommen ist (sonst fail-open beim Deploy, da die Var im Dashboard nicht existiert)",
  );
});

test("Aktivierungsfenster: prodEnv() ohne Override faehrt den Weltdefault-Flip AUS (Blueprint-Default)", () => {
  assert.equal(
    prodEnv().WORLD_DEFAULT_LANGUAGE_ENABLED,
    "false",
    "SOLL: ohne expliziten Override spiegelt prodEnv() den geschlossenen Aktivierungsfenster-Zustand",
  );
});
