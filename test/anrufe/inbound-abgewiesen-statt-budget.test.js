import assert from "node:assert/strict";
import { test } from "node:test";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { inboundPfadEntscheidung } from "../../src/elevenlabs/inbound-path-decision.ts";
import { INBOUND_EL_SCOPE } from "../../src/elevenlabs/inbound-scope.ts";
import { INBOUND_EL_GRUND } from "../../src/elevenlabs/inbound-uebergabe-gescheitert.ts";
import { LOCALES } from "../../src/i18n/locales.js";
import { INBOUND_PATH } from "../../src/telephony/inbound-path.ts";
import { hangup, say } from "../../src/telephony/directives.ts";
import { renderDirectives } from "../../src/telephony/adapters/telnyx/render.ts";
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
const OWNER_NAME = "Jonas";
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

test("H4A-2: es gibt keinen Budget-Eingangsweg mehr, nur elevenlabs und abgewiesen", () => {
  assert.deepEqual(Object.keys(INBOUND_PATH), ["ELEVENLABS", "ABGEWIESEN"]);
});

const fehlersatzTexml = () =>
  renderDirectives([say(LOCALES.de.inboundFehlersatz(OWNER_NAME), LOCALES.de.voiceProfile), hangup()]);

test("H4A-3: POST /voice/incoming fuer einen nicht gepinnten Tenant liefert Fehlersatz und Auflegen, kein Gather, und vermerkt den Grund", async () => {
  const srv = await startServer({
    env: { ...EL_INBOUND_ACCESS_BOOT_ENV, ELEVENLABS_INBOUND_TENANT_IDS: FREMD },
    seed: seedWithTelnyxNumber({ language: "de" }),
  });
  try {
    const res = await postTelnyxIncoming(srv, { callSid: "CAh4a" });
    assert.equal(res.status, HTTP_OK);
    const texml = await res.text();
    assert.equal(texml, fehlersatzTexml());
    assert.ok(!texml.includes("<Gather"));
    assert.ok(texml.includes("<Hangup"));
    assert.ok(texml.includes("<Say"));
    assert.ok(!texml.includes("sip.rtc.elevenlabs.io"));

    const zustand = await waitForStoreState(srv, (stand) => Boolean(stand.calls[0]?.elFallbackAt), STORE_FRIST_MS);
    const [call] = zustand.calls;
    assert.equal(call.costProfile, KOSTENPROFIL.TELNYX_INBOUND_BUDGET);
    assert.equal(call.failureReason, INBOUND_EL_GRUND.EL_OHNE_REGISTRIERUNG);
    assert.equal(call.transcript.length, 0);
    await waitForLog(srv, new RegExp(`\\[inbound\\] abgewiesen grund=${INBOUND_EL_GRUND.EL_OHNE_REGISTRIERUNG} call=${call.id}`));
    assert.ok(srv.stdout.includes('"path":"abgewiesen"'));
    assert.ok(!srv.stdout.includes('"path":"budget"'));
  } finally {
    await srv.stop();
  }
});
