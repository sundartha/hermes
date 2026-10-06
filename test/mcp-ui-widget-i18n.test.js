import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LOCALE,
  WIDGET_DICT,
  WIDGET_LOCALE_META_KEY,
  primaryLanguage,
  resolveLocale,
  incomingLocale,
  translate,
  I18N_SCRIPT,
} from "../src/ui/widget-i18n.js";
import { METHOD_TOOL_RESULT } from "../src/ui/widget-bind.js";
import {
  WIDGET_AGENT_STATUS,
  WIDGET_MY_NUMBER,
  WIDGET_CALLS,
  WIDGET_CALL,
  widgetHtml,
  withI18nScript,
} from "../src/ui/widget-catalog.js";
import { SUPPORTED_LANGUAGES, localeFor } from "../src/i18n/locales.js";
import { makeDefaultState, registerTenant, setTenantGeo, tenantGeo } from "../src/store/state-ops.js";
import { setWorldDefaultLanguageEnabled } from "../src/store/defaults.js";
import { registerTools } from "../src/mcp-tools.js";
import { FAILURE_REASON_BASE_TOKENS } from "../src/telephony/failure-reason.js";
import { CAP_FAILURE_REASON, BUDGET_FAILURE_REASON } from "../src/telephony/call-lifecycle.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIDGET_DIR = path.join(ROOT, "src", "ui", "widgets");
const ALL_WIDGET_IDS = [WIDGET_AGENT_STATUS, WIDGET_MY_NUMBER, WIDGET_CALLS, WIDGET_CALL];
const LOCALES = Object.keys(WIDGET_DICT);

function extractFailureReasonLabels(html) {
  const match = /var FAILURE_REASON_LABELS = (\{[\s\S]*?\n\s*\});/.exec(html);
  assert.ok(match, "FAILURE_REASON_LABELS-Objekt-Literal nicht in call.html gefunden");
  return new Function(`return ${match[1]};`)();
}

const CALL_HTML_SOURCE = fs.readFileSync(path.join(WIDGET_DIR, "call.html"), "utf8");
const FAILURE_REASON_LABEL_VALUES = Object.values(extractFailureReasonLabels(CALL_HTML_SOURCE));
const DYNAMIC_KEYS = [...FAILURE_REASON_LABEL_VALUES, "Yes", "No", "Unclear"];

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

const REAL_BASE_TOKENS = () => new Set([...FAILURE_REASON_BASE_TOKENS, CAP_FAILURE_REASON, BUDGET_FAILURE_REASON]);

test("T-i18n-failure-labels: jedes Basis-Token (Provider + intern) hat ein Label im ausgelieferten call.html", () => {
  const labels = extractFailureReasonLabels(CALL_HTML_SOURCE);
  assert.equal(labels["no-answer"], "No answer", "Extraktion liefert nicht das bekannte Bestandslabel");
  for (const token of REAL_BASE_TOKENS()) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(labels, token),
      `Basis-Token "${token}" hat kein Label in call.html#FAILURE_REASON_LABELS - failureReasonLabel() zeigt den rohen Token`,
    );
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

test("T-i18n-inject: I18N_SCRIPT ist in ALLEN 4 Widget-HTML injiziert, kein Platzhalter-Leak", () => {
  for (const id of ALL_WIDGET_IDS) {
    const html = widgetHtml(id);
    assert.ok(html.includes("window.HermesI18n"), `${id}: HermesI18n fehlt`);
    assert.ok(!html.includes("__I18N__"), `${id}: Platzhalter nicht ersetzt`);
    const i18nAt = html.indexOf("window.HermesI18n");
    const bodyAt = html.indexOf("<body");
    assert.ok(i18nAt < bodyAt, `${id}: I18N_SCRIPT muss im <head> stehen (vor Inline-Skripten)`);
  }
});

test("T-i18n-server-locale: die Resource ist EINE sprachneutrale Fassung mit allen Tabellen eingebettet (T2-02)", () => {
  for (const id of ALL_WIDGET_IDS) {
    const html = widgetHtml(id);
    assert.ok(html.includes('var locale = "en"'), `${id}: Start-Locale ist immer en (Pre-Mortem 2)`);
    for (const locale of Object.keys(WIDGET_DICT)) {
      assert.ok(
        html.includes(WIDGET_DICT[locale].Permissions),
        `${id}: Tabelle "${locale}" fehlt - das Umschalten im Iframe braeuchte sie`,
      );
    }
    assert.equal(widgetHtml(id), html, `${id}: wiederholter Aufruf byte-stabil (kein Lazy-Init)`);
  }
});

test("T-i18n-server-locale-fallback: incomingLocale faellt bei unbekanntem String auf en zurueck, bei Nicht-String auf null (T2-02)", () => {
  for (const candidate of ["", "xx", "es-ES"])
    assert.equal(incomingLocale(candidate, WIDGET_DICT), DEFAULT_LOCALE, `"${candidate}": unbekannter String -> en`);
  for (const candidate of [undefined, null, true, {}])
    assert.equal(incomingLocale(candidate, WIDGET_DICT), null, `${JSON.stringify(candidate)}: kein String -> null (keine Aenderung)`);
});

test("T-i18n-inject-locale: withI18nScript injiziert das EINE, sprachneutrale Script (Fixture)", () => {
  const fixture = '<html><head><!--__I18N__--></head><body></body></html>';
  const out = withI18nScript(fixture);
  assert.ok(out.includes('var locale = "en"') && !out.includes("__I18N__"));
  assert.equal(withI18nScript("<html></html>"), "<html></html>", "ohne Platzhalter unveraendert");
});

test("T-i18n-locale-keyset: Widget-Sprachen decken jede Agentensprache ab (kein zweiter Fallback)", () => {
  for (const language of SUPPORTED_LANGUAGES)
    assert.equal(
      incomingLocale(language, WIDGET_DICT),
      language,
      `Agentensprache "${language}" muss eine eigene Widget-Fassung haben, sonst faellt sie still auf Englisch`,
    );
});

test("widgetHtml() ignoriert ein zusaetzliches Sprachargument - EINE Fassung, keine Sprachmatrix (ex UI-14, T2-02 invertiert)", () => {
  for (const id of ALL_WIDGET_IDS) {
    assert.equal(widgetHtml(id, "fr"), widgetHtml(id), `${id}: ein zweites Argument darf die Fassung nicht mehr aendern`);
    assert.equal(widgetHtml(id, "en"), widgetHtml(id));
  }
});

function registeredAgentStatusResource(language) {
  const captured = [];
  const fakeServer = {
    registerTool() {},
    registerResource(...resourceArgs) {
      const [name, , , readCallback] = resourceArgs;
      captured.push({ name, readCallback });
    },
  };
  registerTools(fakeServer, { uiHost: { enabled: true }, language });
  return captured.find((entry) => entry.name === WIDGET_AGENT_STATUS);
}

test("tenant.country=FR aendert die servergerenderte Widget-Resource NICHT mehr (ex UI-18, T2-02 umgebaut)", async () => {
  const s = makeDefaultState();
  registerTenant(s, "tenant_fr");
  setTenantGeo(s, "tenant_fr", { country: "FR", defaultLanguage: "fr" });
  const geo = tenantGeo(s, "tenant_fr");
  assert.equal(geo.country, "FR", "Server kennt das Land des Tenants");
  assert.equal(geo.defaultLanguage, "fr", "Server kennt die abgeleitete Sprache des Tenants");

  const resourceFr = registeredAgentStatusResource(geo.defaultLanguage);
  const resourceEn = registeredAgentStatusResource("en");
  assert.ok(resourceFr, "WIDGET_AGENT_STATUS-Resource wurde registriert (fr)");
  assert.ok(resourceEn, "WIDGET_AGENT_STATUS-Resource wurde registriert (en)");

  const readFr = await resourceFr.readCallback();
  const readEn = await resourceEn.readCallback();
  assert.equal(
    readFr.contents[0].text,
    readEn.contents[0].text,
    "T2-02: die Resource ist sprachneutral - eine ueber registerTools() eingespeiste " +
      "Tenant-Sprache darf sie nicht mehr aendern",
  );
  assert.equal(
    readFr.contents[0].text,
    widgetHtml(WIDGET_AGENT_STATUS),
    "die registrierte Resource bleibt identisch zur direkt geladenen Fassung",
  );
});

test("UI-03 (Mechanismus, gruen) - kein Browser-/Betrachter-Sprachsignal im ausgelieferten Widget", () => {
  const forbiddenSignal = /navigator|Accept-Language|window\.openai/;
  for (const id of ALL_WIDGET_IDS) {
    assert.doesNotMatch(widgetHtml(id), forbiddenSignal, `${id}: Betrachter-Sprachsignal im ausgelieferten HTML gefunden`);
  }
});

function scriptBodyOf(script) {
  return script.match(/<script>([\s\S]*)<\/script>/)[1];
}

function runI18nScriptInSandbox() {
  const documentElement = { lang: "" };
  const listeners = {};
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.document = {
    documentElement,
    readyState: "complete",
    querySelectorAll: () => [],
    addEventListener() {},
  };
  sandbox.addEventListener = (type, handler) => {
    listeners[type] = handler;
  };
  vm.createContext(sandbox);
  vm.runInContext(scriptBodyOf(I18N_SCRIPT), sandbox);
  return { documentElement, listeners, sandbox };
}

function sendLocaleMessage(listeners, localeValue) {
  listeners.message({
    data: { method: METHOD_TOOL_RESULT, params: { _meta: { [WIDGET_LOCALE_META_KEY]: localeValue } } },
  });
}

test("UI-04 (Mechanismus, gruen) - das I18N-Script startet englisch und schaltet per tool-result um (T2-02)", () => {
  for (const locale of ["de", "fr"]) {
    const { documentElement, listeners, sandbox } = runI18nScriptInSandbox();
    assert.equal(documentElement.lang, DEFAULT_LOCALE, "Start-Locale ist immer en");
    assert.equal(sandbox.window.HermesI18n.locale, DEFAULT_LOCALE);
    assert.equal(sandbox.window.HermesI18n.t("Duration"), "Duration", "vor dem Umschalten: EN-Fallback");

    sendLocaleMessage(listeners, locale);

    assert.equal(documentElement.lang, locale, `${locale}: documentElement.lang nach Umschalten`);
    assert.equal(sandbox.window.HermesI18n.locale, locale, `${locale}: HermesI18n.locale nach Umschalten`);
    assert.equal(sandbox.window.HermesI18n.t("Duration"), WIDGET_DICT[locale].Duration, `${locale}: t("Duration")`);
  }
});

test("UI-04b (Mechanismus, gruen) - unbekannte/fehlende Sprache in der Nachricht faellt auf en, aendert eine gesetzte Locale nicht zurueck (T2-02)", () => {
  const { documentElement, listeners, sandbox } = runI18nScriptInSandbox();

  sendLocaleMessage(listeners, "xx");
  assert.equal(documentElement.lang, DEFAULT_LOCALE, "unbekannter String -> en");

  sendLocaleMessage(listeners, "de");
  assert.equal(sandbox.window.HermesI18n.locale, "de");

  sendLocaleMessage(listeners, { not: "a string" });
  assert.equal(sandbox.window.HermesI18n.locale, "de", "Objekt-Wert darf eine bereits gesetzte Locale nicht zuruecksetzen");
});

test("UI-07 (OCP, gruen) - eine neue Widget-Sprache braucht genau EINEN Dict-Eintrag", () => {
  const key = "Duration";
  const placeholder = "PLATZHALTER-ES";
  const extendedDict = { ...WIDGET_DICT, es: { [key]: placeholder } };

  assert.equal(resolveLocale(["es-ES"], extendedDict), "es", "neue Sprache wird ueber resolveLocale gefunden");
  assert.equal(translate(extendedDict, "es", key), placeholder, "Uebersetzung greift ueber die erweiterte Tabelle");
  assert.equal(translate(WIDGET_DICT, "es", key), key, "das Original-Dict bleibt unberuehrt (kein 'es' darin)");
});

test("UI-13 (Sicherungs-Invariante, gruen) - kein Markup-Schreibpfad im ausgelieferten Widget", () => {
  const forbiddenWrite = /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write/;
  for (const id of ALL_WIDGET_IDS) {
    assert.doesNotMatch(widgetHtml(id), forbiddenWrite, `${id}: Markup-Schreibpfad im ausgelieferten HTML gefunden`);
  }
});

test("UI-15 (Mechanismus, gruen) - der Widget-Fallback ist EN-verankert, unabhaengig vom Weltdefault", () => {
  try {
    setWorldDefaultLanguageEnabled(false);
    assert.equal(incomingLocale("xx", WIDGET_DICT), DEFAULT_LOCALE, "unbekannte Sprache -> Widget-EN-Fallback");
    assert.equal(localeFor("xx").language, "de", "Kontrast: die Sprach-Achse faellt (Vor-Flip) auf de zurueck");
  } finally {
    setWorldDefaultLanguageEnabled(true);
  }
});
