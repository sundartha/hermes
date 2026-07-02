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
  primaryLanguage,
  resolveLocale,
  translate,
} from "../src/ui/widget-i18n.js";
import {
  WIDGET_AGENT_STATUS,
  WIDGET_MY_NUMBER,
  WIDGET_CALLS,
  WIDGET_CALENDAR,
  WIDGET_CALL,
  widgetHtml,
} from "../src/ui/widget-catalog.js";

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
