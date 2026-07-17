// P6/S2-20 (G5): EINE Quelle fuer den localhost-Gateway-Fallback. gatewayUrlForPort()
// baut das Template, resolveGatewayUrl() liest GATEWAY_URL zur Aufrufzeit oder faellt
// auf den config-Port zurueck (statt eines hartkodierten :3000-Literals). Rein-Unit,
// kein Spawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { config, gatewayUrlForPort, resolveGatewayUrl } from "../src/config.js";

test("gatewayUrlForPort baut die localhost-Fallback-URL", () => {
  assert.equal(gatewayUrlForPort(3000), "http://localhost:3000");
  assert.equal(gatewayUrlForPort(0), "http://localhost:0");
});

test("resolveGatewayUrl: ohne GATEWAY_URL -> Fallback auf den config-Port", () => {
  const prev = process.env.GATEWAY_URL;
  try {
    delete process.env.GATEWAY_URL;
    assert.equal(resolveGatewayUrl(), gatewayUrlForPort(config.port));
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
  }
});

test("resolveGatewayUrl: mit GATEWAY_URL -> genau dieser Wert, Trailing-Slash gestrippt", () => {
  const prev = process.env.GATEWAY_URL;
  try {
    process.env.GATEWAY_URL = "https://hermes.example.test/";
    assert.equal(resolveGatewayUrl(), "https://hermes.example.test");
    process.env.GATEWAY_URL = "https://hermes.example.test";
    assert.equal(resolveGatewayUrl(), "https://hermes.example.test");
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
  }
});
