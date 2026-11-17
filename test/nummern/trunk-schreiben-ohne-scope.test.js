import assert from "node:assert/strict";
import { test } from "node:test";

import { inboundTrunkSchreibenErlaubt } from "../../src/elevenlabs/nummern-registrierung.js";

const ZUGANG_MIN = 32;

function schreibConfig({ scope, tenantIds, provisioningEnabled = true, sipUser = "u" }) {
  return {
    provisioning: { provisioningEnabled },
    voice: {
      elevenLabsOutbound: { apiKey: "k", agentId: "a" },
      elevenLabsInbound: {
        scope,
        tenantIds,
        sipUser,
        sipPassword: "p".repeat(ZUGANG_MIN),
        initWebhookToken: "t".repeat(ZUGANG_MIN),
      },
    },
  };
}

const TRUNK_FAELLE = [
  { name: "Scope allowlist, leere Liste", config: { scope: "allowlist", tenantIds: [] }, erwartet: true },
  { name: "ohne Scope und ohne Liste", config: {}, erwartet: true },
  { name: "Scope registrierte_dids", config: { scope: "registrierte_dids", tenantIds: ["t_x"] }, erwartet: true },
  { name: "Provisioning aus", config: { provisioningEnabled: false }, erwartet: false },
  { name: "Zugang unvollstaendig", config: { sipUser: "" }, erwartet: false },
];

for (const fall of TRUNK_FAELLE) {
  test(`Trunk-Schreiben: ${fall.name} -> ${String(fall.erwartet)}`, () => {
    assert.equal(inboundTrunkSchreibenErlaubt(schreibConfig(fall.config)), fall.erwartet);
  });
}
