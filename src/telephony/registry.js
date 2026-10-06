import { telnyxVoice } from "./adapters/telnyx/voice.js";
import { telnyxMessaging } from "./adapters/telnyx/messaging.js";
import { renderDirectives as telnyxRenderDirectives } from "./adapters/telnyx/render.js";
import { verifyInboundSignature as telnyxVerify } from "./adapters/telnyx/signature.js";
import { telnyxNumberProvisioning } from "./adapters/telnyx/numbers.js";
import { telnyxConfigRead } from "./adapters/telnyx/config-read.js";
import { telnyxWebhookEvents } from "./adapters/telnyx/webhook-events.js";
import { DEFAULT_PROVIDER, PROVIDER } from "../store/defaults.js";
import { config } from "../config.js";
import crypto from "node:crypto";

const fakeVoice = {
  async originateCall() {
    return { sid: `fake_${crypto.randomBytes(8).toString("hex")}` };
  },
  async endCall() {},
  async endCallViaCallControl() {},
};

const PORT = Object.freeze({
  VOICE_CONTROL: "voiceControl",
  MESSAGING: "messaging",
  WEBHOOK_EVENTS: "webhookEvents",
  NUMBER_PROVISIONING: "numberProvisioning",
  PROVIDER_CONFIG_READ: "providerConfigRead",
  VOICE_RENDERER: "voiceRenderer",
});

const ADAPTERS = Object.freeze({
  [PORT.VOICE_CONTROL]: { [PROVIDER.TELNYX]: telnyxVoice },
  [PORT.MESSAGING]: { [PROVIDER.TELNYX]: telnyxMessaging },
  [PORT.WEBHOOK_EVENTS]: { [PROVIDER.TELNYX]: telnyxWebhookEvents },
  [PORT.NUMBER_PROVISIONING]: { [PROVIDER.TELNYX]: telnyxNumberProvisioning },
  [PORT.PROVIDER_CONFIG_READ]: { [PROVIDER.TELNYX]: telnyxConfigRead },
  [PORT.VOICE_RENDERER]: {
    [PROVIDER.TELNYX]: {
      renderDirectives: (d) => telnyxRenderDirectives(d, { sttProfile: config.voice.sttProfile }),
    },
  },
});

function pick(port, provider) {
  const impl = ADAPTERS[port]?.[provider];
  if (impl === undefined)
    throw new Error(`Provider '${provider}' fuer Port '${port}' nicht unterstuetzt`);
  return impl;
}

export const CAPABILITY = Object.freeze({
  PLAY_AUDIO_TTS: "playAudioTts",
});

const PROVIDER_CAPABILITIES = Object.freeze({
  [PROVIDER.TELNYX]: Object.freeze({
    [CAPABILITY.PLAY_AUDIO_TTS]: true,
  }),
});

export function providerSupports(provider, capability) {
  return PROVIDER_CAPABILITIES[provider]?.[capability] === true;
}

export const voiceControl = (provider = DEFAULT_PROVIDER) => {
  if (config.safety.fakeOriginate) return fakeVoice;
  return pick(PORT.VOICE_CONTROL, provider);
};

export const messaging = (provider = DEFAULT_PROVIDER) => pick(PORT.MESSAGING, provider);

export const webhookEvents = (provider = DEFAULT_PROVIDER) => pick(PORT.WEBHOOK_EVENTS, provider);

export const numberProvisioning = (provider = PROVIDER.TELNYX) =>
  pick(PORT.NUMBER_PROVISIONING, provider);

export const providerConfigRead = (provider = PROVIDER.TELNYX) =>
  pick(PORT.PROVIDER_CONFIG_READ, provider);

export const voiceRenderer = (provider = DEFAULT_PROVIDER) => pick(PORT.VOICE_RENDERER, provider);

export function providerFromHeaders(headers) {
  const h = headers || {};
  if (h["telnyx-signature-ed25519"] !== undefined && h["telnyx-timestamp"] !== undefined)
    return PROVIDER.TELNYX;
  return null;
}

export const inboundSignatureVerifier = () => ({
  verifyInboundSignature(req) {
    const provider = providerFromHeaders(req.headers);
    if (provider === PROVIDER.TELNYX) return telnyxVerify(req);
    return false;
  },
});
