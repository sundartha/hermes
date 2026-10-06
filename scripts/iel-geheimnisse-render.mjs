import { HERMES_RENDER_SERVICE_ID } from "../src/elevenlabs/init-webhook-ziel.js";
import { leseRenderDienst, leseRenderEnvVar, schreibeRenderEnvVar } from "../src/render-api.js";

export const RENDER_SCHLUESSEL = Object.freeze({
  SIP_USER: "ELEVENLABS_INBOUND_SIP_USER",
  SIP_PASSWORD: "ELEVENLABS_INBOUND_SIP_PASSWORD",
  INIT_TOKEN: "ELEVENLABS_INIT_WEBHOOK_TOKEN",
  TENANT_IDS: "ELEVENLABS_INBOUND_TENANT_IDS",
  ENABLED: "ELEVENLABS_INBOUND_ENABLED",
  SCOPE: "ELEVENLABS_INBOUND_SCOPE",
  OWNER_TENANT_IDS: "OWNER_SELF_CALL_TENANT_IDS",
  TELNYX_VOICE: "TELNYX_ELEVENLABS_VOICE_ID",
  PLAY_VOICE: "ELEVENLABS_VOICE_ID",
  MODEL: "ELEVENLABS_MODEL",
});
const SCHREIBBARE_SCHLUESSEL = Object.freeze([
  RENDER_SCHLUESSEL.SIP_USER,
  RENDER_SCHLUESSEL.SIP_PASSWORD,
  RENDER_SCHLUESSEL.INIT_TOKEN,
  RENDER_SCHLUESSEL.TENANT_IDS,
  RENDER_SCHLUESSEL.ENABLED,
  RENDER_SCHLUESSEL.SCOPE,
]);
export const RENDER_GEHEIMNISSE = Object.freeze([
  Object.freeze({ schluessel: RENDER_SCHLUESSEL.SIP_USER, feld: "sipUser" }),
  Object.freeze({ schluessel: RENDER_SCHLUESSEL.SIP_PASSWORD, feld: "sipPassword" }),
  Object.freeze({ schluessel: RENDER_SCHLUESSEL.INIT_TOKEN, feld: "initWebhookToken" }),
]);
export const HTTP = Object.freeze({ OK: 200, NICHT_GEFUNDEN: 404 });

function dienstZugriff(abh) {
  return { fetchImpl: abh.fetchImpl, apiKey: abh.renderApiKey, serviceId: HERMES_RENDER_SERVICE_ID };
}

export function leseDienstEnv(abh, schluessel) {
  return leseRenderEnvVar({ ...dienstZugriff(abh), schluessel });
}

export async function schreibeDienstEnv(abh, { schluessel, wert }) {
  if (!SCHREIBBARE_SCHLUESSEL.includes(schluessel)) {
    throw new Error(`Render-Schluessel ${schluessel} ist fuer dieses Werkzeug nicht schreibbar`);
  }
  return schreibeRenderEnvVar({ ...dienstZugriff(abh), schluessel, wert });
}

export async function dienstLesbar(abh) {
  const { status } = await leseRenderDienst(dienstZugriff(abh));
  return status === HTTP.OK;
}
