import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import { widgetPins } from "../../src/ui/registry.js";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const WIDGETS = await ausgelieferteWidgets();
const NUMMER = WIDGETS["my-number"];
const SATZ = "At this number, Hermes takes calls for you and places calls on your behalf.";
const KURVE = "cubic-bezier(.22,1,.36,1)";
const LETZTE_VERSION_VORHER = { "agent-status": 20, "my-number": 21, calls: 20, call: 31 };

function erstesKind(h) {
  return h.kinder[0];
}

function textVon(k) {
  return k.textContent;
}

function verzoegerungVon(k) {
  return k.style.animationDelay;
}

function stil(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
}

function regel(css, selektor) {
  const start = css.indexOf(selektor + "{");
  assert.notEqual(start, -1, "Regel " + selektor + " fehlt");
  return css.slice(start + selektor.length + 1, css.indexOf("}", start)).replace(/\s+/g, "");
}

function knoten(tag) {
  const el = {
    tag,
    kinder: [],
    attribute: {},
    style: {},
    text: "",
    beobachter: [],
    get firstChild() {
      return this.kinder[0] ?? null;
    },
    get textContent() {
      return this.kinder.length ? this.kinder.map((k) => k.textContent).join("") : this.text;
    },
    set textContent(wert) {
      this.text = wert;
      this.kinder = [];
      this.beobachter.forEach((b) => b());
    },
    setAttribute(name, wert) {
      this.attribute[name] = wert;
    },
    appendChild(kind) {
      this.kinder.push(kind);
      return kind;
    },
    removeChild(kind) {
      this.kinder = this.kinder.filter((k) => k !== kind);
    },
  };
  return el;
}

function seiteMitNummer() {
  const quelle = knoten("span");
  quelle.text = "—";
  const ziel = knoten("p");
  const montiert = [];
  const wingBild = { src: "data:wing" };
  const wing = knoten("span");
  const host = knoten("span");
  const document = {
    querySelector(sel) {
      if (sel === '[data-mcp="number"]') return quelle;
      if (sel === ".nummer") return ziel;
      if (sel === "[data-wing-canvas]") return host;
      if (sel === ".wing img") return wingBild;
      if (sel === ".wing") return wing;
      return null;
    },
    createElement: knoten,
  };
  class MutationObserver {
    constructor(rueckruf) {
      this.rueckruf = rueckruf;
    }
    observe(ziel2) {
      ziel2.beobachter.push(this.rueckruf);
    }
  }
  const fenster = { HermesWingCanvas: { mount: (h, opt) => montiert.push({ h, opt }) } };
  const kontext = vm.createContext({ document, MutationObserver, window: fenster });
  for (const code of skriptbloecke(NUMMER).filter((s) => s.includes("gruppen"))) vm.runInContext(code, kontext);
  for (const code of skriptbloecke(NUMMER).filter((s) => s.includes("HermesWingCanvas") && !s.includes("gruppen"))) {
    vm.runInContext(code, kontext);
  }
  return { quelle, ziel, montiert, wing, host };
}

function gruppenNach(wert) {
  const seite = seiteMitNummer();
  seite.quelle.textContent = wert;
  const ziffern = seite.ziel.kinder.map(erstesKind);
  return {
    gruppen: ziffern.map(textVon),
    verzoegerung: ziffern.map(verzoegerungVon),
    label: seite.ziel.attribute["aria-label"],
  };
}

test("widget-nummer-entwurf K1: Nummer in Instrument Serif 58/64, Vorwahl in fg2, Gruppen fahren 0,9 s hoch", () => {
  const css = stil(NUMMER);
  const nummer = regel(css, ".nummer");
  assert.match(nummer, /font-family:var\(--font-serif\)/);
  assert.match(nummer, /font-size:58px/);
  assert.match(nummer, /line-height:64px/);
  assert.equal(regel(css, ".nummer span:first-child"), "color:var(--fg2)");
  assert.match(regel(css, ".nummer i"), new RegExp("animation:lift\\.9s" + KURVE.replace(/[().]/g, "\\$&") + "both"));
  assert.match(regel(css, ".nummer span"), /overflow:hidden/);
  assert.match(regel(css, "@keyframes lift"), /translateY\(105%\)/);
});

test("widget-nummer-entwurf K1: Linie mit Endkreis zieht sich 1,1 s nach 0,25 s auf", () => {
  const css = stil(NUMMER);
  assert.match(regel(css, ".strich span"), /animation:draw1\.1scubic-bezier\(\.22,1,\.36,1\)\.25sboth/);
  assert.match(regel(css, ".strich i"), /width:9px;height:9px;border-radius:50%/);
  assert.match(NUMMER, /<div class="strich" aria-hidden="true"><span><\/span><i><\/i><\/div>/);
});

test("widget-nummer-entwurf K1: die Nummer wird in Gruppen gesetzt, je Gruppe 70 ms später, nur über textContent", () => {
  const mit = gruppenNach("+49 211 5550142");
  assert.deepEqual(mit.gruppen, ["+49", "211", "5550142"]);
  assert.deepEqual(mit.verzoegerung, ["0ms", "70ms", "140ms"]);
  assert.equal(mit.label, "+49 211 5550142");
  const ohne = gruppenNach("+492115550142");
  assert.deepEqual(ohne.gruppen, ["+49", "211", "555", "01", "42"]);
  assert.deepEqual(ohne.verzoegerung, ["0ms", "70ms", "140ms", "210ms", "280ms"]);
  assert.deepEqual(gruppenNach("+14155550100").gruppen, ["+1", "415", "555", "01", "00"]);
  assert.deepEqual(gruppenNach("+49211555123").gruppen, ["+49", "211", "555", "123"]);
  assert.ok(!NUMMER.includes("innerHTML"));
});

test("widget-nummer-entwurf K9: ohne Nummer steht ein ruhiger Strich statt undefined", () => {
  assert.deepEqual(gruppenNach("").gruppen, ["—"]);
  assert.deepEqual(gruppenNach("   ").gruppen, ["—"]);
  assert.deepEqual(gruppenNach("abc").gruppen, ["abc"]);
  assert.match(NUMMER, /<p class="nummer" aria-label="—"><span aria-hidden="true"><i>—<\/i><\/span><\/p>/);
});

test("widget-nummer-entwurf K1: der Flügel sitzt 48 px groß ruhig neben dem Schriftzug", () => {
  const seite = seiteMitNummer();
  assert.equal(seite.montiert.length, 1);
  const flügel = seite.montiert[0].opt;
  assert.equal(flügel.size, 48);
  assert.equal(flügel.status, "idle");
  assert.equal(seite.wing.style.display, "none");
  assert.match(regel(stil(NUMMER), ".klein .wing-wrap"), /--wing-size:48px;margin-left:-6px/);
  assert.match(NUMMER, /<b>HERMES<\/b>/);
});

test("widget-nummer-entwurf K6: Standardkurve, Drift 17/23/29 s, Karte 36 px, Glas und beide Themen", () => {
  const css = stil(NUMMER);
  assert.match(regel(css, ".rise"), /animation:rise\.7scubic-bezier\(\.22,1,\.36,1\)both/);
  assert.match(regel(css, ".ga"), /animation:driftA17sease-in-outinfinitealternate/);
  assert.match(regel(css, ".gb"), /animation:driftB23sease-in-outinfinitealternate/);
  assert.match(regel(css, ".gc"), /animation:driftA29sease-in-outinfinitealternate-reverse/);
  assert.match(regel(css, ".glow"), /filter:blur\(48px\)/);
  assert.match(regel(css, ".sheet"), /border-radius:24px.*backdrop-filter:blur\(26px\)saturate\(1\.5\)/);
  assert.match(regel(css, ".lens"), /backdrop-filter:blur\(14px\)saturate\(1\.7\)/);
  assert.match(regel(css, ".w"), /^--bg:#15130f;--fg:#f2ece3;--fg2:#b9af9f;--line2:#746b5e;--accent:#c8a673;/);
  const stein = css.slice(css.indexOf("@media (prefers-color-scheme:light)"));
  assert.match(stein, /--bg:#e8e0d4;--fg:#1e1b17;--fg2:#4a433b;--line2:#8c8273;--accent:#76592f;/);
  assert.match(css, /\.w\{position:relative;[^}]*padding:24px 24px 12px;border-radius:36px/);
});

test("widget-nummer-entwurf K6: bei prefers-reduced-motion laufen keine Animationen", () => {
  const css = stil(NUMMER);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.rise,\.glow\{animation:none !important\}\.glow\{transition:none\}\}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.nummer i,\.strich span\{animation:none !important\}\}/);
});

test("widget-nummer-entwurf K7: der Satz auf Glas steht in en, de und fr im Wörterbuch", () => {
  assert.match(NUMMER, new RegExp('<p data-i18n="' + SATZ + '">' + SATZ + "</p>"));
  assert.ok(NUMMER.includes("Unter dieser Nummer nimmt Hermes Anrufe für dich an und ruft in deinem Auftrag an."));
  assert.ok(NUMMER.includes("À ce numéro, Hermes prend vos appels et appelle en votre nom."));
});

test("widget-nummer-entwurf K8: jedes der vier Widgets hat eine neue Version, die alten Pins bleiben", () => {
  const pins = widgetPins();
  for (const [id, alt] of Object.entries(LETZTE_VERSION_VORHER)) {
    assert.equal(Object.keys(pins[id]).length, alt + 1, id + ": genau eine neue Version");
    assert.match(pins[id][alt + 1], /^[0-9a-f]{64}$/);
  }
  assert.equal(
    pins["my-number"]["20"],
    "a591a0952b1613434da5f0600a2d70a541b1265900c033d5c3639891db2b7830",
  );
  assert.equal(
    pins["my-number"]["21"],
    "d65c61b63d009b8c7727dbd1cf2512fee37a9c7d9e76ae2dc007e84020cc1d09",
  );
});
