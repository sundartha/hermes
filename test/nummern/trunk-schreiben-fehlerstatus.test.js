import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import { elevenlabsNummern } from "../../src/elevenlabs/nummern-port.ts";

const NUMMER = { id: "n_fehlerstatus", e164: "+12025550101", providerAgentPhoneNumberId: "phnum_fehlerstatus" };
const CONFIG = {
  provisioning: { provisioningEnabled: true },
  voice: {
    elevenLabsOutbound: { apiKey: "xi_fehlerstatus_key", apiBase: "https://el.invalid", agentId: "agent_fehlerstatus" },
    elevenLabsInbound: {
      enabled: true,
      sipUser: "fehlerstatus-benutzer",
      sipPassword: "fehlerstatus-passwort-".padEnd(40, "x"),
      initWebhookToken: "t".repeat(40),
    },
  },
};

function mitProviderStatus(status) {
  return Object.assign(new Error("Provider"), { providerStatus: status });
}

const FAELLE = [
  ["Fehler mit Zahl-providerStatus 500", mitProviderStatus(500), "500"],
  ["Fehler mit Zahl-providerStatus 429", mitProviderStatus(429), "429"],
  ["Fehler ohne providerStatus", new Error("Netz"), "unbekannt"],
  ["Fehler null", null, "unbekannt"],
  ["Fehler undefined", undefined, "unbekannt"],
  ["Fehler als String", "kaputt", "unbekannt"],
];

afterEach(() => mock.restoreAll());

for (const [name, geworfen, erwartet] of FAELLE) {
  test(`trunk-schreiben-fehlerstatus: ${name} loggt status=${erwartet}`, async () => {
    const zeilen = [];
    mock.method(globalThis, "fetch", async () => {
      throw geworfen;
    });
    mock.method(console, "warn", (zeile) => zeilen.push(zeile));
    const schreiber = elevenlabsNummern().inboundTrunkSchreiberWennErlaubt(CONFIG);

    await schreiber.ensureInboundTrunk(NUMMER).catch(() => undefined);

    assert.deepEqual(zeilen, [`[el-trunk] schreiben_fehlgeschlagen nummer_id=${NUMMER.id} status=${erwartet}`]);
  });
}
