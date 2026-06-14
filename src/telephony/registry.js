// Telefonie-Registry: liefert die aktive Adapter-Instanz. Ab P5 zwei Adapter
// (Twilio + Telnyx). voiceRenderer/messaging waehlen ueber einen optionalen
// provider-Param (Default twilio -> bestehende arg-lose Call-Sites in server.js
// byte-identisch). inboundSignatureVerifier dispatcht NACH Signatur-Header (nicht
// nach provider/To): die Signatur ist die erste fail-closed-Stufe und liegt
// strukturell VOR dem To-Routing (P3c) - To/provider vor gueltiger Signatur zu
// lesen waere Tenant-Spoofing. voiceControl bleibt Twilio-only (Telnyx-Outbound
// deferred, P6).
import { twilioVoice } from "./adapters/twilio/voice.js";
import { twilioMessaging } from "./adapters/twilio/messaging.js";
import { renderDirectives as twilioRenderDirectives } from "./adapters/twilio/render.js";
import { verifyInboundSignature as twilioVerify } from "./adapters/twilio/signature.js";
import { telnyxMessaging } from "./adapters/telnyx/messaging.js";
import { renderDirectives as telnyxRenderDirectives } from "./adapters/telnyx/render.js";
import { verifyInboundSignature as telnyxVerify } from "./adapters/telnyx/signature.js";
import { PROVIDER } from "../store/defaults.js";

/** @returns {import("./ports.js").VoiceControl} */
export const voiceControl = () => twilioVoice;

/** @returns {import("./ports.js").Messaging} */
export const messaging = (provider = PROVIDER.TWILIO) =>
  provider === PROVIDER.TELNYX ? telnyxMessaging : twilioMessaging;

/** @returns {import("./ports.js").VoiceRenderer} */
export const voiceRenderer = (provider = PROVIDER.TWILIO) =>
  provider === PROVIDER.TELNYX
    ? { renderDirectives: telnyxRenderDirectives }
    : { renderDirectives: twilioRenderDirectives };

/** @returns {import("./ports.js").InboundSignatureVerifier} */
export const inboundSignatureVerifier = () => ({
  verifyInboundSignature(req) {
    const h = req.headers || {};
    // Twilio-Pfad ist exakt der bestehende Aufruf (Hot-Path byte-identisch).
    if (h["x-twilio-signature"] !== undefined) return twilioVerify(req);
    if (h["telnyx-signature-ed25519"] !== undefined && h["telnyx-timestamp"] !== undefined)
      return telnyxVerify(req);
    // Kein erkannter Provider-Header -> fail-closed.
    return false;
  },
});
