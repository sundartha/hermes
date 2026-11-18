import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { registerTools } from "../../src/mcp-tools.js";
import { widgetPins } from "../../src/ui/registry.js";

const AUSGELASTET = "at-capacity";
const AUSGELASTET_BESCHRIFTUNG = "At capacity";
const ALLE_WIDGETS = ["agent-status", "my-number", "calls", "call"];
const NAECHSTE_VERSION = { "agent-status": "31", "my-number": "32", calls: "32", call: "45" };
const LETZTER_BESTEHENDER_PIN = {
  "agent-status": ["30", "bc9e688cf5244cd325312689c72250e78023817808fce99d455734d1a222978c"],
  "my-number": ["31", "e8a50c1e2348e6a943d2a26b651f835c27a5218c344597eff93f77333fecca93"],
  calls: ["31", "c2d5b522611b2c37dd685098f277fbbffc79f525623df46af1e992fd96780798"],
  call: ["44", "56054baa2bc8cf69549d708f226f35e978c6e2abde3b8c63f2778a0cb74c22f9"],
};

async function ausgelieferteWidgets() {
  const erfasst = [];
  const server = {
    registerTool() {},
    registerResource(...argumente) {
      const [name, uri, , lesen] = argumente;
      erfasst.push({ name, uri, lesen });
    },
  };
  registerTools(server, { uiHost: { enabled: true }, language: "en" });
  const widgets = {};
  for (const { name, uri, lesen } of erfasst) widgets[name] = { uri, html: (await lesen()).contents[0].text };
  return widgets;
}

function beschriftungenDerKarte(html) {
  const treffer = /var FAILURE_REASON_LABELS = (\{[\s\S]*?\n\s*\});/.exec(html);
  assert.ok(treffer, "FAILURE_REASON_LABELS fehlt in der ausgelieferten Karte call");
  return new Function(`return ${treffer[1]};`)();
}

const sha256Von = (html) => crypto.createHash("sha256").update(html, "utf8").digest("hex");

test("[NIE3] die Karte call hat fuer at-capacity die Beschriftung At capacity", async () => {
  const widgets = await ausgelieferteWidgets();
  assert.equal(beschriftungenDerKarte(widgets.call.html)[AUSGELASTET], AUSGELASTET_BESCHRIFTUNG);
});

test("[NIE3] jede Karte hat die naechste freie Version mit dem Pin des ausgelieferten HTML, bestehende Pins bleiben", async () => {
  const widgets = await ausgelieferteWidgets();
  const pins = widgetPins();
  for (const id of ALLE_WIDGETS) {
    const [alteVersion, alterPin] = LETZTER_BESTEHENDER_PIN[id];
    assert.equal(pins[id][alteVersion], alterPin, `${id} v${alteVersion} wurde ueberschrieben`);
    assert.equal(pins[id][NAECHSTE_VERSION[id]], sha256Von(widgets[id].html), `${id} v${NAECHSTE_VERSION[id]}`);
    assert.equal(Object.keys(pins[id]).length, Number(NAECHSTE_VERSION[id]), `${id}: genau eine neue Version`);
    assert.equal(widgets[id].uri, `ui://hermes/${id}/v${NAECHSTE_VERSION[id]}.html`);
  }
});
