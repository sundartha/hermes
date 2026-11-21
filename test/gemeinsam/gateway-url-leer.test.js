import assert from "node:assert/strict";
import { test } from "node:test";

const GATEWAY_URL_VARIABLE = "GATEWAY_URL";
const GEBUNDENER_PORT = 4321;

async function mitGatewayUrl(wert, laden, pruefung) {
  const gemerkt = process.env[GATEWAY_URL_VARIABLE];
  try {
    if (wert === undefined) delete process.env[GATEWAY_URL_VARIABLE];
    else process.env[GATEWAY_URL_VARIABLE] = wert;
    await pruefung(await laden());
  } finally {
    if (gemerkt === undefined) delete process.env[GATEWAY_URL_VARIABLE];
    else process.env[GATEWAY_URL_VARIABLE] = gemerkt;
  }
}

const faelle = [
  { laden: () => import("../../src/config.ts?gwleer-0"), name: "leer ohne gebundenen Port", wert: "", gebunden: false, erwartet: (c) => `http://localhost:${c.config.server.port}` },
  { laden: () => import("../../src/config.ts?gwleer-1"), name: "leer mit gebundenem Port", wert: "", gebunden: true, erwartet: () => "http://localhost:4321" },
  { laden: () => import("../../src/config.ts?gwleer-2"), name: "fehlend mit gebundenem Port", wert: undefined, gebunden: true, erwartet: () => "http://localhost:4321" },
  { laden: () => import("../../src/config.ts?gwleer-3"), name: "gesetzt mit gebundenem Port", wert: "https://gw.example.test/", gebunden: true, erwartet: () => "https://gw.example.test" },
  { laden: () => import("../../src/config.ts?gwleer-4"), name: "gesetzt ohne gebundenen Port", wert: "https://gw.example.test/", gebunden: false, erwartet: () => "https://gw.example.test" },
];

for (const fall of faelle) {
  test(`Gateway-URL ${fall.name}`, async () => {
    await mitGatewayUrl(fall.wert, fall.laden, (frisch) => {
      if (fall.gebunden) frisch.setBoundGatewayPort(GEBUNDENER_PORT);
      assert.equal(frisch.resolveGatewayUrl(), fall.erwartet(frisch));
    });
  });
}
