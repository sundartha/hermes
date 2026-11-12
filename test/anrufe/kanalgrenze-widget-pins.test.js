import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { registerTools } from "../../src/mcp-tools.js";
import { widgetPins } from "../../src/ui/registry.js";

const AUSGELASTET = "at-capacity";
const AUSGELASTET_BESCHRIFTUNG = "At capacity";
const ALLE_WIDGETS = ["agent-status", "my-number", "calls", "call"];
const NAECHSTE_VERSION = { "agent-status": "21", "my-number": "22", calls: "21", call: "32" };
const LETZTER_BESTEHENDER_PIN = {
  "agent-status": ["20", "805500c37950542d5a61d79c6e50e6937998f1e31cb37df9d051b1218054c72b"],
  "my-number": ["21", "d65c61b63d009b8c7727dbd1cf2512fee37a9c7d9e76ae2dc007e84020cc1d09"],
  calls: ["20", "c06fd71ae8e905f4ba9b5606d4fd21be017019ef64263a3dc086a2594f9ff078"],
  call: ["31", "3483bbdf6806ed7d9d3f3dfddfa27d9c3a33f4fecf0cac38d76b2d8e6f0be308"],
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
