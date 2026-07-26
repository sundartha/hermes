// Widget-Lokalisierung (widget-i18n.js): Key-Paritaet der Sprachtabellen,
// Locale-Aufloesung, EN-Fallback (Keys SIND englische Texte) und die
// Injektion des I18N_SCRIPT in ALLE Widget-HTML (widget-catalog.js).
// Zusaetzlich das Drift-Gate: jeder im Markup (data-i18n) oder im
// call.html-Inline-Skript (t("...")) benutzte Key existiert in JEDER
// Sprachtabelle - sonst faellt genau diese Sprache still auf Englisch
// zurueck und niemand merkt es.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LOCALE,
  WIDGET_DICT,
  WIDGET_LOCALES,
  primaryLanguage,
  resolveLocale,
  resolveWidgetLocale,
  widgetDictFor,
  translate,
} from "../src/ui/widget-i18n.js";
import {
  WIDGET_AGENT_STATUS,
  WIDGET_MY_NUMBER,
  WIDGET_CALLS,
  WIDGET_CALENDAR,
  WIDGET_CALL,
  widgetHtml,
  withI18nScript,
} from "../src/ui/widget-catalog.js";
import { SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";
import { makeDefaultState, registerTenant, setTenantGeo, tenantGeo } from "../src/store/state-ops.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIDGET_DIR = path.join(ROOT, "src", "ui", "widgets");
const ALL_WIDGET_IDS = [WIDGET_AGENT_STATUS, WIDGET_MY_NUMBER, WIDGET_CALLS, WIDGET_CALENDAR, WIDGET_CALL];
const LOCALES = Object.keys(WIDGET_DICT);

// Ueber t(FAILURE_REASON_LABELS[...])/objectiveLabel dynamisch benutzte Keys -
// die Literal-Regexes unten sehen sie nicht, uebersetzt werden muessen sie
// trotzdem (call.html failureReasonLabel/objectiveLabel).
const DYNAMIC_KEYS = ["No answer", "Busy", "Cancelled", "Failed", "Yes", "No", "Unclear"];

function widgetSources() {
  return fs
    .readdirSync(WIDGET_DIR)
    .filter((f) => f.endsWith(".html"))
    .map((f) => ({ file: f, html: fs.readFileSync(path.join(WIDGET_DIR, f), "utf8") }));
}

test("T-i18n-parity: alle Sprachtabellen tragen identische Key-Saetze", () => {
  assert.ok(LOCALES.length >= 2, "mindestens de+fr erwartet");
  const [first, ...rest] = LOCALES;
  const firstKeys = Object.keys(WIDGET_DICT[first]).sort();
  for (const locale of rest) {
    assert.deepEqual(
      Object.keys(WIDGET_DICT[locale]).sort(),
      firstKeys,
      `Key-Satz von "${locale}" weicht von "${first}" ab`,
    );
  }
});

test("T-i18n-locale: resolveLocale nimmt den ersten unterstuetzten Kandidaten, sonst en", () => {
  assert.equal(primaryLanguage("de-DE"), "de");
  assert.equal(primaryLanguage("fr_CH"), "fr");
  assert.equal(resolveLocale(["de-DE"], WIDGET_DICT), "de");
  assert.equal(resolveLocale(["FR"], WIDGET_DICT), "fr");
  assert.equal(resolveLocale(["es-ES"], WIDGET_DICT), DEFAULT_LOCALE, "nicht unterstuetzt -> en");
  assert.equal(resolveLocale([], WIDGET_DICT), DEFAULT_LOCALE);
  assert.equal(resolveLocale([undefined, null, "de"], WIDGET_DICT), "de", "leere Kandidaten uebersprungen");
  assert.equal(resolveLocale(["en-US", "de-DE"], WIDGET_DICT), "en", "en gewinnt als erster Treffer");
});

test("T-i18n-translate: en -> Key selbst; Uebersetzung je Tabelle; unbekannter Key -> Key (EN-Fallback)", () => {
  assert.equal(translate(WIDGET_DICT, "en", "Duration"), "Duration");
  assert.equal(translate(WIDGET_DICT, "de", "Duration"), "Dauer");
  assert.equal(translate(WIDGET_DICT, "fr", "Duration"), "Durée");
  assert.equal(translate(WIDGET_DICT, "de", "Unbekannter Key"), "Unbekannter Key");
});

test("T-i18n-keys-covered: jeder data-i18n-/t()-Key der Widget-Quellen existiert in JEDER Sprachtabelle", () => {
  const used = new Set(DYNAMIC_KEYS);
  for (const { html } of widgetSources()) {
    for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);
    for (const m of html.matchAll(/\bt\("([^"]+)"\)/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 20, `unerwartet wenige Keys gefunden (${used.size}) - Extraktion kaputt?`);
  for (const locale of LOCALES) {
    for (const key of used) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(WIDGET_DICT[locale], key),
        `Key "${key}" fehlt in Sprachtabelle "${locale}" (stiller EN-Fallback)`,
      );
    }
  }
});

test("T-i18n-en-default: data-i18n-Elemente tragen den Key selbst als englischen Markup-Default", () => {
  for (const { file, html } of widgetSources()) {
    for (const m of html.matchAll(/data-i18n="([^"]+)"[^>]*>([^<]*)</g)) {
      assert.equal(
        m[2],
        m[1],
        `${file}: Markup-Default "${m[2]}" weicht vom Key "${m[1]}" ab - faellt das Script aus, stimmt der EN-Text nicht`,
      );
    }
  }
});

test("T-i18n-inject: I18N_SCRIPT ist in ALLEN 5 Widget-HTML injiziert, kein Platzhalter-Leak", () => {
  for (const id of ALL_WIDGET_IDS) {
    const html = widgetHtml(id);
    assert.ok(html.includes("window.HermesI18n"), `${id}: HermesI18n fehlt`);
    assert.ok(!html.includes("__I18N__"), `${id}: Platzhalter nicht ersetzt`);
    const i18nAt = html.indexOf("window.HermesI18n");
    const bodyAt = html.indexOf("<body");
    assert.ok(i18nAt < bodyAt, `${id}: I18N_SCRIPT muss im <head> stehen (vor Inline-Skripten)`);
  }
});

// Servergerenderte Sprachfassungen (P13/E4). "en" traegt bewusst keine Tabelle:
// die Keys SIND die englischen Texte.
const SERVER_LANGUAGE_CASES = [
  { language: "de", sample: WIDGET_DICT.de.Permissions }, // "Berechtigungen"
  { language: "fr", sample: WIDGET_DICT.fr.Permissions }, // "Autorisations"
  { language: "en", sample: null },
];

test("T-i18n-server-locale: je Sprache eine eigene, stabile Fassung - die Sprache ist Teil des Cache-Schluessels", () => {
  for (const id of ALL_WIDGET_IDS) {
    for (const { language, sample } of SERVER_LANGUAGE_CASES) {
      const html = widgetHtml(id, language);
      assert.ok(html.includes(`var locale = ${JSON.stringify(language)}`), `${id}/${language}: Locale servergerendert`);
      if (sample) assert.ok(html.includes(sample), `${id}/${language}: eigene Uebersetzungstabelle eingebettet`);
      else
        for (const other of ["de", "fr"])
          assert.ok(!html.includes(WIDGET_DICT[other].Permissions), `${id}/en: keine fremde Tabelle`);
      assert.equal(widgetHtml(id, language), html, `${id}/${language}: wiederholter Aufruf byte-stabil`);
    }
    // Interleaving: eine Sprache darf die andere nicht ueberschreiben (Pre-Mortem 2).
    const de = widgetHtml(id, "de");
    assert.notEqual(widgetHtml(id, "en"), de);
    assert.equal(widgetHtml(id, "de"), de, `${id}: de-Fassung nach en-Abruf unveraendert`);
  }
});

test("T-i18n-server-locale-fallback: unbekannte/fehlende Sprache -> englische Fassung", () => {
  for (const language of [undefined, null, "", "xx", "es-ES"])
    assert.equal(widgetHtml(WIDGET_AGENT_STATUS, language), widgetHtml(WIDGET_AGENT_STATUS, "en"));
});

test("T-i18n-locale-keyset: Widget-Sprachen decken jede Agentensprache ab (kein zweiter Fallback)", () => {
  assert.deepEqual([...WIDGET_LOCALES].sort(), [DEFAULT_LOCALE, ...Object.keys(WIDGET_DICT)].sort());
  for (const language of SUPPORTED_LANGUAGES)
    assert.equal(
      resolveWidgetLocale(language),
      language,
      `Agentensprache "${language}" muss eine eigene Widget-Fassung haben, sonst faellt sie still auf Englisch`,
    );
});

test("T-i18n-inject-locale: withI18nScript injiziert das Script der uebergebenen Sprache (Fixture)", () => {
  const fixture = '<html><head><!--__I18N__--></head><body></body></html>'; // Build
  const out = widgetDictFor("de") && withI18nScript(fixture, "de"); // Operate
  assert.ok(out.includes('var locale = "de"') && !out.includes("__I18N__")); // Check
  assert.equal(withI18nScript("<html></html>", "de"), "<html></html>", "ohne Platzhalter unveraendert");
});

// ---- Umzug aus test/mcp-ui-i18n-divergence.test.js (A3) ----

// ==================== ex UI-14 ====================
// Kein Host-Signal fuer Chat-Sprache/Land im gesamten MCP-Wire-Vertrag; das Widget folgt
// stattdessen der Agentensprache, serverseitig gerendert (Owner-Entscheidung E4).
test("widgetHtml() liefert je Agentensprache unterschiedliches HTML (ex UI-14)", () => {
  for (const id of ALL_WIDGET_IDS) {
    const htmlFr = widgetHtml(id, "fr");
    const htmlEn = widgetHtml(id, "en");
    assert.notEqual(
      htmlFr,
      htmlEn,
      `${id}: nach E4 muessen sich die servergerenderten HTML-Ausgaben zwischen Sprachen unterscheiden`,
    );
  }
});

// ==================== ex UI-18 ====================
// "Land = Frankreich" faerbt die servergerenderte Widget-Sprache (Owner-Anforderung
// woertlich: "franzoesisch, wenn er in Frankreich ist").
test("tenant.country=FR faerbt die servergerenderte Widget-Sprache (ex UI-18)", () => {
  const s = makeDefaultState();
  registerTenant(s, "tenant_fr");
  setTenantGeo(s, "tenant_fr", { country: "FR", defaultLanguage: "fr" });
  const geo = tenantGeo(s, "tenant_fr");
  assert.equal(geo.country, "FR", "Server kennt das Land des Tenants");
  assert.equal(geo.defaultLanguage, "fr", "Server kennt die abgeleitete Sprache des Tenants");

  const htmlForTenant = widgetHtml(WIDGET_AGENT_STATUS, geo.defaultLanguage);
  const htmlDefault = widgetHtml(WIDGET_AGENT_STATUS);
  assert.notEqual(
    htmlForTenant,
    htmlDefault,
    "Land=FR (tenant.defaultLanguage=fr) MUSS die servergerenderte Widget-Sprache aendern",
  );
});
