// Twilio-Adapter: VoiceControl (originateCall, endCall). Reines Verschieben der
// bestehenden calls.create / calls(sid).update-Aufrufe.
import { twilioClient } from "./client.js";

/** @type {import("../../ports.js").VoiceControl} */
export const twilioVoice = {
  // Outbound-Call starten. Parameter-Objekt 1:1 wie bisher durchgereicht.
  async originateCall(params) {
    const tw = await twilioClient().calls.create(params);
    return { sid: tw.sid };
  },

  // Laufenden Call beenden. Verhalten 1:1 wie bisher.
  async endCall(providerCallSid) {
    await twilioClient().calls(providerCallSid).update({ status: "completed" });
  },
};
