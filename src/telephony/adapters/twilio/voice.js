// Twilio-Adapter: VoiceControl (originateCall, endCall). Reines Verschieben der
// bestehenden calls.create / calls(sid).update-Aufrufe.
import { twilioClient } from "./client.js";

/** @type {import("../../ports.js").VoiceControl} */
export const twilioVoice = {
  // Outbound-Call starten. Parameter 1:1 wie bisher in server.js:428.
  async originateCall(params) {
    const tw = await twilioClient().calls.create(params);
    return { sid: tw.sid };
  },

  // Laufenden Call beenden. 1:1 wie bisher (server.js:224/458, bridge.js:54).
  async endCall(providerCallSid) {
    await twilioClient().calls(providerCallSid).update({ status: "completed" });
  },
};
