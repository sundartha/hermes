// W5-Tests: die reinen Settings-Helfer (lib/api.js) -- die Contract-Grenze zur
// Backend-Whitelist (welche Felder POST /api/self-service/settings annimmt) und
// das Ableiten von changed/rejected. Reine Logik, kein DOM: ein gestubbtes fetch
// prueft die Request-Form (POST, JSON-Body, same-origin, KEIN Authorization-
// Header). Laeuft mit node:test ohne Netz/Dependencies.
//
// WHITELIST-BELEG: SETTINGS_FREE_FIELDS + SETTINGS_RESTRICT_ONLY_FIELDS +
// "greeting" sind EXAKT die Felder, die src/self-service.js (selfServicePatch)
// erlaubt. buildSettingsPatch baut NUR diese Felder; ein Freitext-greeting gibt es
// nicht (greeting ist eine Template-Auswahl, kein Free-Field) -- hier getestet.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ApiError,
  SETTINGS_FREE_FIELDS,
  SETTINGS_RESTRICT_ONLY_FIELDS,
  SETTINGS_PERMISSION_TOGGLES,
  SETTINGS_LANGUAGES,
  buildSettingsPatch,
  settingsOutcome,
  settingsFrom,
  saveSettings,
} from "../src/lib/api.js";

// Backend-Quelle der Wahrheit fuer Sprachcodes: SUPPORTED_LANGUAGES = Keys von
// LOCALES (src/i18n/locales.js). Wir importieren die echte Konstante, damit der
// Drift-Test bei einer neuen Backend-Sprache rot wird (G22, kein stiller Drift).
import { SUPPORTED_LANGUAGES } from "../../../src/i18n/locales.js";

function stubFetch(responder) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options });
    return responder(path, options);
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

function fakeResponse({ ok, status, json }) {
  return { ok, status, json: async () => json };
}

// ---- Whitelist-Beleg: die UI bietet GENAU die Backend-Felder an ---------------
// Diese Mengen spiegeln src/self-service.js. Driftet die UI, faengt der Server es
// (rejected), aber die UI soll erst gar nichts ausserhalb anbieten.
test("Whitelist-Mengen entsprechen dem Backend-Vertrag (self-service.js)", () => {
  assert.deepEqual(SETTINGS_FREE_FIELDS, ["agentName", "allowCalendar", "allowBooking", "language"]);
  assert.deepEqual(SETTINGS_RESTRICT_ONLY_FIELDS, ["allowPersonalData", "allowBankData"]);
  // Die vier Toggles = die beiden Bool-Free-Felder + die beiden Restrict-Only-Felder.
  const toggleKeys = SETTINGS_PERMISSION_TOGGLES.map((t) => t.key);
  assert.deepEqual(toggleKeys, ["allowCalendar", "allowBooking", "allowPersonalData", "allowBankData"]);
  // restrictOnly-Flag korrekt gesetzt (Anzeige-Semantik = Server-Semantik).
  for (const t of SETTINGS_PERMISSION_TOGGLES) {
    assert.equal(t.restrictOnly, SETTINGS_RESTRICT_ONLY_FIELDS.includes(t.key));
  }
});

test("SETTINGS_LANGUAGES deckt GENAU die Backend-Sprachen ab (+ '' = automatisch)", () => {
  // "" ist die UI-Option "Automatisch" (Override leeren); die uebrigen Codes
  // muessen exakt SUPPORTED_LANGUAGES (= Object.keys(LOCALES)) entsprechen --
  // sonst fehlt/zuviel eine Sprache im Dropdown (G22, Anzeige-Drift).
  const codes = SETTINGS_LANGUAGES.map((l) => l.value).filter((v) => v !== "");
  assert.deepEqual([...codes].sort(), [...SUPPORTED_LANGUAGES].sort());
  // Genau eine Automatik-Option, und sie steht zuerst.
  assert.equal(SETTINGS_LANGUAGES[0].value, "");
  assert.equal(SETTINGS_LANGUAGES.filter((l) => l.value === "").length, 1);
  // Jede Option hat ein nicht-leeres Label.
  for (const l of SETTINGS_LANGUAGES) assert.ok(l.label.length > 0);
});

// ---- buildSettingsPatch: NUR Whitelist-Felder, kein Freitext-greeting ---------
test("buildSettingsPatch baut ausschliesslich die Whitelist-Felder", () => {
  const patch = buildSettingsPatch({
    agentName: "Hermes",
    greeting: "Hallo {owner}",
    language: "de",
    allowCalendar: true,
    allowBooking: false,
    allowPersonalData: false,
    allowBankData: false,
  });
  assert.deepEqual(Object.keys(patch).sort(), [
    "agentName",
    "allowBankData",
    "allowBooking",
    "allowCalendar",
    "allowPersonalData",
    "greeting",
    "language",
  ]);
});

test("buildSettingsPatch verwirft unbekannte Felder (kein Schreibpfad ausserhalb der Whitelist)", () => {
  const patch = buildSettingsPatch({
    agentName: "X",
    allowSummaries: true, // existiert, ist aber NICHT self-service-erlaubt
    disclosureLine: "boese", // Disclosure ist fest verdrahtet -> nie ueber die UI
    randomKey: 1,
  });
  assert.equal("allowSummaries" in patch, false);
  assert.equal("disclosureLine" in patch, false);
  assert.equal("randomKey" in patch, false);
});

test("buildSettingsPatch: greeting ist nur ein String-Wert (Template-Auswahl), kein Freitext-Feld", () => {
  // greeting kommt als gewaehlter Template-String -- die Insel hat KEIN Freitext-
  // Eingabefeld. Der Wert wird unveraendert als String uebernommen; ob er eine
  // erlaubte Vorlage ist, entscheidet der Server (selfServicePatch).
  const patch = buildSettingsPatch({ greeting: "Guten Tag, {owner}" });
  assert.equal(patch.greeting, "Guten Tag, {owner}");
  assert.equal(typeof patch.greeting, "string");
});

test("buildSettingsPatch: fehlende Felder -> leere Strings / false (nie undefined)", () => {
  const patch = buildSettingsPatch({});
  assert.equal(patch.agentName, "");
  assert.equal(patch.greeting, "");
  assert.equal(patch.language, "");
  assert.equal(patch.allowCalendar, false);
  assert.equal(patch.allowBankData, false);
  assert.deepEqual(buildSettingsPatch(undefined).agentName, "");
});

test("buildSettingsPatch: Toggle-Werte werden zu Boolean normalisiert", () => {
  const patch = buildSettingsPatch({ allowCalendar: 1, allowBooking: "", allowPersonalData: undefined });
  assert.equal(patch.allowCalendar, true);
  assert.equal(patch.allowBooking, false);
  assert.equal(patch.allowPersonalData, false);
});

// ---- settingsOutcome: changed/rejected aus dem gespeicherten settings-Objekt ---
test("settingsOutcome: uebernommene Felder -> changed, abweichende -> rejected", () => {
  const patch = { agentName: "Neu", language: "fr", allowCalendar: true };
  const saved = { agentName: "Neu", language: "fr", allowCalendar: true };
  const out = settingsOutcome(patch, saved);
  assert.deepEqual(out.changed.sort(), ["agentName", "allowCalendar", "language"]);
  assert.deepEqual(out.rejected, []);
});

test("settingsOutcome: restrict-only false->true wird als rejected erkannt (Server haelt alten Wert)", () => {
  // Der Tenant versucht, allowPersonalData von false auf true zu heben. Der Server
  // (selfServicePatch) lehnt das ab -> der gespeicherte Wert bleibt false. Hier
  // muss das als rejected erscheinen, nicht als changed.
  const patch = { allowPersonalData: true, agentName: "Ok" };
  const saved = { allowPersonalData: false, agentName: "Ok" };
  const out = settingsOutcome(patch, saved);
  assert.deepEqual(out.changed, ["agentName"]);
  assert.deepEqual(out.rejected, ["allowPersonalData"]);
});

test("settingsOutcome: leerer Patch -> leere Listen", () => {
  assert.deepEqual(settingsOutcome({}, {}), { changed: [], rejected: [] });
  assert.deepEqual(settingsOutcome(undefined, undefined), { changed: [], rejected: [] });
});

// ---- settingsFrom: Contract-Grenze zur state-Antwort --------------------------
test("settingsFrom: leere Defaults bei fehlendem data/settings/templates", () => {
  assert.deepEqual(settingsFrom(undefined), { settings: {}, greetingTemplates: [] });
  assert.deepEqual(settingsFrom({}), { settings: {}, greetingTemplates: [] });
  assert.deepEqual(settingsFrom({ greetingTemplates: "x" }), { settings: {}, greetingTemplates: [] });
});

test("settingsFrom: befuellte Felder unveraendert durch", () => {
  const data = { settings: { agentName: "A" }, greetingTemplates: ["t1", "t2"] };
  assert.deepEqual(settingsFrom(data), { settings: { agentName: "A" }, greetingTemplates: ["t1", "t2"] });
});

// ---- saveSettings: Request-Form (POST, JSON-Body, same-origin, kein Token) -----
test("saveSettings postet den Patch als JSON same-origin ohne Authorization-Header", async () => {
  const saved = { agentName: "Hermes", language: "de" };
  const f = stubFetch(() => fakeResponse({ ok: true, status: 200, json: saved }));
  try {
    const patch = { agentName: "Hermes", language: "de" };
    const result = await saveSettings(patch);
    assert.deepEqual(result, saved);
    const { path, options } = f.calls[0];
    assert.equal(path, "/api/self-service/settings");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), patch);
    // Fail-closed gegen Token-Leak: niemals ein Authorization-Header.
    assert.equal(options.headers.Authorization, undefined);
  } finally {
    f.restore();
  }
});

test("saveSettings wirft ApiError bei non-2xx (z.B. 401 abgelaufene Session)", async () => {
  const f = stubFetch(() => fakeResponse({ ok: false, status: 401, json: {} }));
  try {
    await assert.rejects(saveSettings({ agentName: "X" }), (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 401);
      return true;
    });
  } finally {
    f.restore();
  }
});
