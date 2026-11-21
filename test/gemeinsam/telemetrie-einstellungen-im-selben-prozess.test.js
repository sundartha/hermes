import assert from "node:assert/strict";
import { test, before } from "node:test";

import { tempDataDir, seedState } from "../helpers.js";

const NAMEN = ["METRIKEN_OTLP_URL", "METRIKEN_OTLP_BENUTZER", "METRIKEN_OTLP_TOKEN", "RENDER_INSTANCE_ID", "METRIKEN_INTERVALL_MS"];
const LADER = [
  () => import("../../src/config.ts?telemetrie=1"),
  () => import("../../src/config.ts?telemetrie=2"),
  () => import("../../src/config.ts?telemetrie=3"),
  () => import("../../src/config.ts?telemetrie=4"),
  () => import("../../src/config.ts?telemetrie=5"),
  () => import("../../src/config.ts?telemetrie=6"),
  () => import("../../src/config.ts?telemetrie=7"),
  () => import("../../src/config.ts?telemetrie=8"),
  () => import("../../src/config.ts?telemetrie=9"),
  () => import("../../src/config.ts?telemetrie=10"),
];
let zaehler = 0;

before(() => {
  process.env.DATA_DIR = tempDataDir(seedState({}));
});

async function konfiguration(umgebung) {
  for (const name of NAMEN) delete process.env[name];
  Object.assign(process.env, umgebung);
  const { config } = await LADER[zaehler]();
  zaehler += 1;
  return config;
}

test("Telemetrie-Einstellungen: ohne Werte ist der Export-Rhythmus 60000 und nichts konfiguriert", async () => {
  const config = await konfiguration({});
  assert.equal(config.telemetry.telemetryIntervalMs, 60000);
  assert.equal(config.telemetry.telemetryOtlpUrl, "");
  assert.equal(config.telemetry.telemetryOtlpUser, "");
  assert.equal(config.telemetry.telemetryOtlpToken, "");
});

test("Telemetrie-Einstellungen: ein Rhythmus von 10 gilt, 9 und 5 fallen auf 60000 zurueck", async () => {
  assert.equal((await konfiguration({ METRIKEN_INTERVALL_MS: "10" })).telemetry.telemetryIntervalMs, 10);
  assert.equal((await konfiguration({ METRIKEN_INTERVALL_MS: "11" })).telemetry.telemetryIntervalMs, 11);
  assert.equal((await konfiguration({ METRIKEN_INTERVALL_MS: "9" })).telemetry.telemetryIntervalMs, 60000);
  assert.equal((await konfiguration({ METRIKEN_INTERVALL_MS: "5" })).telemetry.telemetryIntervalMs, 60000);
});

test("Telemetrie-Einstellungen: Adresse, Benutzer und Token werden von Leerraum befreit", async () => {
  const config = await konfiguration({
    METRIKEN_OTLP_URL: "  https://otlp.example.test/otlp \n",
    METRIKEN_OTLP_BENUTZER: "\t123456 ",
    METRIKEN_OTLP_TOKEN: " geheimes-token  ",
  });
  assert.equal(config.telemetry.telemetryOtlpUrl, "https://otlp.example.test/otlp");
  assert.equal(config.telemetry.telemetryOtlpUser, "123456");
  assert.equal(config.telemetry.telemetryOtlpToken, "geheimes-token");
});

test("Telemetrie-Einstellungen: die Instanzkennung nimmt RENDER_INSTANCE_ID vor dem Hostnamen und trimmt sie", async () => {
  const mitKennung = await konfiguration({ RENDER_INSTANCE_ID: "  srv-abc-123 " });
  assert.equal(mitKennung.telemetry.telemetryInstanceId, "srv-abc-123");
  const ohne = await konfiguration({});
  const { hostname } = await import("node:os");
  assert.equal(ohne.telemetry.telemetryInstanceId, hostname().trim());
  const leer = await konfiguration({ RENDER_INSTANCE_ID: "" });
  assert.equal(leer.telemetry.telemetryInstanceId, hostname().trim());
});
