import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";

import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import {
  placeCall,
  seedState,
  startServer,
  startServerExpectExit,
  TELNYX_TEST_OWNER_NUMBER,
} from "../helpers.js";
import { initInhaltFuer, vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;
const BOOT_VERWEIGERT = 1;
const UMGEBUNG_VAR = "ELEVENLABS_ENVIRONMENT";

const umgebungIn = ({ config }) => config.voice.elevenLabsOutbound.environment;
const umgebungsFunde = ({ configFatalErrors }) =>
  configFatalErrors().filter((meldung) => meldung.includes(UMGEBUNG_VAR));

test("EL-UMGEBUNG d: ein unbekannter Wert fuer ELEVENLABS_ENVIRONMENT verweigert den Start und nennt die Einstellung", async () => {
  const { code, output } = await startServerExpectExit({
    env: { ELEVENLABS_ENVIRONMENT: "Staging" },
  });

  assert.equal(code, BOOT_VERWEIGERT);
  assert.match(output, /Boot wird verweigert/);
  assert.match(output, /ELEVENLABS_ENVIRONMENT="Staging" ist unbekannt/);
});

test("EL-UMGEBUNG e: config.js liest ELEVENLABS_ENVIRONMENT und meldet nur unbekannte Werte", async () => {
  const gesetzt = process.env.ELEVENLABS_ENVIRONMENT;
  try {
    delete process.env.ELEVENLABS_ENVIRONMENT;
    const ohne = await import("../../src/config.ts?el-umgebung-ohne");
    process.env.ELEVENLABS_ENVIRONMENT = "production";
    const production = await import("../../src/config.ts?el-umgebung-production");
    process.env.ELEVENLABS_ENVIRONMENT = "staging";
    const staging = await import("../../src/config.ts?el-umgebung-staging");
    process.env.ELEVENLABS_ENVIRONMENT = "Staging";
    const unbekannt = await import("../../src/config.ts?el-umgebung-unbekannt");

    assert.deepEqual([ohne, production, staging, unbekannt].map(umgebungIn), [
      "production",
      "production",
      "staging",
      "production",
    ]);
    assert.deepEqual([ohne, production, staging].flatMap(umgebungsFunde), []);
    assert.deepEqual(umgebungsFunde(unbekannt), [
      'ELEVENLABS_ENVIRONMENT="Staging" ist unbekannt (gueltig: production|staging).',
    ]);
  } finally {
    if (gesetzt === undefined) delete process.env.ELEVENLABS_ENVIRONMENT;
    else process.env.ELEVENLABS_ENVIRONMENT = gesetzt;
  }
});

async function vorspannInitMit(env) {
  const srv = await startServer({
    env: {
      ELEVENLABS_OUTBOUND_ENABLED: "true",
      ELEVENLABS_RESULT_POLL_MS: "60000",
      ...vorspannMandantenUmgebung([BOOTSTRAP_TENANT_ID]),
      ...env,
    },
    seed: seedState({ tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }] }),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    const res = await placeCall(srv);
    const antwort = await res.text();
    assert.equal(res.status, HTTP_OK, antwort);
    return await initInhaltFuer(srv, { callId: JSON.parse(antwort).callId });
  } finally {
    await srv.stop();
  }
}

test("EL-UMGEBUNG g: der Init eines Vorspann-Anrufs traegt bei ELEVENLABS_ENVIRONMENT=staging environment staging", async () => {
  const inhalt = await vorspannInitMit({ ELEVENLABS_ENVIRONMENT: "staging" });

  assert.equal(inhalt.environment, "staging");
});

test("EL-UMGEBUNG h: der Init eines Vorspann-Anrufs traegt bei production keinen Schluessel environment", async () => {
  const inhalt = await vorspannInitMit({ ELEVENLABS_ENVIRONMENT: "production" });

  assert.ok(inhalt.dynamic_variables, "dynamic_variables fehlt im Init");
  assert.equal(Object.hasOwn(inhalt, "environment"), false);
});

const TEXT_GESETZT = {
  METRIKEN_OTLP_URL: "  https://metriken.example.org/otlp  ",
  METRIKEN_OTLP_BENUTZER: " benutzer-1 ",
  METRIKEN_OTLP_TOKEN: " token-1 ",
  ELEVENLABS_INBOUND_SIP_USER: " sip-benutzer ",
  ELEVENLABS_INBOUND_SIP_PASSWORD: " sip-kennwort ",
  ELEVENLABS_INIT_WEBHOOK_TOKEN: " init-token ",
  RENDER_INSTANCE_ID: " srv-42 ",
};

async function configMit(werte, laden) {
  const vorher = Object.fromEntries(Object.keys(TEXT_GESETZT).map((name) => [name, process.env[name]]));
  try {
    for (const name of Object.keys(TEXT_GESETZT)) delete process.env[name];
    Object.assign(process.env, werte);
    return (await laden()).config;
  } finally {
    for (const [name, wert] of Object.entries(vorher)) {
      if (wert === undefined) delete process.env[name];
      else process.env[name] = wert;
    }
  }
}

test("EL-UMGEBUNG f: Metrik-, SIP- und Instanz-Texte werden getrimmt uebernommen", async () => {
  const config = await configMit(TEXT_GESETZT, () => import("../../src/config.ts?text-gesetzt"));

  assert.deepEqual(
    [
      config.telemetry.telemetryOtlpUrl,
      config.telemetry.telemetryOtlpUser,
      config.telemetry.telemetryOtlpToken,
      config.telemetry.telemetryInstanceId,
      config.voice.elevenLabsInbound.sipUser,
      config.voice.elevenLabsInbound.sipPassword,
      config.voice.elevenLabsInbound.initWebhookToken,
    ],
    ["https://metriken.example.org/otlp", "benutzer-1", "token-1", "srv-42", "sip-benutzer", "sip-kennwort", "init-token"],
  );
});

test("EL-UMGEBUNG g: fehlende Metrik- und SIP-Texte sind leer, die Instanz heisst wie der Rechner", async () => {
  const config = await configMit({}, () => import("../../src/config.ts?text-leer"));

  assert.deepEqual(
    [
      config.telemetry.telemetryOtlpUrl,
      config.telemetry.telemetryOtlpUser,
      config.telemetry.telemetryOtlpToken,
      config.voice.elevenLabsInbound.sipUser,
      config.voice.elevenLabsInbound.sipPassword,
      config.voice.elevenLabsInbound.initWebhookToken,
    ],
    ["", "", "", "", "", ""],
  );
  assert.equal(config.telemetry.telemetryInstanceId, os.hostname());
});
