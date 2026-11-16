import { test } from "node:test";
import assert from "node:assert/strict";
import { inboundPfadEntscheidung } from "../../src/elevenlabs/inbound-path-decision.ts";
import { INBOUND_EL_SCOPE } from "../../src/elevenlabs/inbound-scope.ts";
import { trunkSweepHindernis } from "../../src/elevenlabs/inbound-trunk-beleg.ts";
import { INBOUND_PATH } from "../../src/telephony/inbound-path.ts";
import { latentCostPathFindings, LATENT_COST_PATH_FINDING } from "../../src/boot-guard.js";
import { inboundElBannerLine } from "../../src/boot.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  normalizeIncomingTexml,
  postTelnyxIncoming,
  seedWithTelnyxNumber,
  startServer,
  startServerExpectExit,
} from "../helpers.js";

const HTTP_OK = 200;
const GEPINNT = "tenant_3394_gepinnt";

function konfig(overrides = {}) {
  return {
    voice: {
      elevenLabsInbound: {
        tenantIds: [GEPINNT],
        scope: INBOUND_EL_SCOPE.ALLOWLIST,
        sipUser: "u",
        sipPassword: "p".repeat(32),
        initWebhookToken: "t".repeat(32),
        ...overrides,
      },
      elevenLabsOutbound: { apiKey: "k", agentId: "a" },
    },
  };
}

test("3394-1: ohne Schalter entscheidet allein Scope, Beleg und Zugang", () => {
  const wahl = (tenantId, overrides) =>
    inboundPfadEntscheidung({ config: konfig(overrides), tenantId });
  assert.equal(wahl(GEPINNT), INBOUND_PATH.ELEVENLABS);
  assert.equal(wahl("tenant_fremd"), INBOUND_PATH.BUDGET);
  assert.equal(wahl(GEPINNT, { sipUser: "" }), INBOUND_PATH.BUDGET);
});

test("3394-2: der Trunk-Sweep kennt keinen Schalter-Grund mehr", () => {
  assert.equal(trunkSweepHindernis(konfig().voice), null);
  assert.equal(trunkSweepHindernis(konfig({ sipPassword: "kurz" }).voice), "zugang_unvollstaendig");
});

test("3394-3: Zugang unvollstaendig ohne Schalter-Env - Boot-Refusal ohne Hinweis auf den Schalter", async () => {
  const { code, output } = await startServerExpectExit({
    env: { ELEVENLABS_INIT_WEBHOOK_TOKEN: "" },
  });
  assert.equal(code, 1);
  assert.match(output, /Start abgebrochen: Der Zugang des EL-Inbound-Wegs ist unvollstaendig: ELEVENLABS_INIT_WEBHOOK_TOKEN fehlt/);
  assert.doesNotMatch(output, /ELEVENLABS_INBOUND_ENABLED/);
});

test("3394-4: POST /voice mit Zugang und gepinntem Tenant ohne Schalter-Env liefert den EL-Pfad", async () => {
  const srv = await startServer({
    env: { ...EL_INBOUND_ACCESS_BOOT_ENV, ELEVENLABS_INBOUND_TENANT_IDS: BOOTSTRAP_TENANT_ID },
    seed: seedWithTelnyxNumber({ language: "de" }),
  });
  try {
    const res = await postTelnyxIncoming(srv, { callSid: "CA3394" });
    assert.equal(res.status, HTTP_OK);
    const texml = normalizeIncomingTexml(await res.text());
    assert.match(texml, /<Dial/);
    assert.match(texml, /sip\.rtc\.elevenlabs\.io/);
  } finally {
    await srv.stop();
  }
});

test("3394-5: POST /voice ohne gepinnten Tenant bleibt ohne EL-Dial", async () => {
  const srv = await startServer({
    env: { ...EL_INBOUND_ACCESS_BOOT_ENV, ELEVENLABS_INBOUND_TENANT_IDS: "" },
    seed: seedWithTelnyxNumber({ language: "de" }),
  });
  try {
    const res = await postTelnyxIncoming(srv, { callSid: "CA3394b" });
    assert.equal(res.status, HTTP_OK);
    assert.doesNotMatch(await res.text(), /sip\.rtc\.elevenlabs\.io/);
  } finally {
    await srv.stop();
  }
});

test("3394-6: Kostenprofil ohne Einsammler ist ohne Schalter ein fataler Befund, mit Einsammler keiner", () => {
  const befunde = latentCostPathFindings({ playTtsEnabled: false, elInboundCarrierHasCollector: false });
  assert.deepEqual(
    befunde.map(({ code, fatal }) => ({ code, fatal })),
    [{ code: LATENT_COST_PATH_FINDING.EL_INBOUND_CARRIER_UNCOLLECTED, fatal: true }],
  );
  assert.doesNotMatch(befunde[0].message, /ELEVENLABS_INBOUND_ENABLED/);
  assert.deepEqual(latentCostPathFindings({ playTtsEnabled: false, elInboundCarrierHasCollector: true }), []);
});

test("3394-7: die Boot-Zeile nennt Tenants und Scope ohne Schalterzustand", () => {
  assert.equal(
    inboundElBannerLine({ tenantIds: ["a", "b"], scope: INBOUND_EL_SCOPE.ALLOWLIST }),
    "Inbound-EL: 2 Tenants, scope=allowlist",
  );
});
