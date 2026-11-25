import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { registerTools } from "../../src/mcp-tools.js";
import { widgetPins } from "../../src/ui/registry.js";

const AUSGELASTET = "at-capacity";
const AUSGELASTET_BESCHRIFTUNG = "At capacity";
const ALLE_WIDGETS = ["agent-status", "my-number", "calls", "call"];
const NAECHSTE_VERSION = { "agent-status": "35", "my-number": "36", calls: "36", call: "52" };
const LETZTER_BESTEHENDER_PIN = {
  "agent-status": ["34", "7860d2313ea0174800c4d6177944d298d13ca73af8fee3bf36e454f39f812f44"],
  "my-number": ["35", "670495b703b57258264f9591905b4ec50fdfed9f4a178742e5bb4cd1256901f6"],
  calls: ["35", "f753b174339d87880ebd831001657445440a5df72a2fae72bf3cc0593c578f4f"],
  call: ["51", "270ea9a5960edc6398b46dbd292442ff0cdf1d015934236c900dd46ca8c626af"],
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
