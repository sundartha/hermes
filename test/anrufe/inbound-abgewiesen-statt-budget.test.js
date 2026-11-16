import assert from "node:assert/strict";
import { test } from "node:test";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { inboundPfadEntscheidung } from "../../src/elevenlabs/inbound-path-decision.ts";
import { INBOUND_EL_SCOPE } from "../../src/elevenlabs/inbound-scope.ts";
import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  postTelnyxIncoming,
  seedWithTelnyxNumber,
  startServer,
  waitForLog,
  waitForStoreState,
} from "../helpers.js";

const GEPINNT = "tenant_h4a_gepinnt";
const FREMD = "tenant_h4a_fremd";
const HTTP_OK = 200;
const STORE_FRIST_MS = 8000;

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
    },
  };
}

const FAELLE = [
  { name: "gepinnter Tenant bei allowlist", overrides: {}, tenantId: GEPINNT, erwartet: "elevenlabs" },
  { name: "nicht gepinnter Tenant bei allowlist", overrides: {}, tenantId: FREMD, erwartet: "abgewiesen" },
  { name: "unbekannter Scope", overrides: { scope: "alle" }, tenantId: GEPINNT, erwartet: "abgewiesen" },
  { name: "fehlender Scope", overrides: { scope: undefined }, tenantId: GEPINNT, erwartet: "abgewiesen" },
  { name: "Zugang unvollstaendig", overrides: { sipUser: "" }, tenantId: GEPINNT, erwartet: "abgewiesen" },
];

for (const fall of FAELLE) {
  test(`H4A-1: Weiche - ${fall.name} -> ${fall.erwartet}`, () => {
    const entscheidung = inboundPfadEntscheidung({ config: konfig(fall.overrides), tenantId: fall.tenantId });
    assert.equal(entscheidung, fall.erwartet);
  });
}

const GRUND = "ohne_el_registrierung";
const FEHLERSATZ_ANTWORT = /^<\?xml[^>]*\?><Response><Say [^>]*>Hier ist der KI-Assistent von Jonas\. [^<]+<\/Say><Hangup\/><\/Response>$/;

test("H4A-3: POST /voice/incoming fuer einen nicht gepinnten Tenant liefert Fehlersatz und Auflegen, kein Gather, und vermerkt den Grund", async () => {
  const srv = await startServer({
    env: { ...EL_INBOUND_ACCESS_BOOT_ENV, ELEVENLABS_INBOUND_TENANT_IDS: FREMD },
    seed: seedWithTelnyxNumber({ language: "de" }),
  });
  try {
    const res = await postTelnyxIncoming(srv, { callSid: "CAh4a" });
    assert.equal(res.status, HTTP_OK);
    const texml = await res.text();
    assert.match(texml, FEHLERSATZ_ANTWORT);
    assert.ok(!texml.includes("<Gather"));
    assert.ok(texml.includes("<Hangup"));
    assert.ok(texml.includes("<Say"));
    assert.doesNotMatch(texml, /<Dial|<Sip/);

    const zustand = await waitForStoreState(srv, (stand) => Boolean(stand.calls[0]?.elFallbackAt), STORE_FRIST_MS);
    const [call] = zustand.calls;
    assert.equal(call.costProfile, KOSTENPROFIL.TELNYX_INBOUND_BUDGET);
    assert.equal(call.failureReason, GRUND);
    assert.equal(call.transcript.length, 0);
    await waitForLog(srv, new RegExp(`\\[inbound\\] abgewiesen grund=${GRUND} call=${call.id}`));
    assert.ok(srv.stdout.includes('"path":"abgewiesen"'));
    assert.ok(!srv.stdout.includes('"path":"budget"'));
  } finally {
    await srv.stop();
  }
});
