import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import { widgetPins } from "../../src/ui/registry.js";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const WIDGETS = await ausgelieferteWidgets();
const LISTE = WIDGETS.calls;
const NEUE_VERSION = 25;
const ERGEBNIS = "ui/notifications/tool-result";
const WOERTERBUCH = JSON.parse(/var WIDGET_DICT = (\{.*\});\n/.exec(LISTE)[1]);

function uebersetze(sprache, key) {
  return sprache === "en" ? key : (WOERTERBUCH[sprache]?.[key] ?? key);
}

function stil(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
}

function regel(css, selektor) {
  const start = css.indexOf(selektor + "{");
  assert.notEqual(start, -1, "Regel " + selektor + " fehlt");
  return css.slice(start + selektor.length + 1, css.indexOf("}", start)).replace(/\s+/g, "");
}

function knoten(tag, klasse = "") {
  const klassen = new Set();
  return {
    tag,
    kinder: [],
    attribute: {},
    style: {},
    text: "",
    className: klasse,
    klassen,
    classList: {
      add: (name) => klassen.add(name),
    },
    setAttribute(name, wert) {
      this.attribute[name] = wert;
    },
    getAttribute(name) {
      return this.attribute[name] ?? null;
    },
    appendChild(kind) {
      this.kinder.push(kind);
      return kind;
    },
    insertBefore(kind, vor) {
      this.kinder.splice(this.kinder.indexOf(vor), 0, kind);
      return kind;
    },
    get firstChild() {
      return this.kinder[0] ?? null;
    },
    get children() {
      return this.kinder;
    },
    get textContent() {
      return this.text;
    },
    set textContent(wert) {
      this.text = wert;
    },
    querySelector(sel) {
      const feld = /^\[data-field="(\w+)"\]$/.exec(sel);
      if (feld) return this.kinder.find((k) => k.attribute["data-field"] === feld[1]) ?? null;
      if (sel === ".kreis") return this.kinder.find((k) => k.className.split(" ").includes("kreis")) ?? null;
      return null;
    },
  };
}

function zeile({ richtung, status, name, zeit = "11:35", text = "" }) {
  const z = knoten("div", "row");
  const felder = [
    ["direction", richtung === "inbound" ? "Inbound" : "Outbound", richtung === "inbound" ? "Inbound" : "Outbound"],
    ["counterparty", name, null],
    ["status", status.text, status.key],
    ["startedAt", zeit, null],
    ["summary", text, null],
  ];
  for (const [feld, inhalt, schluessel] of felder) {
    const z2 = knoten("span", "cell");
    z2.setAttribute("data-field", feld);
    if (schluessel) z2.setAttribute("data-i18n", schluessel);
    z2.text = inhalt;
    z.kinder.push(z2);
  }
  return z;
}

const FERTIG = { key: "Completed", text: "Completed" };
const FEHLER = { key: "Failed", text: "Failed" };
const ABBRUCH = { key: "Cancelled", text: "Cancelled" };

function seite(sprache = "en") {
  const liste = knoten("div", "sheet liste");
  const vor = knoten("span");
  vor.text = "Recent calls";
  vor.setAttribute("data-i18n", "Recent calls");
  const zahl = knoten("em");
  const nach = knoten("span");
  const beobachter = [];
  const hoerer = [];
  const dokument = {
    documentElement: knoten("html"),
    querySelector(sel) {
      return { '[data-mcp="calls"]': liste, '[data-kopf="vor"]': vor, '[data-kopf="zahl"]': zahl, '[data-kopf="nach"]': nach }[sel] ?? null;
    },
    createElement: (tag) => knoten(tag),
    createElementNS: (ns, tag) => ({ ...knoten(tag), ns }),
  };
  class MutationObserver {
    constructor(rueckruf) {
      this.rueckruf = rueckruf;
    }
    observe(ziel, optionen) {
      beobachter.push({ ziel, optionen, rueckruf: this.rueckruf });
    }
  }
  const fenster = {
    HermesI18n: { t: (key) => uebersetze(sprache, key) },
    addEventListener: (art, f) => hoerer.push({ art, f }),
  };
  const kontext = vm.createContext({ document: dokument, MutationObserver, window: fenster });
  for (const code of skriptbloecke(LISTE).filter((s) => s.includes("data-kopf"))) vm.runInContext(code, kontext);
  const senden = (daten) => hoerer.find((h) => h.art === "message").f({ data: daten });
  const meldung = (aufrufe) => senden({ method: ERGEBNIS, params: { structuredContent: { calls: aufrufe } } });
  const zeilenNeu = (zeilen) => {
    liste.kinder = zeilen;
    beobachter.find((b) => b.ziel === liste).rueckruf();
  };
  const spracheNeu = () => beobachter.find((b) => b.ziel === dokument.documentElement).rueckruf();
  return { liste, vor, zahl, nach, beobachter, dokument, senden, meldung, zeilenNeu, spracheNeu };
}

test("widget-anrufliste K3: Richtungskreis 36 px, eingehend Umriss, ausgehend gefüllt, nicht erreicht gestrichelt", () => {
  const css = stil(LISTE);
  assert.match(regel(css, ".kreis"), /width:36px;height:36px;margin-top:3px;border-radius:50%/);
  assert.match(regel(css, ".kreis.ein"), /border:1pxsolidvar\(--fg\);color:var\(--fg\)/);
  assert.match(regel(css, ".kreis.aus"), /background:var\(--fg\);color:var\(--bg\)/);
  assert.match(regel(css, ".kreis::before"), /width:14px;height:14px;background:currentColor/);
  assert.match(regel(css, ".kreis.ein"), /--pfeil:url\("data:image\/svg\+xml,[^"]*viewBox='001414'[^"]*stroke-width='1\.5'[^"]*d='M44l66M105v5H5'/);
  assert.match(regel(css, ".kreis.aus"), /--pfeil:url\("data:image\/svg\+xml,[^"]*stroke-width='1\.5'[^"]*d='M410L104M54h5v5'/);
  assert.match(regel(css, ".kreis.verpasst"), /border:1pxdashedvar\(--line2\);color:var\(--fg2\)/);
  assert.match(regel(css, ".liste .row"), /grid-template-columns:36pxminmax\(0,1fr\)auto;/);
  assert.match(regel(css, ".liste .row"), /column-gap:14px;align-items:start;padding:14px0/);
  assert.match(regel(css, ".liste .cell[data-field=\"counterparty\"]"), /font-size:16px;line-height:22px;font-weight:500/);
  assert.match(regel(css, ".liste .cell[data-field=\"summary\"]"), /font-size:14px;line-height:20px;color:var\(--fg2\)/);
  assert.match(regel(css, ".liste .cell[data-field=\"startedAt\"]"), /font-size:13px;line-height:22px;color:var\(--fg2\);font-variant-numeric:tabular-nums/);
  assert.match(regel(css, ".liste .row+.row"), /border-top:1pxsolidvar\(--hair\)/);
  assert.match(LISTE, /<div class="sheet liste" data-mcp="calls" data-mcp-row="direction,counterparty,status,startedAt,summary"><\/div>/);
});

test("widget-anrufliste K3: je Zeile ein Kreis vor dem Namen, Pfeilrichtung nach Richtung, Klasse nach Richtung und Ergebnis", () => {
  const s = seite();
  const zeilen = [
    zeile({ richtung: "outbound", status: FEHLER, name: "+4930111" }),
    zeile({ richtung: "outbound", status: FERTIG, name: "+4930222" }),
    zeile({ richtung: "inbound", status: FERTIG, name: "+4930333" }),
    zeile({ richtung: "inbound", status: ABBRUCH, name: "+4930444" }),
  ];
  s.zeilenNeu(zeilen);
  const kreise = zeilen.map((z) => z.kinder[0]);
  assert.deepEqual(kreise.map((k) => k.className), ["kreis aus verpasst", "kreis aus", "kreis ein", "kreis ein verpasst"]);
  assert.deepEqual(kreise.map((k) => k.attribute["aria-label"]), [
    "Outbound, Failed",
    "Outbound, Completed",
    "Inbound, Completed",
    "Inbound, Cancelled",
  ]);
  assert.equal(kreise[0].attribute.role, "img");
  assert.equal(zeilen[0].kinder.length, 6);
});

test("widget-anrufliste K3: die Zeilen blenden mit 90 ms Versatz ein, ein zweiter Durchlauf legt keinen zweiten Kreis an", () => {
  const s = seite();
  const zeilen = [0, 1, 2].map((i) => zeile({ richtung: "outbound", status: FERTIG, name: "N" + i }));
  s.zeilenNeu(zeilen);
  assert.deepEqual(zeilen.map((z) => z.style.animationDelay), ["0ms", "90ms", "180ms"]);
  assert.ok(zeilen.every((z) => z.klassen.has("rise")));
  s.zeilenNeu(zeilen);
  assert.ok(zeilen.every((z) => z.kinder.length === 6));
  assert.match(regel(stil(LISTE), ".sheet"), /backdrop-filter:blur\(26px\)saturate\(1\.5\)/);
});

test("widget-anrufliste K3: die Überschrift nennt die Anzahl, einzeln und mehrfach, nur über textContent", () => {
  const s = seite();
  s.meldung([{}, {}, {}]);
  assert.deepEqual([s.vor.text, s.zahl.text, s.nach.text], ["Hermes handled", "3 calls", "recently."]);
  assert.equal(s.vor.attribute["data-i18n"], "Hermes handled");
  assert.equal(s.nach.attribute["data-i18n"], "recently.");
  s.meldung([{}]);
  assert.equal(s.zahl.text, "1 call");
  assert.match(LISTE, /<h1 class="rise"><span data-kopf="vor" data-i18n="Recent calls">Recent calls<\/span> <em data-kopf="zahl"><\/em> <span data-kopf="nach"><\/span><\/h1>/);
  assert.ok(!LISTE.includes("innerHTML"));
});

test("widget-anrufliste K7: Überschrift und Fallbacks stehen in en, de und fr, auch nach einem Sprachwechsel", () => {
  const de = seite("de");
  de.meldung([{}, {}]);
  assert.deepEqual([de.vor.text, de.zahl.text, de.nach.text], ["Hermes hat zuletzt", "2 Anrufe", "geführt."]);
  de.meldung([{}]);
  assert.equal(de.zahl.text, "1 Anruf");
  de.meldung([]);
  assert.deepEqual([de.vor.text, de.zahl.text, de.nach.text], ["Hermes hat", "noch keine Anrufe", "geführt."]);
  const fr = seite("fr");
  fr.meldung([{}, {}]);
  assert.deepEqual([fr.vor.text, fr.zahl.text, fr.nach.text], ["Hermes a traité", "2 appels", "récemment."]);
  fr.meldung([{}]);
  assert.equal(fr.zahl.text, "1 appel");
  fr.meldung([]);
  assert.deepEqual([fr.vor.text, fr.zahl.text, fr.nach.text], ["Hermes n'a traité", "aucun appel", "pour l'instant."]);
  const en = seite("en");
  en.meldung([]);
  assert.deepEqual([en.vor.text, en.zahl.text, en.nach.text], ["Hermes has handled", "no calls", "yet."]);
  for (const text of ["Unbekannte Nummer", "Numéro inconnu"]) assert.ok(LISTE.includes(text), text);
  const wechsel = seite("en");
  wechsel.meldung([{}, {}]);
  wechsel.spracheNeu();
  assert.equal(wechsel.zahl.text, "2 calls");
});

test("widget-anrufliste K9: vor dem ersten Ergebnis bleibt die ruhige Überschrift, eine leere Liste verschwindet, ein fehlender Name wird ersetzt", () => {
  const s = seite();
  s.spracheNeu();
  assert.deepEqual([s.vor.text, s.zahl.text, s.nach.text], ["Recent calls", "", ""]);
  assert.match(regel(stil(LISTE), ".liste:empty"), /display:none/);
  assert.match(regel(stil(LISTE), '.liste .cell[data-field="summary"]:empty'), /display:none/);
  const ohneName = zeile({ richtung: "inbound", status: FERTIG, name: "" });
  const mitName = zeile({ richtung: "inbound", status: FERTIG, name: "+4930555" });
  s.zeilenNeu([ohneName, mitName]);
  assert.equal(ohneName.querySelector('[data-field="counterparty"]').text, "Unknown number");
  assert.equal(mitName.querySelector('[data-field="counterparty"]').text, "+4930555");
  const de = seite("de");
  const z = zeile({ richtung: "inbound", status: FERTIG, name: "" });
  de.zeilenNeu([z]);
  assert.equal(z.querySelector('[data-field="counterparty"]').text, "Unbekannte Nummer");
  assert.doesNotMatch(LISTE.slice(LISTE.indexOf("<body>"), LISTE.indexOf("<script")), /undefined|null/);
});

test("widget-anrufliste K3: beobachtet werden nur die Zeilen der Liste und das Sprachattribut der Seite", () => {
  const s = seite();
  assert.deepEqual(s.beobachter.map((b) => b.ziel), [s.liste, s.dokument.documentElement]);
  assert.deepEqual(s.beobachter.map((b) => JSON.stringify(b.optionen)), [
    '{"childList":true}',
    '{"attributes":true,"attributeFilter":["lang"]}',
  ]);
});

test("widget-anrufliste K9: die Überschrift ändert sich nur durch ein Ergebnis mit einer Anrufliste", () => {
  const s = seite();
  s.senden({ method: "andere/methode", params: { structuredContent: { calls: [{}] } } });
  s.senden({ method: ERGEBNIS, params: { structuredContent: { number: "+49" } } });
  s.senden({ method: ERGEBNIS, params: { structuredContent: { calls: "keine Liste" } } });
  s.senden({ method: ERGEBNIS, params: {} });
  s.senden(null);
  assert.deepEqual([s.vor.text, s.zahl.text, s.nach.text], ["Recent calls", "", ""]);
});

test("widget-anrufliste K6: Lichtszene, beide Themen, Drift 17/23/29 s und Ruhe bei reduzierter Bewegung", () => {
  const css = stil(LISTE);
  assert.match(css, /--bg:#15130f;--fg:#f2ece3;--fg2:#b9af9f;--line2:#746b5e;--accent:#c8a673;/);
  assert.match(css, /--bg:#e8e0d4;--fg:#1e1b17;--fg2:#4a433b;--line2:#8c8273;--accent:#76592f;/);
  assert.match(regel(css, ".ga"), /animation:driftA17sease-in-outinfinitealternate/);
  assert.match(regel(css, ".gb"), /animation:driftB23sease-in-outinfinitealternate/);
  assert.match(regel(css, ".gc"), /animation:driftA29sease-in-outinfinitealternate-reverse/);
  assert.match(regel(css, ".rise"), /animation:rise\.7scubic-bezier\(\.22,1,\.36,1\)both/);
  assert.match(css.replace(/\s+/g, ""), /@media\(prefers-reduced-motion:reduce\)\{\.rise,\.glow\{animation:none!important\}/);
  assert.equal((LISTE.match(/<span class="glow g[abc]"/g) || []).length, 3);
  assert.match(LISTE, /<div class="w klein">/);
  assert.match(LISTE, /<b>Hermes<\/b>/);
  assert.match(LISTE, /class="wing-canvas-mount" data-wing-canvas/);
  assert.equal(skriptbloecke(LISTE).filter((s) => s.includes("[data-wing-canvas]")).length, 1);
});

function fluegelGroesse(dataset) {
  const montiert = [];
  const host = { dataset };
  const bild = { src: "data:wing" };
  const sandbox = {
    document: { querySelector: (sel) => ({ "[data-wing-canvas]": host, ".wing img": bild, ".wing": { style: {} } })[sel] ?? null },
  };
  sandbox.window = { ...sandbox, HermesWingCanvas: { mount: (h, optionen) => montiert.push(optionen.size) } };
  const kontext = vm.createContext({ ...sandbox, window: sandbox.window });
  const block = skriptbloecke(LISTE).find((b) => b.includes("[data-wing-canvas]"));
  vm.runInContext(block, kontext);
  return montiert;
}

test("widget-anrufliste K6: das Montageskript wing-canvas-mount-idle setzt den Flügel in der Kopfzeile auf 48 px, ohne Angabe 86 px", () => {
  assert.match(LISTE, /<span class="wing-canvas-mount" data-wing-canvas data-wing-size="48">/);
  assert.deepEqual(fluegelGroesse({ wingSize: "48" }), [48]);
  assert.deepEqual(fluegelGroesse({}), [86]);
  assert.deepEqual(fluegelGroesse({ wingSize: "abc" }), [86]);
});

test("widget-anrufliste K8: calls hat eine neue Version, die alten Pins bleiben", () => {
  const pins = widgetPins();
  assert.equal(Object.keys(pins.calls).length, NEUE_VERSION);
  assert.match(pins.calls[NEUE_VERSION], /^[0-9a-f]{64}$/);
  assert.equal(pins.calls["22"], "c38b78f4100667d2b7374a185b599c6ec845aa444bb4ff1897c7d9d6a15cefef");
});

test("widget-anrufliste #4204: die Karte trägt keine Pillen-Marke, nur die Kartenwurzel .w", () => {
  assert.ok(!LISTE.includes("data-status-pill"));
  assert.ok(LISTE.includes('class="w klein"'));
});
