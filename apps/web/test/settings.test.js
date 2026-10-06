import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ApiError,
  ERROR_INVALID_PRIVATE_NUMBER,
  SETTINGS_FREE_FIELDS,
  SETTINGS_RESTRICT_ONLY_FIELDS,
  SETTINGS_PERMISSION_TOGGLES,
  SETTINGS_LANGUAGES,
  PERSONA_STYLE_LABELS,
  buildSettingsPatch,
  settingsOutcome,
  settingsFrom,
  saveSettings,
  personaStyleOptions,
  privateNumberStatusText,
  savePrivateNumber,
  settingsLanguageLabel,
  settingsPermissionLabel,
  settingsPermissionHint,
} from "../src/lib/api.js";

function withLang(lang, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => lang };
  try {
    fn();
  } finally {
    if (had) globalThis.localStorage = original;
    else delete globalThis.localStorage;
  }
}

import { SUPPORTED_LANGUAGES, PERSONA_STYLE_IDS } from "../../../src/i18n/locales.js";
import {
  SELF_SERVICE_FREE_FIELDS,
  SELF_SERVICE_RESTRICT_ONLY_FIELDS,
} from "../../../src/self-service.js";

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

test("Whitelist-Mengen entsprechen dem Backend-Vertrag (self-service.js)", () => {
  assert.deepEqual([...SETTINGS_FREE_FIELDS].sort(), [...SELF_SERVICE_FREE_FIELDS].sort());
  assert.deepEqual(
    [...SETTINGS_RESTRICT_ONLY_FIELDS].sort(),
    [...SELF_SERVICE_RESTRICT_ONLY_FIELDS].sort(),
  );
  const toggleKeys = SETTINGS_PERMISSION_TOGGLES.map((t) => t.key);
  assert.deepEqual([...toggleKeys].sort(), [...SETTINGS_RESTRICT_ONLY_FIELDS].sort());
});

test("SETTINGS_LANGUAGES deckt GENAU die Backend-Sprachen ab (+ '' = automatisch)", () => {
  const codes = SETTINGS_LANGUAGES.map((l) => l.value).filter((v) => v !== "");
  assert.deepEqual([...codes].sort(), [...SUPPORTED_LANGUAGES].sort());
  assert.equal(SETTINGS_LANGUAGES[0].value, "");
  assert.equal(SETTINGS_LANGUAGES.filter((l) => l.value === "").length, 1);
  for (const l of SETTINGS_LANGUAGES) assert.ok(l.label.length > 0);
});

test("buildSettingsPatch baut ausschliesslich die Whitelist-Felder", () => {
  const patch = buildSettingsPatch({
    agentName: "Hermes",
    greeting: "Hallo {owner}",
    language: "de",
    agentStyle: "warm-persoenlich",
    allowPersonalData: false,
    allowBankData: false,
  });
  assert.deepEqual(Object.keys(patch).sort(), [
    "agentName",
    "agentStyle",
    "allowBankData",
    "allowPersonalData",
    "greeting",
    "language",
  ]);
});

test("buildSettingsPatch verwirft unbekannte Felder (kein Schreibpfad ausserhalb der Whitelist)", () => {
  const patch = buildSettingsPatch({
    agentName: "X",
    allowSummaries: true,
    disclosureLine: "boese",
    randomKey: 1,
  });
  assert.equal("allowSummaries" in patch, false);
  assert.equal("disclosureLine" in patch, false);
  assert.equal("randomKey" in patch, false);
});

test("buildSettingsPatch: greeting ist nur ein String-Wert (Template-Auswahl), kein Freitext-Feld", () => {
  const patch = buildSettingsPatch({ greeting: "Guten Tag, {owner}" });
  assert.equal(patch.greeting, "Guten Tag, {owner}");
  assert.equal(typeof patch.greeting, "string");
});

test("buildSettingsPatch: fehlende Felder -> nicht gerendert = nicht gesendet (auch die Permission-Toggles)", () => {
  const patch = buildSettingsPatch({});
  assert.deepEqual(patch, {});
  assert.deepEqual(buildSettingsPatch(undefined), {});
});

test("buildSettingsPatch: explizit uebergebene Permission-Booleans reisen weiter (Feld bleibt gueltig)", () => {
  const patch = buildSettingsPatch({ allowPersonalData: true, allowBankData: false });
  assert.deepEqual(patch, { allowPersonalData: true, allowBankData: false });
});

test("buildSettingsPatch: das reale Insel-Formular (nur language) sendet weder agentName/agentStyle/greeting noch Toggles", () => {
  const patch = buildSettingsPatch({ language: "fr" });
  assert.deepEqual(patch, { language: "fr" });
});

test("buildSettingsPatch: Toggle-Werte werden zu Boolean normalisiert", () => {
  const patch = buildSettingsPatch({
    allowPersonalData: 1,
    allowBankData: "",
  });
  assert.equal(patch.allowPersonalData, true);
  assert.equal(patch.allowBankData, false);
});

test("buildSettingsPatch: agentStyle fehlt, wenn der Snapshot es nicht traegt; reist mit, wenn ja; '' bleibt ''", () => {
  assert.equal("agentStyle" in buildSettingsPatch({ agentName: "X" }), false);
  assert.equal(buildSettingsPatch({ agentStyle: "warm-persoenlich" }).agentStyle, "warm-persoenlich");
  assert.equal(buildSettingsPatch({ agentStyle: "" }).agentStyle, "");
});

test("settingsOutcome: uebernommene Felder -> changed, abweichende -> rejected", () => {
  const patch = { agentName: "Neu", language: "fr", agentStyle: "warm-persoenlich" };
  const saved = { agentName: "Neu", language: "fr", agentStyle: "warm-persoenlich" };
  const out = settingsOutcome(patch, saved);
  assert.deepEqual(out.changed.sort(), ["agentName", "agentStyle", "language"]);
  assert.deepEqual(out.rejected, []);
});

test("settingsOutcome: restrict-only false->true wird als rejected erkannt (Server haelt alten Wert)", () => {
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

test("settingsOutcome: ein zurueckgesetztes optionales Override (''->null) gilt als changed, nicht rejected", () => {
  const patch = { language: "", agentStyle: "" };
  const saved = { language: null, agentStyle: null };
  const out = settingsOutcome(patch, saved);
  assert.deepEqual(out.changed.sort(), ["agentStyle", "language"]);
  assert.deepEqual(out.rejected, []);
});

test("settingsOutcome: ein gar nicht vorhandenes Feld (undefined) bleibt rejected", () => {
  const patch = { agentStyle: "" };
  const saved = {};
  const out = settingsOutcome(patch, saved);
  assert.deepEqual(out.changed, []);
  assert.deepEqual(out.rejected, ["agentStyle"]);
});

test("settingsFrom: leere Defaults bei fehlendem data/settings/templates", () => {
  assert.deepEqual(settingsFrom(undefined), { settings: {}, greetingTemplates: [] });
  assert.deepEqual(settingsFrom({}), { settings: {}, greetingTemplates: [] });
  assert.deepEqual(settingsFrom({ greetingTemplates: "x" }), {
    settings: {},
    greetingTemplates: [],
  });
});

test("settingsFrom: befuellte Felder unveraendert durch", () => {
  const data = { settings: { agentName: "A" }, greetingTemplates: ["t1", "t2"] };
  assert.deepEqual(settingsFrom(data), {
    settings: { agentName: "A" },
    greetingTemplates: ["t1", "t2"],
  });
});

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

test("personaStyleOptions: kein Array/kein Feld -> null (Steuerelement bleibt versteckt)", () => {
  assert.equal(personaStyleOptions(undefined), null);
  assert.equal(personaStyleOptions({}), null);
  assert.equal(personaStyleOptions({ personaStyleIds: "warm-persoenlich" }), null);
});

test("personaStyleOptions: erste Option ist der Default, danach genau die Server-IDs in Reihenfolge", () => {
  const options = personaStyleOptions({ personaStyleIds: PERSONA_STYLE_IDS });
  assert.equal(options[0].value, "");
  assert.deepEqual(
    options.slice(1).map((o) => o.value),
    [...PERSONA_STYLE_IDS],
  );
});

test("personaStyleOptions: Beschriftungen sind englisch, kein deutscher Wortstamm im /app-Dropdown", () => {
  const options = personaStyleOptions({ personaStyleIds: PERSONA_STYLE_IDS });
  for (const { label } of options) {
    assert.doesNotMatch(label, /persoenlich|professionell/i);
  }
});

test("personaStyleOptions: unbekannte Server-ID faellt fail-soft auf die rohe ID zurueck", () => {
  const options = personaStyleOptions({ personaStyleIds: ["ein-neuer-stil"] });
  assert.deepEqual(options[1], { value: "ein-neuer-stil", label: "ein-neuer-stil" });
});

test("PERSONA_STYLE_LABELS driftet nicht gegen das Backend-Enum PERSONA_STYLE_IDS", () => {
  assert.deepEqual(
    Object.keys(PERSONA_STYLE_LABELS).sort(),
    [...PERSONA_STYLE_IDS].sort(),
    "eine dritte Backend-Stil-ID braucht eine englische Beschriftung in diesem Katalog",
  );
});

test("privateNumberStatusText: Maske vorhanden -> Statuszeile mit der Maske", () => {
  assert.equal(privateNumberStatusText({ privateNumber: "+49…4567" }), "Currently saved: +49…4567");
});

test("privateNumberStatusText: fehlend/null/kein String -> Leerzustand", () => {
  assert.equal(privateNumberStatusText(undefined), "No number saved yet.");
  assert.equal(privateNumberStatusText({}), "No number saved yet.");
  assert.equal(privateNumberStatusText({ privateNumber: null }), "No number saved yet.");
  assert.equal(privateNumberStatusText({ privateNumber: 123 }), "No number saved yet.");
});

test("savePrivateNumber postet {privateNumber} same-origin ohne Authorization-Header", async () => {
  const f = stubFetch(() => fakeResponse({ ok: true, status: 200, json: { ok: true, hasPrivateNumber: true } }));
  try {
    const result = await savePrivateNumber("+1 555 0100");
    assert.deepEqual(result, { ok: true, hasPrivateNumber: true });
    const { path, options } = f.calls[0];
    assert.equal(path, "/api/self-service/private-number");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), { privateNumber: "+1 555 0100" });
    assert.equal(options.headers.Authorization, undefined);
  } finally {
    f.restore();
  }
});

test("savePrivateNumber('') sendet {privateNumber:''} (Loeschen)", async () => {
  const f = stubFetch(() => fakeResponse({ ok: true, status: 200, json: { ok: true, hasPrivateNumber: false } }));
  try {
    await savePrivateNumber("");
    assert.deepEqual(JSON.parse(f.calls[0].options.body), { privateNumber: "" });
  } finally {
    f.restore();
  }
});

test("DE-Modus: settingsLanguageLabel deckt genau die SETTINGS_LANGUAGES-Werte deutsch ab", () => {
  withLang("de", () => {
    assert.equal(settingsLanguageLabel(""), "Automatisch");
    assert.equal(settingsLanguageLabel("de"), "Deutsch");
    assert.equal(settingsLanguageLabel("fr"), "Französisch");
    assert.equal(settingsLanguageLabel("en"), "Englisch");
    assert.equal(settingsLanguageLabel("xx"), "xx");
  });
  for (const { value, label } of SETTINGS_LANGUAGES) assert.equal(settingsLanguageLabel(value), label);
});

test("DE-Modus: settingsPermissionLabel/-Hint decken genau die Toggle-Keys deutsch ab", () => {
  withLang("de", () => {
    assert.equal(settingsPermissionLabel("allowPersonalData"), "Persönliche Daten");
    assert.equal(settingsPermissionLabel("allowBankData"), "Bankdaten");
    assert.equal(settingsPermissionHint("allowPersonalData"), "Adresse, E-Mail usw. weitergeben.");
    assert.equal(settingsPermissionHint("allowBankData"), "Zahlungsdaten weitergeben (nicht empfohlen).");
  });
  for (const { key, label, hint } of SETTINGS_PERMISSION_TOGGLES) {
    assert.equal(settingsPermissionLabel(key), label);
    assert.equal(settingsPermissionHint(key), hint);
  }
});

test("savePrivateNumber wirft ApiError mit ERROR_INVALID_PRIVATE_NUMBER bei 400", async () => {
  const f = stubFetch(() =>
    fakeResponse({ ok: false, status: 400, json: { error: "invalid_private_number" } }),
  );
  try {
    await assert.rejects(savePrivateNumber("nicht-valide"), (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 400);
      assert.equal(err.code, ERROR_INVALID_PRIVATE_NUMBER);
      return true;
    });
  } finally {
    f.restore();
  }
});
