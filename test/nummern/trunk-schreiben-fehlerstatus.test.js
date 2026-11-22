import assert from "node:assert/strict";
import { test } from "node:test";

import { makeInboundTrunkSchreiber } from "../../src/elevenlabs/nummern-registrierung.js";

const NUMMER = { id: "n_fehlerstatus", e164: "+12025550101", providerAgentPhoneNumberId: "phnum_fehlerstatus" };
const EL = { apiKey: "xi_fehlerstatus_key", apiBase: "https://el.invalid", agentId: "agent_fehlerstatus" };
const ZUGANG = { sipUser: "fehlerstatus-benutzer", sipPassword: "fehlerstatus-passwort-".padEnd(40, "x") };

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

for (const [name, geworfen, erwartet] of FAELLE) {
  test(`trunk-schreiben-fehlerstatus: ${name} loggt status=${erwartet}`, async () => {
    const zeilen = [];
    const fetchImpl = async () => {
      throw geworfen;
    };
    const schreiber = makeInboundTrunkSchreiber({ el: EL, zugang: ZUGANG, fetchImpl, logger: { warn: (z) => zeilen.push(z) } });

    await schreiber.ensureInboundTrunk(NUMMER).catch(() => undefined);

    assert.deepEqual(zeilen, [`[el-trunk] schreiben_fehlgeschlagen nummer_id=${NUMMER.id} status=${erwartet}`]);
  });
}
