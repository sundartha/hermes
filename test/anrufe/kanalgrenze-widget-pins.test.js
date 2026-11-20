import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { registerTools } from "../../src/mcp-tools.js";
import { widgetPins } from "../../src/ui/registry.js";

const AUSGELASTET = "at-capacity";
const AUSGELASTET_BESCHRIFTUNG = "At capacity";
const ALLE_WIDGETS = ["agent-status", "my-number", "calls", "call"];
const NAECHSTE_VERSION = { "agent-status": "34", "my-number": "35", calls: "35", call: "51" };
const LETZTER_BESTEHENDER_PIN = {
  "agent-status": ["33", "77b2e68cf9294f1a737210407bec3a23e7490c30159b4233b663148a6c2ee16c"],
  "my-number": ["34", "eca477d8c0995ee2ef25162094f857ee301c3bc8dba68cf117e343de61d64d62"],
  calls: ["34", "8b0951547590aa70e03f4eafa3424b8193db56a0807d4fb199f509ef413ac432"],
  call: ["50", "af09feebd480b0d3f4cfb171a625ae3ae3a1055145ac54a1aaf8c3dd03c18d5c"],
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
