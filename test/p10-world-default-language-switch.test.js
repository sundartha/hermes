// Review-Fix P10 (Runde 1, Blocker "ENTSCHAERFT (1)"): der Weltdefault-Flip
// (DEFAULT_LANGUAGE de->en, src/store/defaults.js) haengt an einem Env-Schalter
// (WORLD_DEFAULT_LANGUAGE_ENABLED, s. src/config.js) - Rueckflip ohne Deploy in Minuten
// (Render-Dashboard-Env-Aenderung). Zwei Achsen:
//   (A) Mechanismus: setWorldDefaultLanguageEnabled() selbst (rein, config-frei,
//       kein Spawn) - state-ops/locales bleiben config-frei importierbar (s. Kommentar
//       in defaults.js), die Funktion wird NUR von config.js beim Boot aufgerufen.
//   (B) Wiring: s. test/p10-world-default-language-onboard.test.js (AUTH-P6: aus DIESER
//       Datei ausgelagert, weil (B) src/config.js transitiv laden MUSS (In-Process-Mount
//       von makeOnboardRoutes braucht withConfigNamespaces) - genau das Laden von
//       config.js loest seinen Boot-Wiring-Seiteneffekt aus (setWorldDefaultLanguageEnabled
//       aus dem PROZESS-Env, hier unbekannt) und wuerde Test (A) unten seine Praemisse
//       ("state-ops/locales bleiben config-frei importierbar") unter den Fuessen wegziehen -
//       (A) muss die EINZIGE Importquelle in diesem Prozess bleiben, die
//       setWorldDefaultLanguageEnabled beruehrt.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LANGUAGE, setWorldDefaultLanguageEnabled } from "../src/store/defaults.js";
import { RENDER_ENV, prodEnv } from "./prod-env.js";

// ---- (A) Mechanismus ----

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
    // Byte-identisch fuer nachfolgende Tests in dieser Datei (F.I.R.S.T./Independence).
    setWorldDefaultLanguageEnabled(true);
  }
});

// Restore nach der ganzen Datei (falls ein Test in diesem File-Worker nach den obigen
// noch importiert wird) - derselbe Prozess darf keinen veraenderten Modul-Zustand an
// nachfolgende Tests im selben Worker durchreichen.
after(() => {
  setWorldDefaultLanguageEnabled(true);
});

// ---- (A2) Aktivierungsfenster (Review-Fix Runde 2, P10-Blocker "Aktivierungsfenster") ----
// PLAN-I18N-FIX.md P10 verlangt, dass der Flip in Produktion bis zur P13-Abnahme AUS
// bleibt. Die Var existiert im Render-Dashboard heute nicht (Beleg im PR-Kontext) - beim
// Deploy gewinnt also der Blueprint-Wert. Waere der auf "true", waere der Flip ab der
// ersten Sekunde scharf (fail-open), unabhaengig vom Code-Default. Dieser Test pinnt den
// Blueprint-Wert direkt gegen genau dieses Risiko.

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
