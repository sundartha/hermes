import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import { widgetPins } from "../../src/ui/registry.js";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const WIDGETS = await ausgelieferteWidgets();
const STATUS = WIDGETS["agent-status"];
const NEUE_VERSION = 22;

function stil(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
}

function regel(css, selektor) {
  const start = css.indexOf(selektor + "{");
  assert.notEqual(start, -1, "Regel " + selektor + " fehlt");
  return css.slice(start + selektor.length + 1, css.indexOf("}", start)).replace(/\s+/g, "");
}

function knoten(tag) {
  return {
    tag,
    text: "",
    beobachter: [],
    klassen: new Set(),
    eigenschaften: {},
    style: {
      setProperty(name, wert) {
        this.gesetzt[name] = wert;
      },
      gesetzt: {},
    },
    classList: {
      toggle(name, an) {
        if (an) this.menge.add(name);
        else this.menge.delete(name);
      },
      menge: null,
    },
    get textContent() {
      return this.text;
    },
    set textContent(wert) {
      this.text = wert;
      this.beobachter.forEach((b) => b());
    },
  };
}

function seiteMitStatus() {
  const quelle = knoten("span");
  quelle.text = "—";
  const nutzung = knoten("div");
  nutzung.classList.menge = new Set();
  const balken = knoten("div");
  balken.classList.menge = new Set();
  const document = {
    querySelector(sel) {
      if (sel === '[data-mcp="planUsagePercent"]') return quelle;
      if (sel === ".nutzung") return nutzung;
      if (sel === ".balken") return balken;
      return null;
    },
  };
  class MutationObserver {
    constructor(rueckruf) {
      this.rueckruf = rueckruf;
    }
    observe(ziel) {
      ziel.beobachter.push(this.rueckruf);
    }
  }
  const kontext = vm.createContext({ document, MutationObserver, window: {} });
  for (const code of skriptbloecke(STATUS).filter((s) => s.includes("planUsagePercent"))) vm.runInContext(code, kontext);
  return { quelle, nutzung, balken };
}

function nach(wert) {
  const seite = seiteMitStatus();
  seite.quelle.textContent = wert;
  const { gesetzt } = seite.balken.style;
  const { menge } = seite.nutzung.classList;
  return { wert: gesetzt["--wert"], bereit: menge.has("bereit") };
}

test("widget-status-entwurf K2: die Monatsnutzung steht als 40-px-Zahl über einer Linie mit Füllung in Akzent und mitlaufendem Kreis", () => {
  const css = stil(STATUS);
  const zahl = regel(css, ".nutzung .zahl b");
  assert.match(zahl, /font-size:40px;line-height:44px;font-weight:500/);
  assert.match(zahl, /font-variant-numeric:tabular-nums/);
  assert.match(regel(css, ".balken .fill"), /background:var\(--accent\)/);
  assert.match(css.replace(/\s+/g, ""), /\.bereit\.fill\{[^}]*animation:grow1\.2scubic-bezier\(\.22,1,\.36,1\)\.2sboth/);
  assert.match(css.replace(/\s+/g, ""), /\.bereit\.knob\{[^}]*animation:slide1\.2scubic-bezier\(\.22,1,\.36,1\)\.2sboth/);
  assert.match(regel(css, ".balken .knob"), /width:9px;height:9px;margin-left:-4px;border-radius:50%/);
  assert.match(regel(css, "@keyframes grow"), /scaleX\(0\)/);
  assert.match(STATUS, /<div class="balken" aria-hidden="true"><span class="linie"><\/span><span class="fill"><\/span><span class="knob"><\/span><\/div>/);
});

test("widget-status-entwurf K2: Füllung und Kreis stehen beim Wert, auf 100 % begrenzt, erst dann läuft die Animation", () => {
  assert.deepEqual(nach("38"), { wert: "38%", bereit: true });
  assert.deepEqual(nach("0"), { wert: "0%", bereit: true });
  assert.deepEqual(nach("100"), { wert: "100%", bereit: true });
  assert.deepEqual(nach("137"), { wert: "100%", bereit: true });
  assert.deepEqual(nach("37.5"), { wert: "37.5%", bereit: true });
  assert.ok(!STATUS.includes("innerHTML"));
});

test("widget-status-entwurf K2: darunter stehen Inhaber, Nummer, Anrufe, Berechtigungen in dieser Reihenfolge auf Glas", () => {
  const felder = [...STATUS.matchAll(/<dd data-mcp="(\w+)">/g)].map((m) => m[1]);
  assert.deepEqual(felder, ["owner", "number", "calls", "permissions"]);
  assert.match(STATUS, /<dl class="sheet angaben">/);
  assert.match(regel(stil(STATUS), ".angaben"), /--spalte:132px/);
  assert.match(STATUS, /<div class="zeile rise d1"><dt data-i18n="Owner">Owner<\/dt>/);
  assert.match(regel(stil(STATUS), ".sheet"), /border-radius:24px.*backdrop-filter:blur\(26px\)saturate\(1\.5\)/);
});

test("widget-status-entwurf K6: Lichtszene, beide Themen, Drift 17/23/29 s und Ruhe bei reduzierter Bewegung", () => {
  const css = stil(STATUS);
  assert.match(css, /--bg:#15130f;--fg:#f2ece3;--fg2:#b9af9f;--line2:#746b5e;--accent:#c8a673;/);
  assert.match(css, /--bg:#e8e0d4;--fg:#1e1b17;--fg2:#4a433b;--line2:#8c8273;--accent:#76592f;/);
  assert.match(regel(css, ".ga"), /animation:driftA17sease-in-outinfinitealternate/);
  assert.match(regel(css, ".gb"), /animation:driftB23sease-in-outinfinitealternate/);
  assert.match(regel(css, ".gc"), /animation:driftA29sease-in-outinfinitealternate-reverse/);
  assert.equal((STATUS.match(/<span class="glow g[abc]"/g) || []).length, 3);
  assert.match(STATUS, /<div class="w klein">/);
  assert.match(css.replace(/\s+/g, ""), /@media\(prefers-reduced-motion:reduce\)\{\.bereit\.fill,\.bereit\.knob\{animation:none!important\}\}/);
  assert.match(STATUS, /<b>Hermes<\/b>/);
  assert.match(STATUS, /class="wing-canvas-mount" data-wing-canvas/);
});

test("widget-status-entwurf K7: Überschrift und Satz zur Nutzung stehen in en, de und fr im Wörterbuch", () => {
  assert.match(STATUS, /<h1 class="rise"><span data-i18n="Hermes is">Hermes is<\/span> <em data-i18n="ready\.">ready\.<\/em><\/h1>/);
  assert.match(STATUS, /<span class="satz" data-i18n="of your monthly allowance is used\.">of your monthly allowance is used\.<\/span>/);
  for (const text of ["Hermes ist", "bereit.", "deines Monatskontingents sind verbraucht.", "Inhaber"]) {
    assert.ok(STATUS.includes(text), "de: " + text);
  }
  for (const text of ["Hermes est", "prêt.", "de votre quota mensuel sont utilisés.", "Titulaire"]) {
    assert.ok(STATUS.includes(text), "fr: " + text);
  }
});

test("widget-status-entwurf K8: agent-status hat eine neue Version, die alten Pins bleiben", () => {
  const pins = widgetPins();
  assert.equal(Object.keys(pins.calls).length, 22);
  assert.equal(Object.keys(pins.call).length, 33);
  assert.equal(Object.keys(pins["agent-status"]).length, NEUE_VERSION);
  assert.match(pins["agent-status"][NEUE_VERSION], /^[0-9a-f]{64}$/);
  assert.equal(
    pins["agent-status"]["20"],
    "805500c37950542d5a61d79c6e50e6937998f1e31cb37df9d051b1218054c72b",
  );
});

test("widget-status-entwurf K9: ohne Nutzungswert steht ein ruhiger Strich, ohne Satz und ohne laufende Linie", () => {
  assert.deepEqual(nach("—"), { wert: "0%", bereit: false });
  assert.deepEqual(nach(""), { wert: "0%", bereit: false });
  assert.deepEqual(nach("abc"), { wert: "0%", bereit: false });
  assert.match(regel(stil(STATUS), ".nutzung:not(.bereit) .satz,.nutzung:not(.bereit) .proz"), /display:none/);
  assert.match(STATUS, /<b><span data-mcp="planUsagePercent">—<\/span><span class="proz"> %<\/span><\/b>/);
  for (const feld of ["owner", "number", "calls", "permissions"]) {
    assert.match(STATUS, new RegExp('<dd data-mcp="' + feld + '">—</dd>'));
  }
  assert.doesNotMatch(STATUS.slice(STATUS.indexOf("<body>"), STATUS.indexOf("<script")), /undefined|null/);
});

test("widget-status-entwurf #4204: die Karte trägt keine Pillen-Marke, nur die Kartenwurzel .w", () => {
  assert.ok(!STATUS.includes("data-status-pill"));
  assert.ok(!WIDGETS["my-number"].includes("data-status-pill"));
});
