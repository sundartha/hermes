import assert from "node:assert/strict";
import { test } from "node:test";

import { inboundPfadEntscheidung } from "../../src/elevenlabs/inbound-path-decision.ts";
import { inboundTrunkSchreibenErlaubt } from "../../src/elevenlabs/nummern-registrierung.js";
import { ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER } from "../../src/routes/webhooks-elevenlabs-init.ts";
import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  postTelnyxIncoming,
  seedWithTelnyxNumber,
  startServer,
  waitForLog,
} from "../helpers.js";

const HTTP_OK = 200;
const ZUGANG_MIN = 32;

async function mitServer(optionen, lauf) {
  const srv = await startServer(optionen);
  try {
    return await lauf(srv);
  } finally {
    await srv.stop();
  }
}

const seed = () => seedWithTelnyxNumber({ language: "de" });

const SCHALTER_ENV = Object.freeze({
  ELEVENLABS_INBOUND_SCOPE: "registrierte_dids",
  ELEVENLABS_INBOUND_TENANT_IDS: "t_x",
});

const UEBERGABE_FAELLE = [
  { name: "ohne Liste und ohne Schalter", env: {} },
  { name: "mit Scope registrierte_dids und fremder Liste", env: SCHALTER_ENV },
];

for (const fall of UEBERGABE_FAELLE) {
  test(`Eingehender Anruf, ${fall.name}: SIP-Uebergabe an ElevenLabs`, async () => {
    await mitServer({ env: { ...EL_INBOUND_ACCESS_BOOT_ENV, ...fall.env }, seed: seed() }, async (srv) => {
      const res = await postTelnyxIncoming(srv);
      assert.equal(res.status, HTTP_OK);
      const texml = await res.text();
      assert.match(texml, /<Dial[^>]*><Sip /);
      assert.doesNotMatch(texml, /<Hangup\/>|<Gather/);
      await waitForLog(srv, /\[inbound-path\] inbound_path \{[^}]*"path":"elevenlabs"\}/);
      assert.ok(!srv.stdout.includes('"path":"abgewiesen"'));
    });
  });
}

const ZUGANG_LUECKEN = [
  { name: "SIP-Benutzer leer", abweichung: { sipUser: "" } },
  { name: "SIP-Passwort zu kurz", abweichung: { sipPassword: "p".repeat(ZUGANG_MIN - 1) } },
  { name: "Init-Webhook-Token zu kurz", abweichung: { initWebhookToken: "t".repeat(ZUGANG_MIN - 1) } },
];

const VOLLER_ZUGANG = Object.freeze({
  sipUser: "u",
  sipPassword: "p".repeat(ZUGANG_MIN),
  initWebhookToken: "t".repeat(ZUGANG_MIN),
});

const weiche = (inbound) =>
  inboundPfadEntscheidung({ config: { voice: { elevenLabsInbound: inbound } }, tenantId: "t_ohne_liste" });

test("Weiche: vollstaendiger Zugang ohne Liste -> elevenlabs", () => {
  assert.equal(weiche(VOLLER_ZUGANG), "elevenlabs");
});

for (const luecke of ZUGANG_LUECKEN) {
  test(`Weiche: ${luecke.name} -> abgewiesen`, () => {
    assert.equal(weiche({ ...VOLLER_ZUGANG, ...luecke.abweichung }), "abgewiesen");
  });
}

test("Eingehender Anruf bei erschoepfter Kostendecke: Kostendecke-Abweisung", async () => {
  await mitServer({ env: { ...EL_INBOUND_ACCESS_BOOT_ENV, MAX_BUDGET_EUR: "0" }, seed: seed() }, async (srv) => {
    const res = await postTelnyxIncoming(srv);
    assert.match(await res.text(), /<Hangup\/>/);
    await waitForLog(srv, /\[inbound\] kostendecke to=/);
    assert.ok(!srv.stdout.includes('"path":"elevenlabs"'));
  });
});

test("Eingehender Anruf an unbekannte Nummer bleibt nicht erreichbar", async () => {
  await mitServer({ env: { ...EL_INBOUND_ACCESS_BOOT_ENV }, seed: seed() }, async (srv) => {
    const res = await postTelnyxIncoming(srv, { to: "+4930999000111" });
    const texml = await res.text();
    assert.match(texml, /<Hangup\/>/);
    assert.doesNotMatch(texml, /<Dial/);
  });
});

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

const HTTP_FORBIDDEN = 403;

test("Init-Webhook ohne gueltiges Token bleibt abgelehnt, auch ohne Mandantenliste", async () => {
  await mitServer({ env: { ...EL_INBOUND_ACCESS_BOOT_ENV }, seed: seed() }, async (srv) => {
    const url = `${srv.localUrl}${ELEVENLABS_INIT_PATH}`;
    for (const kopfzeilen of [{}, { [INIT_TOKEN_HEADER]: "x".repeat(ZUGANG_MIN) }]) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...kopfzeilen },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, HTTP_FORBIDDEN);
    }
  });
});
