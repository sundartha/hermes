// Telefonie-Registry: liefert die aktive Adapter-Instanz. Ab P5 zwei Adapter
// (Twilio + Telnyx). voiceRenderer/messaging waehlen ueber einen optionalen
// provider-Param (Default twilio -> bestehende arg-lose Call-Sites in server.js
// byte-identisch). inboundSignatureVerifier dispatcht NACH Signatur-Header (nicht
// nach provider/To): die Signatur ist die erste fail-closed-Stufe und liegt
// strukturell VOR dem To-Routing (P3c) - To/provider vor gueltiger Signatur zu
// lesen waere Tenant-Spoofing. providerFromHeaders ist die EINZIGE Header->Provider-
// Karte: der Verifier dispatcht darueber, server.js (P6a) leitet daraus den
// Inbound-Provider ab (Single Source of Truth). voiceControl ist provider-aware
// (Telnyx-Outbound, Onboarding-Phase): Default twilio -> arg-lose Call-Sites
// byte-identisch.
import { twilioVoice } from "./adapters/twilio/voice.js";
import { telnyxVoice } from "./adapters/telnyx/voice.js";
import { twilioMessaging } from "./adapters/twilio/messaging.js";
import { renderDirectives as twilioRenderDirectives } from "./adapters/twilio/render.js";
import { verifyInboundSignature as twilioVerify } from "./adapters/twilio/signature.js";
import { telnyxMessaging } from "./adapters/telnyx/messaging.js";
import { renderDirectives as telnyxRenderDirectives } from "./adapters/telnyx/render.js";
import { verifyInboundSignature as telnyxVerify } from "./adapters/telnyx/signature.js";
import { telnyxNumberProvisioning } from "./adapters/telnyx/numbers.js";
import { twilioMedia } from "./adapters/twilio/media.js";
import { telnyxMedia } from "./adapters/telnyx/media.js";
import { PROVIDER } from "../store/defaults.js";

/** @returns {import("./ports.js").VoiceControl} */
export const voiceControl = (provider = PROVIDER.TWILIO) =>
  provider === PROVIDER.TELNYX ? telnyxVoice : twilioVoice;

/** @returns {import("./ports.js").Messaging} */
export const messaging = (provider = PROVIDER.TWILIO) =>
  provider === PROVIDER.TELNYX ? telnyxMessaging : twilioMessaging;

// MediaTransport (Port 4, Realtime-WS-Frame-Schicht, Aufrufer bridge.js). Provider-
// aware wie voiceControl: Default twilio -> bestehender Realtime-Pfad byte-identisch.
/** @returns {import("./ports.js").MediaTransport} */
export const mediaTransport = (provider = PROVIDER.TWILIO) =>
  provider === PROVIDER.TELNYX ? telnyxMedia : twilioMedia;

// NumberProvisioning (Port 3, Onboarding/Geld-Pfad): nur Telnyx implementiert
// (Twilio-Provisioning ist nicht im Scope dieser Phase). Fail-closed: ein nicht
// unterstuetzter Provider wirft, statt still einen falschen Adapter zu liefern.
/** @returns {import("./ports.js").NumberProvisioning} */
export const numberProvisioning = (provider = PROVIDER.TELNYX) => {
  if (provider === PROVIDER.TELNYX) return telnyxNumberProvisioning;
  throw new Error(`NumberProvisioning fuer Provider '${provider}' nicht unterstuetzt`);
};

/** @returns {import("./ports.js").VoiceRenderer} */
export const voiceRenderer = (provider = PROVIDER.TWILIO) =>
  provider === PROVIDER.TELNYX
    ? { renderDirectives: telnyxRenderDirectives }
    : { renderDirectives: twilioRenderDirectives };

// Header -> Provider (rein, IO-frei). EINZIGE Stelle, die Inbound-Signatur-Header
// auf einen Provider abbildet: der Signatur-Verifier dispatcht darueber UND
// server.js leitet daraus den Inbound-Provider ab (Single Source of Truth, G5).
// Kein erkannter Header -> null (Aufrufer entscheidet ueber den Fallback).
export function providerFromHeaders(headers) {
  const h = headers || {};
  if (h["x-twilio-signature"] !== undefined) return PROVIDER.TWILIO;
  if (h["telnyx-signature-ed25519"] !== undefined && h["telnyx-timestamp"] !== undefined)
    return PROVIDER.TELNYX;
  return null;
}

// Owner-Absendernummer fuer einen Provider (rein): Telnyx-Call -> Telnyx-Owner-
// Nummer, sonst Twilio-Owner-Nummer. cfg wird hereingereicht (testbar ohne echte
// config; finishCall reicht das echte config). Unbekannter/fehlender Provider ->
// Twilio-Fallback (byte-identisch zum Bestand). Eine Stelle fuer die Provider->
// Owner-Nummer-Abbildung (G5) statt Inline-Ternary im langen finishCall.
export function ownerNumberForProvider(provider, cfg) {
  return provider === PROVIDER.TELNYX ? cfg.telnyxNumber : cfg.twilioNumber;
}

/** @returns {import("./ports.js").InboundSignatureVerifier} */
export const inboundSignatureVerifier = () => ({
  verifyInboundSignature(req) {
    // Provider aus den Headern; der Twilio-Pfad bleibt exakt der bestehende Aufruf
    // (Hot-Path byte-identisch). Unbekannt -> fail-closed.
    const provider = providerFromHeaders(req.headers);
    if (provider === PROVIDER.TWILIO) return twilioVerify(req);
    if (provider === PROVIDER.TELNYX) return telnyxVerify(req);
    return false;
  },
});
