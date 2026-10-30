import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";

const WIDGET_LOCALE_META_KEY = "hermes/locale";
const WIDGET_CONTENT_LOCALE_META_KEY = "hermes/content_locale";
const METHOD_TOOL_RESULT = "ui/notifications/tool-result";
const WIDGET_AGENT_STATUS = "agent-status";
const WIDGET_MY_NUMBER = "my-number";
const WIDGET_CALLS = "calls";
const WIDGET_CALL = "call";
const WIDGETS = await ausgelieferteWidgets();
const widgetHtml = (id) => WIDGETS[id];
const SKRIPT_BLOCK = /<script>\n([\s\S]*?)\n\s*<\/script>/g;
const skriptMit = (html, teil) => [...html.matchAll(SKRIPT_BLOCK)].map(([, code]) => code).find((code) => code.includes(teil));
const I18N_SKRIPT = skriptMit(widgetHtml("call"), "HermesI18n = {");
const WIDGET_DICT = JSON.parse(I18N_SKRIPT.match(/var WIDGET_DICT = (.*);\n/)[1]);

const ALL_WIDGET_IDS = [WIDGET_AGENT_STATUS, WIDGET_MY_NUMBER, WIDGET_CALLS, WIDGET_CALL];
const UI_INITIALIZE_ID = 1;
const METHOD_HOST_CONTEXT_CHANGED = "ui/notifications/host-context-changed";
const SPRACHEN = ["de", "fr"];

function fakeLabel(key) {
  const attrs = { "data-i18n": key };
  return {
    textContent: key,
    getAttribute: (name) => attrs[name] ?? null,
    setAttribute: (name, value) => {
      attrs[name] = value;
    },
  };
}

function startI18n(labelKeys = ["Duration", "Call ended"]) {
  const labels = labelKeys.map(fakeLabel);
  const listeners = {};
  const documentElement = { lang: "" };
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.document = {
    documentElement,
    readyState: "complete",
    querySelectorAll: () => labels,
    addEventListener() {},
  };
  sandbox.addEventListener = (type, handler) => {
    listeners[type] = handler;
  };
  vm.createContext(sandbox);
  vm.runInContext(I18N_SKRIPT, sandbox);
  const send = (data) => listeners.message({ data });
  return {
    labels,
    documentElement,
    locale: () => sandbox.window.HermesI18n.locale,
    toolResult: (meta) => send({ method: METHOD_TOOL_RESULT, params: { _meta: meta } }),
    hostInit: (hostContext) => send({ jsonrpc: "2.0", id: UI_INITIALIZE_ID, result: { hostContext } }),
    hostChanged: (params) => send({ jsonrpc: "2.0", method: METHOD_HOST_CONTEXT_CHANGED, params }),
    texts: () => labels.map((el) => el.textContent),
  };
}

const tenant = (lang) => ({ [WIDGET_LOCALE_META_KEY]: lang });
const content = (lang) => ({ [WIDGET_CONTENT_LOCALE_META_KEY]: lang });

test("WSP-1 (Sprachwahl, Tabelle) - Mandantensprache und Inhaltssprache entscheiden die Widget-Sprache, nie ein Gemisch", () => {
  const faelle = [
    { name: "de ohne Inhaltsangabe", meta: [tenant("de")], erwartet: "de" },
    { name: "de, Inhalt de", meta: [{ ...tenant("de"), ...content("de") }], erwartet: "de" },
    { name: "fr, Inhalt fr", meta: [{ ...tenant("fr"), ...content("fr") }], erwartet: "fr" },
    { name: "de, Inhalt unbekannt", meta: [{ ...tenant("de"), ...content(null) }], erwartet: "en" },
    { name: "de, Inhalt fr", meta: [{ ...tenant("de"), ...content("fr") }], erwartet: "en" },
    { name: "de, Inhalt en", meta: [{ ...tenant("de"), ...content("en") }], erwartet: "en" },
    { name: "de, Inhalt de-DE (Regionstag)", meta: [{ ...tenant("de"), ...content("de-DE") }], erwartet: "de" },
    { name: "Fremdinhalt bleibt haengen, auch wenn spaeter passender Inhalt folgt", meta: [{ ...tenant("de"), ...content(null) }, content("de")], erwartet: "en" },
    { name: "erst passender, dann unbekannter Inhalt", meta: [{ ...tenant("de"), ...content("de") }, content(null)], erwartet: "en" },
    { name: "Sprache ohne Woerterbuch (pt)", meta: [{ ...tenant("pt"), ...content("pt") }], erwartet: "en" },
    { name: "en, Inhalt en", meta: [{ ...tenant("en"), ...content("en") }], erwartet: "en" },
    { name: "Mandantensprache kein String", meta: [{ [WIDGET_LOCALE_META_KEY]: { x: 1 } }], erwartet: "en" },
  ];
  for (const fall of faelle) {
    const widget = startI18n();
    for (const meta of fall.meta) widget.toolResult(meta);
    assert.equal(widget.locale(), fall.erwartet, fall.name);
    assert.equal(widget.documentElement.lang, fall.erwartet, `${fall.name}: lang`);
  }
});

test("WSP-2 (Host-Rueckfall, Tabelle) - hostContext.locale gilt nur ohne Mandantensprache, nie umgekehrt", () => {
  const faelle = [
    { name: "nur Host de-DE", schritte: (w) => w.hostInit({ locale: "de-DE" }), erwartet: "de" },
    { name: "Host fr_CA", schritte: (w) => w.hostInit({ locale: "fr_CA" }), erwartet: "fr" },
    { name: "Host pt-BR ohne Woerterbuch", schritte: (w) => w.hostInit({ locale: "pt-BR" }), erwartet: "en" },
    { name: "Host ohne locale", schritte: (w) => w.hostInit({ theme: "dark" }), erwartet: "en" },
    { name: "Host ohne hostContext", schritte: (w) => w.hostInit(undefined), erwartet: "en" },
    {
      name: "Mandant fr schlaegt Host de (Host zuerst)",
      schritte: (w) => {
        w.hostInit({ locale: "de" });
        w.toolResult(tenant("fr"));
      },
      erwartet: "fr",
    },
    {
      name: "Mandant fr schlaegt Host de (Mandant zuerst)",
      schritte: (w) => {
        w.toolResult(tenant("fr"));
        w.hostInit({ locale: "de" });
      },
      erwartet: "fr",
    },
    { name: "Host-Aenderung de", schritte: (w) => w.hostChanged({ locale: "de" }), erwartet: "de" },
    {
      name: "Host de, Server-Inhalt en (stdio)",
      schritte: (w) => {
        w.hostInit({ locale: "de" });
        w.toolResult(content("en"));
      },
      erwartet: "en",
    },
    {
      name: "Host de, Server-Inhalt de",
      schritte: (w) => {
        w.hostInit({ locale: "de" });
        w.toolResult(content("de"));
      },
      erwartet: "de",
    },
  ];
  for (const fall of faelle) {
    const widget = startI18n();
    fall.schritte(widget);
    assert.equal(widget.locale(), fall.erwartet, fall.name);
  }
});

test("WSP-3 (Umschalten) - schon geschriebene Texte folgen einer spaeteren Sprachaenderung, kein Gemisch auf dem Schirm", () => {
  const widget = startI18n(["Duration", "Call ended"]);
  widget.toolResult(tenant("de"));
  assert.deepEqual(widget.texts(), [WIDGET_DICT.de.Duration, WIDGET_DICT.de["Call ended"]]);

  widget.toolResult(content(null));
  assert.deepEqual(widget.texts(), ["Duration", "Call ended"], "unbekannter Inhalt -> alle Beschriftungen englisch");

  const spaeter = startI18n(["Duration"]);
  spaeter.toolResult(content("fr"));
  spaeter.hostInit({ locale: "fr" });
  assert.deepEqual(spaeter.texts(), [WIDGET_DICT.fr.Duration], "Host-Sprache kommt nach dem Inhalt an");
});

function schluesselAusMarkup(html) {
  const ohneSkripte = html.replace(/<script>[\s\S]*?<\/script>/g, "").replace(/<style>[\s\S]*?<\/style>/g, "");
  return [...ohneSkripte.matchAll(/data-i18n="([^"]+)"/g)].map(([, key]) => key);
}

function schluesselAusSkript(html) {
  const treffer = [];
  for (const block of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    for (const t of block[1].matchAll(/\bt\("((?:[^"\\]|\\.)+)"\)/g)) treffer.push(JSON.parse(`"${t[1]}"`));
    for (const label of block[1].matchAll(/(?:pillLabel|hudPhase):\s*"((?:[^"\\]|\\.)+)"/g)) treffer.push(label[1]);
    for (const konstante of block[1].matchAll(/_HINT\s*=\s*"((?:[^"\\]|\\.)+)"/g)) treffer.push(konstante[1]);
  }
  return treffer;
}

test("WSP-4 (Vollstaendigkeit) - jeder im Widget verwendete Beschriftungsschluessel hat in JEDER Sprache eine Uebersetzung", () => {
  for (const id of ALL_WIDGET_IDS) {
    const html = widgetHtml(id);
    const schluessel = new Set([...schluesselAusMarkup(html), ...schluesselAusSkript(html)]);
    assert.ok(schluessel.size > 0, `${id}: Schluessel gefunden`);
    for (const sprache of SPRACHEN) {
      const fehlend = [...schluessel].filter((key) => !Object.hasOwn(WIDGET_DICT[sprache], key));
      assert.deepEqual(fehlend, [], `${id}/${sprache}: Schluessel ohne Uebersetzung`);
    }
  }
});

test("WSP-5 (Vollstaendigkeit) - die Woerterbuecher fuehren dieselben Schluessel, keine Sprache hat Luecken oder Waisen", () => {
  const de = Object.keys(WIDGET_DICT.de).sort();
  for (const sprache of SPRACHEN) {
    assert.deepEqual(Object.keys(WIDGET_DICT[sprache]).sort(), de, `${sprache}: gleiche Schluessel wie de`);
  }
});

const NICHT_SICHTBAR = [
  /<script>[\s\S]*?<\/script>/g,
  /<style>[\s\S]*?<\/style>/g,
  /<!--[\s\S]*?-->/g,
  /<svg[\s\S]*?<\/svg>/g,
  /<head>[\s\S]*?<\/head>/g,
  /<[^>]*data-i18n="[^"]*"[^>]*>[^<]*<\/[a-z]+>/g,
];

function sichtbaresMarkup(html) {
  return NICHT_SICHTBAR.reduce((rest, muster) => rest.replace(muster, ""), html);
}

test("WSP-6 (Text im Markup) - ausserhalb von data-i18n steht in keinem Widget ein sprachgebundener Text", () => {
  const neutral = /^(?:[—·\s\d:.,%/()+-]*|Hermes)$/;
  for (const id of ALL_WIDGET_IDS) {
    const texte = [...sichtbaresMarkup(widgetHtml(id)).matchAll(/>([^<]+)</g)]
      .map(([, text]) => text.trim())
      .filter((text) => text.length > 0);
    const sprachgebunden = texte.filter((text) => !neutral.test(text));
    assert.deepEqual(sprachgebunden, [], `${id}: Text ohne data-i18n im Markup`);
  }
});

function anrufListeImBrowser() {
  const alle = [];
  const neuesElement = () => {
    const element = schlichtesElement();
    alle.push(element);
    return element;
  };
  const container = neuesElement();
  container.setAttribute("data-mcp-row", "direction,counterparty,status,startedAt,summary");
  const listeners = [];
  const sandbox = { parent: { postMessage() {} } };
  sandbox.window = sandbox;
  sandbox.document = {
    documentElement: { lang: "" },
    readyState: "complete",
    body: schlichtesElement(),
    defaultView: sandbox,
    querySelector: () => null,
    querySelectorAll: (selektor) => {
      if (selektor === "[data-i18n]") return alle.filter((element) => element.getAttribute("data-i18n") !== null);
      return selektor === '[data-mcp="calls"]' ? [container] : [];
    },
    createElement: neuesElement,
    addEventListener() {},
  };
  sandbox.addEventListener = (type, handler) => {
    if (type === "message") listeners.push(handler);
  };
  vm.createContext(sandbox);
  vm.runInContext(I18N_SKRIPT, sandbox);
  vm.runInContext(skriptMit(widgetHtml(WIDGET_CALLS), "function renderRows"), sandbox);
  return {
    emit: (params) => listeners.forEach((handler) => handler({ data: { method: METHOD_TOOL_RESULT, params } })),
    zeilen: () => container.children.map((zeile) => zellenwerte(zeile, (zelle) => zelle.textContent)),
  };
}

function zellenwerte(zeile, lese) {
  return Object.fromEntries(zeile.children.map((zelle) => [zelle.getAttribute("data-field"), lese(zelle)]));
}

const EINTRAEGE = [
  { direction: "outbound", counterparty: "+4930", status: "completed", startedAt: "30.10.", summary: "Termin" },
  { direction: "inbound", counterparty: "+4931", status: "in_progress", startedAt: "30.10." },
  { direction: "outbound", counterparty: "+4932", status: "dialing", startedAt: "30.10." },
  { direction: "outbound", counterparty: "+4933", status: "failed", startedAt: "30.10." },
  { direction: "outbound", counterparty: "+4934", status: "cancelled", startedAt: "30.10." },
  { direction: "outbound", counterparty: "+4935", status: "neuer_status", startedAt: "30.10." },
];
const LISTE_ERWARTET = {
  en: {
    richtung: ["Outbound", "Inbound", "Outbound", "Outbound", "Outbound", "Outbound"],
    status: ["Completed", "In call", "Placing call", "Failed", "Cancelled", "Result unknown"],
  },
  de: {
    richtung: ["Ausgehend", "Eingehend", "Ausgehend", "Ausgehend", "Ausgehend", "Ausgehend"],
    status: ["Abgeschlossen", "Im Gespräch", "Anruf wird platziert", "Fehlgeschlagen", "Abgebrochen", "Ergebnis unbekannt"],
  },
  fr: {
    richtung: ["Sortant", "Entrant", "Sortant", "Sortant", "Sortant", "Sortant"],
    status: ["Terminé", "En communication", "Numérotation en cours", "Échec", "Annulé", "Résultat inconnu"],
  },
};

test("WSP-7 (Anrufliste) - Richtung und Status erscheinen als Beschriftung der Widget-Sprache, nie als Roh-Token", () => {
  for (const [sprache, erwartet] of Object.entries(LISTE_ERWARTET)) {
    const liste = anrufListeImBrowser();
    liste.emit({ _meta: tenant(sprache), structuredContent: { calls: EINTRAEGE } });
    const zeilen = liste.zeilen();
    assert.deepEqual(zeilen.map((zeile) => zeile.direction), erwartet.richtung, `${sprache}: Richtung`);
    assert.deepEqual(zeilen.map((zeile) => zeile.status), erwartet.status, `${sprache}: Status`);
    assert.equal(zeilen[0].counterparty, "+4930", `${sprache}: Rufnummer bleibt unveraendert`);
    assert.equal(zeilen[0].summary, "Termin", `${sprache}: Inhalt bleibt unveraendert`);
  }
});

test("WSP-8 (Anrufliste) - schon gezeichnete Zeilen folgen einem Sprachwechsel, auch dem auf Englisch durch Fremdinhalt", () => {
  const liste = anrufListeImBrowser();
  liste.emit({ _meta: tenant("de"), structuredContent: { calls: EINTRAEGE } });
  assert.equal(liste.zeilen()[0].status, "Abgeschlossen");
  liste.emit({ _meta: content(null) });
  const zeilen = liste.zeilen();
  assert.deepEqual(zeilen.map((zeile) => zeile.direction), LISTE_ERWARTET.en.richtung);
  assert.deepEqual(zeilen.map((zeile) => zeile.status), LISTE_ERWARTET.en.status);
});

function schlichtesElement() {
  const attrs = {};
  return {
    _text: "",
    className: "",
    style: {},
    children: [],
    firstChild: null,
    get textContent() {
      return this._text;
    },
    set textContent(value) {
      this._text = value;
    },
    getAttribute: (name) => attrs[name] ?? null,
    setAttribute: (name, value) => {
      attrs[name] = String(value);
    },
    removeAttribute: (name) => {
      delete attrs[name];
    },
    appendChild(child) {
      this.children.push(child);
    },
    removeChild() {},
    addEventListener() {},
  };
}

function callWidgetImBrowser() {
  const elemente = new Map();
  const element = (selektor) => {
    if (!elemente.has(selektor)) elemente.set(selektor, schlichtesElement());
    return elemente.get(selektor);
  };
  const listeners = [];
  const gesendet = [];
  const sandbox = { __hermesUiReady: true, parent: { postMessage: (nachricht) => gesendet.push(nachricht) }, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {} };
  sandbox.window = sandbox;
  sandbox.document = {
    documentElement: { lang: "" },
    readyState: "complete",
    body: schlichtesElement(),
    querySelector: element,
    querySelectorAll: () => [...elemente.values()].filter((el) => el.getAttribute("data-i18n") !== null),
    createElement: schlichtesElement,
    addEventListener() {},
  };
  sandbox.addEventListener = (type, handler) => {
    if (type === "message") listeners.push(handler);
  };
  sandbox.CustomEvent = function CustomEvent(type) {
    this.type = type;
  };
  sandbox.dispatchEvent = () => {};
  vm.createContext(sandbox);
  const html = widgetHtml(WIDGET_CALL);
  const eigenes = skriptMit(html, "function init()");
  vm.runInContext(I18N_SKRIPT, sandbox);
  vm.runInContext(eigenes, sandbox);
  element('[data-mcp="call_id"]').textContent = "call_1";
  return {
    element,
    gesendet,
    emit: (data) => listeners.forEach((handler) => handler({ data })),
  };
}

const PUSH_STATUS = { call_id: "call_1", status: "completed", duration_s: 5, last_transcript_lines: [], failure_reason: null };
const PUSH_ERGEBNIS = { call_id: "call_1", result_summary: "Summary", objective_achieved: true, outcome: null, next_step: null };

function anzeige(widget) {
  return {
    pille: widget.element("[data-status-label]").textContent,
    phase: widget.element("[data-hud-phase]").textContent,
    ziel: widget.element("[data-objective-display]").textContent,
  };
}

test("WSP-9 (Call-Widget) - Status, HUD-Phase und Ziel-erreicht stehen komplett in der Nutzersprache; fremder Ergebnis-Text stellt ALLES auf Englisch", () => {
  const widget = callWidgetImBrowser();
  widget.emit({ method: METHOD_TOOL_RESULT, params: { _meta: { ...tenant("de"), ...content("de") }, structuredContent: PUSH_STATUS } });
  widget.emit({ method: METHOD_TOOL_RESULT, params: { structuredContent: PUSH_ERGEBNIS } });
  assert.deepEqual(anzeige(widget), { pille: "Abgeschlossen", phase: "Anruf beendet", ziel: "Ja" }, "alles Deutsch");

  widget.emit({ method: METHOD_TOOL_RESULT, params: { _meta: content(null), structuredContent: PUSH_ERGEBNIS } });
  assert.deepEqual(anzeige(widget), { pille: "Completed", phase: "Call ended", ziel: "Yes" }, "unbekannter Inhalt -> alles Englisch, auch das schon Geschriebene");
});

test("WSP-10 (Call-Widget) - die Antwort auf den eigenen get_call_result-Aufruf traegt die Inhaltssprache und kippt bei Fremdinhalt das ganze Widget", () => {
  for (const [inhalt, erwartet] of [
    [content("fr"), { pille: "Completed", phase: "Call ended", ziel: "Yes" }],
    [content(null), { pille: "Completed", phase: "Call ended", ziel: "Yes" }],
    [content("de"), { pille: "Abgeschlossen", phase: "Anruf beendet", ziel: "Ja" }],
  ]) {
    const widget = callWidgetImBrowser();
    widget.emit({ method: METHOD_TOOL_RESULT, params: { _meta: tenant("de"), structuredContent: PUSH_STATUS } });
    const anfrage = widget.gesendet.find((nachricht) => nachricht.params?.name === "get_call_result");
    assert.ok(anfrage, "completed loest get_call_result aus");
    widget.emit({ jsonrpc: "2.0", id: anfrage.id, result: { _meta: inhalt, structuredContent: PUSH_ERGEBNIS } });
    assert.deepEqual(anzeige(widget), erwartet, JSON.stringify(inhalt));
  }
});

const INHALT_AUSGENOMMEN = Object.freeze({
  last_transcript_lines: "Transkript: bleibt in der Originalsprache des Gespraechs",
  "data-confirm-to": "Nutzereingabe: Zielnummer",
  "data-confirm-objective": "Nutzereingabe: Anliegen",
  "data-confirm-notice-text": "Datenhinweis vom Server in der Mandantensprache",
});
const NUTZEREINGABEN_KARTE = Object.freeze(["briefing", "language", "max_duration_s", "constraints", "mandate", "context", "diagnostic"]);
const KENNUNG_OHNE_SPRACHE = Object.freeze({
  call_id: "Kennung",
  status: "roher Statuswert, unsichtbar (slot-hidden), angezeigt wird die Beschriftung",
  "data-duration-display": "Zeit als m:ss",
});
const IN_NUTZERSPRACHE = Object.freeze({
  result_summary: "Ergebnis-Text, Sprache ueber hermes/content_locale geprueft",
  outcome: "Ergebnis-Karte, Sprache ueber hermes/content_locale geprueft",
  next_step: "Ergebnis-Karte, Sprache ueber hermes/content_locale geprueft",
  "data-failure-display": "Beschriftung mit Schluessel",
  "data-objective-display": "Beschriftung mit Schluessel",
  "data-status-label": "Beschriftung mit Schluessel",
  "data-hud-phase": "Beschriftung mit Schluessel",
  "data-confirm-hint-text": "Beschriftung mit Schluessel",
});

function angezeigteFelder(html) {
  const markup = html.replace(/<script>[\s\S]*?<\/script>/g, "").replace(/<style>[\s\S]*?<\/style>/g, "");
  const slots = [...markup.matchAll(/data-mcp="([^"]+)"/g)].map(([, name]) => name);
  const anzeigen = [...markup.matchAll(/\b(data-(?:[a-z_]+-display|status-label|hud-phase|confirm-(?:to|objective|hint-text|notice-text)))\b/g)].map(([, name]) => name);
  return [...new Set([...slots, ...anzeigen])];
}

test("WSP-11 (Ausnahmen benannt) - jedes angezeigte Feld des Call-Widgets ist entweder in der Nutzersprache, eine Kennung oder ein ausdruecklich ausgenommener Inhalt", () => {
  const felder = angezeigteFelder(widgetHtml(WIDGET_CALL));
  const eingeordnet = new Set([...Object.keys(INHALT_AUSGENOMMEN), ...Object.keys(KENNUNG_OHNE_SPRACHE), ...Object.keys(IN_NUTZERSPRACHE)]);
  assert.deepEqual(felder.filter((feld) => !eingeordnet.has(feld)), [], "neues Feld ohne Zuordnung zur Sprachregel");
  assert.deepEqual([...eingeordnet].filter((feld) => !felder.includes(feld)), [], "Zuordnung ohne Feld im Widget");
  const kartenfelder = [...widgetHtml(WIDGET_CALL).matchAll(/data-cf-row="([a-z_]+)"/g)].map(([, name]) => name);
  assert.deepEqual(kartenfelder, NUTZEREINGABEN_KARTE, "Bestaetigungskarte zeigt genau diese Nutzereingaben, unuebersetzt");
});
