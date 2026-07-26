// Review-Fix P10 (Runde 1, Blocker "ENTSCHAERFT (1)"): der Weltdefault-Flip
// (DEFAULT_LANGUAGE de->en, src/store/defaults.js) haengt an einem Env-Schalter
// (WORLD_DEFAULT_LANGUAGE_ENABLED, s. src/config.js) - Rueckflip ohne Deploy in Minuten
// (Render-Dashboard-Env-Aenderung). Zwei Achsen:
//   (A) Mechanismus: setWorldDefaultLanguageEnabled() selbst (rein, config-frei,
//       kein Spawn) - state-ops/locales bleiben config-frei importierbar (s. Kommentar
//       in defaults.js), die Funktion wird NUR von config.js beim Boot aufgerufen.
//   (B) Wiring: ein echter Server-Kindprozess mit gesetztem Env beweist, dass config.js
//       den Schalter tatsaechlich liest und in defaults.js drueckt - end-to-end ueber
//       den Onboard-Pfad (unbekanntes Land -> DEFAULT_LANGUAGE, wie WORLD-01).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { DEFAULT_LANGUAGE, setWorldDefaultLanguageEnabled } from "../src/store/defaults.js";
import { RENDER_ENV, prodEnv } from "./prod-env.js";

const postJson = (url, body) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

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

// ---- (B) Wiring ueber config.js (echter Server-Kindprozess) ----

// Analog zu f1-geo-onboard.test.js (GB->en), aber mit einem Land OHNE eigenes Bundle
// (ES) - das ist genau der Weltdefault-Pfad (WORLD-01), den der Schalter steuert.
test("WORLD_DEFAULT_LANGUAGE_ENABLED=true (Default): Onboard mit country=ES -> language=en", async () => {
  const srv = await startServer({ env: { WORLD_DEFAULT_LANGUAGE_ENABLED: "true" } });
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, { tenantId: "t_es_on", country: "ES" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.language, "en");
  } finally {
    await srv.stop();
  }
});

test("WORLD_DEFAULT_LANGUAGE_ENABLED=false: Onboard mit country=ES -> language=de (Rueckflip ohne Deploy)", async () => {
  const srv = await startServer({ env: { WORLD_DEFAULT_LANGUAGE_ENABLED: "false" } });
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, { tenantId: "t_es_off", country: "ES" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.language, "de", "Schalter aus -> Vor-Flip-Verhalten, kein Deploy noetig");
  } finally {
    await srv.stop();
  }
});
