import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { registerTools } from "../../src/mcp-tools.js";
import { widgetPins } from "../../src/ui/registry.js";

const AUSGELASTET = "at-capacity";
const AUSGELASTET_BESCHRIFTUNG = "At capacity";
const ALLE_WIDGETS = ["agent-status", "my-number", "calls", "call"];
const NAECHSTE_VERSION = { "agent-status": "30", "my-number": "31", calls: "31", call: "44" };
const LETZTER_BESTEHENDER_PIN = {
  "agent-status": ["29", "bfeb2353782a5a9bdd9ab576fb453708ebf4481f7cca950893a2719e5c2ec78e"],
  "my-number": ["30", "4c844cc13ac18b7d6414aca1a1a4f1f0a87bcd70cf06a437a4e3333f9b9c7ad4"],
  calls: ["30", "ce2136094304285fbd6ecb4db75a0df453d189941e18c7ad80ef7b0ac5e380b0"],
  call: ["43", "d7f89af74441ad859bed91cd81be461430994f6f638c6fa39f2c6cb48b7f3716"],
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
