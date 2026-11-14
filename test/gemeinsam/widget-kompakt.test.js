import assert from "node:assert/strict";
import { test } from "node:test";

import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";

const WIDGETS = await ausgelieferteWidgets();
const ANRUF = WIDGETS.call;
const MARMOR = "#f2ece3";
const TINTE = "#15130f";

function stil(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
}

function regel(css, selektor) {
  const treffer = new RegExp("(?:^|[}\\n])\\s*" + selektor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{([^}]*)\\}").exec(css);
  assert.ok(treffer, "Regel " + selektor + " fehlt");
  return treffer[1].replace(/\s+/g, "");
}

function wurzelRegeln(css) {
  return [...css.matchAll(/(?:^|[}\s])\.w\{([^{}]*--bg:[^{}]*)\}/g)].map((m) => m[1].replace(/\s+/g, ""));
}

test("widget-kompakt: die Ergebniszeile ist höchstens 120 px hoch und scrollt, der volle Text bleibt im Dokument", () => {
  const css = stil(ANRUF);
  const werte = regel(css, '.zeile[data-row="summary"]');
  assert.match(werte, /(^|;)max-height:120px(;|$)/);
  assert.match(werte, /(^|;)overflow-y:auto(;|$)/);
  assert.match(werte, /(^|;)box-sizing:border-box(;|$)/);
  assert.match(ANRUF, /data-row="summary"[^>]*>\s*<span[^>]*>[^<]*<\/span><span data-mcp="result_summary">/);
});

test("widget-kompakt: andere Zeilen und kurze Texte bleiben unbegrenzt hoch", () => {
  const css = stil(ANRUF);
  const zeile = regel(css, ".zeile");
  assert.doesNotMatch(zeile, /max-height|overflow|(^|;)height:/);
  assert.doesNotMatch(regel(css, '.zeile[data-row="summary"]'), /(^|;)(min-)?height:/);
  assert.equal(css.match(/max-height:120px/g).length, 1);
});

for (const [id, html] of Object.entries(WIDGETS)) {
  test(`widget-kompakt: der Flügel von ${id} ist in beiden Themen marmorweiß`, () => {
    const css = stil(html);
    assert.doesNotMatch(css, /--wingf\s*:\s*invert/);
    const [nacht, stein] = wurzelRegeln(css);
    assert.match(nacht, /--wingf:none/);
    assert.doesNotMatch(stein, /--wingf:(?!none)/);
    assert.match(css, /\.w \.wing-wrap\{filter:var\(--wingf\)\}/);
  });
}

test("widget-kompakt: der Timer ist kleiner, leichter und die Pille 96 mal 44 px", () => {
  const css = stil(ANRUF);
  const pille = regel(css, ".pill");
  assert.match(pille, /(^|;)width:96px;height:44px;/);
  assert.match(pille, /(^|;)font-size:16px;font-weight:400;/);
  assert.match(pille, /clip-path:inset\(00052pxround22px\)/);
  assert.equal(regel(css, ".pill>*"), "transform:translateX(26px);transition:transform.7s" + "cubic-bezier(.22,1,.36,1)");
  assert.match(regel(css, ".pill::before"), /width:44px;height:44px;/);
  assert.equal(regel(css, ".ph-live .pill,.ph-done .pill"), "clip-path:inset(0round22px)");
});

test("widget-kompakt: die fertige Pille ist in beiden Themen marmorweiß mit dunkler Schrift", () => {
  const css = stil(ANRUF);
  assert.equal(regel(css, ".ph-done .pill"), `background:${MARMOR};color:${TINTE}`);
  assert.doesNotMatch(css, /\.ph-done \.pill\{[^}]*var\(--(fg|bg)\)/);
  assert.doesNotMatch(css, /@media[^{]*\{[^@]*\.ph-done \.pill\{/);
});
