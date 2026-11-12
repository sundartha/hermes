import { test } from "node:test";
import assert from "node:assert/strict";
import { registerTools } from "../../src/mcp-tools.js";

const ALLE_WIDGETS = ["agent-status", "my-number", "calls", "call"];
const BESCHRIFTUNG = "At capacity";
const AUSGELASTET_BESCHRIFTUNG_DE = "Ausgelastet";
const AUSGELASTET_BESCHRIFTUNG_FR = "Saturé";

async function ausgelieferteWidgets() {
  const erfasst = [];
  const server = {
    registerTool() {},
    registerResource(...argumente) {
      const [name, , , lesen] = argumente;
      erfasst.push({ name, lesen });
    },
  };
  registerTools(server, { uiHost: { enabled: true }, language: "en" });
  const widgets = {};
  for (const { name, lesen } of erfasst) widgets[name] = (await lesen()).contents[0].text;
  return widgets;
}

function woerterbuchIm(html) {
  const treffer = /var WIDGET_DICT = (.*);$/m.exec(html);
  assert.ok(treffer, "WIDGET_DICT fehlt im ausgelieferten Widget");
  return JSON.parse(treffer[1]);
}

test("[NIE3] in allen vier Widgets hat At capacity einen Eintrag in de und fr", async () => {
  const widgets = await ausgelieferteWidgets();
  for (const id of ALLE_WIDGETS) {
    const woerterbuch = woerterbuchIm(widgets[id]);
    assert.equal(woerterbuch.de[BESCHRIFTUNG], AUSGELASTET_BESCHRIFTUNG_DE, `${id}: de`);
    assert.equal(woerterbuch.fr[BESCHRIFTUNG], AUSGELASTET_BESCHRIFTUNG_FR, `${id}: fr`);
  }
});
