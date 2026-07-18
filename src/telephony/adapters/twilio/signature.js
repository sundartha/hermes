// Twilio-Adapter: Inbound-Signaturpruefung. Reines Verschieben von
// twilio.validateRequest hinter den Port (verifyInboundSignature). Twilio:
// HMAC-SHA1 ueber URL + sortierte Form-Params (rawBody wird hier NICHT gebraucht -
// existiert im Vertrag fuer den kuenftigen Ed25519-Pfad/Telnyx).
import twilio from "twilio";
import { config } from "../../../config.js";

/** @type {import("../../ports.js").InboundSignatureVerifier["verifyInboundSignature"]} */
export function verifyInboundSignature({ headers, url, params }) {
  // Fail-closed: ohne PUBLIC_URL kann die signierte URL nicht rekonstruiert werden.
  if (!config.server.publicUrl) return false;
  const signature = headers["x-twilio-signature"] || "";
  return twilio.validateRequest(config.telephony.twilioToken, signature, url, params || {});
}
