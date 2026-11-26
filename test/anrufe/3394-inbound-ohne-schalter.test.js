import { test } from "node:test";
import assert from "node:assert/strict";
import { inboundPfadEntscheidung } from "../../src/elevenlabs/inbound-path-decision.ts";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
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
  assert.equal(wahl(GEPINNT), "elevenlabs");
  assert.equal(wahl("tenant_fremd"), "elevenlabs");
  assert.equal(wahl(GEPINNT, { sipUser: "" }), "abgewiesen");
});

test("3394-3: Zugang unvollstaendig ohne Schalter-Env - Boot-Refusal ohne Hinweis auf den Schalter", async () => {
  const { code, output } = await startServerExpectExit({
    env: { ELEVENLABS_INIT_WEBHOOK_TOKEN: "" },
  });
  assert.equal(code, 1);
  assert.match(output, /Start abgebrochen: Der Zugang des EL-Inbound-Wegs ist unvollstaendig: ELEVENLABS_INIT_WEBHOOK_TOKEN fehlt/);
  assert.match(output, /Handlung: die Geheimnisse per Skript-Lauf neu setzen\./);
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
    assert.match(await res.text(), /sip\.rtc\.elevenlabs\.io/);
  } finally {
    await srv.stop();
  }
});
