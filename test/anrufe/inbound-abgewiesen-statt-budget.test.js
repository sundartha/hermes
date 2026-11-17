import assert from "node:assert/strict";
import { test } from "node:test";

import { inboundPfadEntscheidung } from "../../src/elevenlabs/inbound-path-decision.ts";

const GEPINNT = "tenant_h4a_gepinnt";
const FREMD = "tenant_h4a_fremd";

function konfig(overrides = {}) {
  return {
    voice: {
      elevenLabsInbound: {
        tenantIds: [GEPINNT],
        sipUser: "u",
        sipPassword: "p".repeat(32),
        initWebhookToken: "t".repeat(32),
        ...overrides,
      },
    },
  };
}

const FAELLE = [
  { name: "gepinnter Tenant bei allowlist", overrides: {}, tenantId: GEPINNT, erwartet: "elevenlabs" },
  { name: "nicht gepinnter Tenant bei allowlist", overrides: {}, tenantId: FREMD, erwartet: "elevenlabs" },
  { name: "unbekannter Scope", overrides: { scope: "alle" }, tenantId: GEPINNT, erwartet: "elevenlabs" },
  { name: "fehlender Scope", overrides: { scope: undefined }, tenantId: GEPINNT, erwartet: "elevenlabs" },
  { name: "Zugang unvollstaendig", overrides: { sipUser: "" }, tenantId: GEPINNT, erwartet: "abgewiesen" },
];

for (const fall of FAELLE) {
  test(`H4A-1: Weiche - ${fall.name} -> ${fall.erwartet}`, () => {
    const entscheidung = inboundPfadEntscheidung({ config: konfig(fall.overrides), tenantId: fall.tenantId });
    assert.equal(entscheidung, fall.erwartet);
  });
}
