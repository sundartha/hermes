// Twilio-Adapter Port 4 (MediaTransport): Twilio-Media-Stream-Frames <-> neutral.
// VERHALTENS-ERHALTEND aus bridge.js gezogen (Charakterisierungs-Tests pinnen die
// Frame-Ausgabe byte-identisch). streamRef = Twilio streamSid.
import { MEDIA_EVENT } from "../../media-events.js";

// Roh-WS-Nachricht (bereits JSON.parse't) -> neutrales MediaFrame.
// Twilio-Events: start | media | stop. start traegt streamSid, callSid und
// customParameters (call_id, stream_token aus dem <Parameter>-TwiML).
export function parseMediaFrame(msg) {
  switch (msg.event) {
    case "start":
      return {
        event: MEDIA_EVENT.START,
        streamRef: msg.start.streamSid,
        callId: msg.start.customParameters?.call_id,
        streamToken: msg.start.customParameters?.stream_token || "",
        providerCallRef: msg.start.callSid, // -> call.twilioSid (Brueckenfeld)
      };
    case "media":
      return { event: MEDIA_EVENT.MEDIA, payload: msg.media?.payload };
    case "stop":
      return { event: MEDIA_EVENT.STOP };
    default:
      return { event: MEDIA_EVENT.OTHER };
  }
}

// Neutrale Audio-Payload -> Twilio-Outbound-WS-Objekt (KI -> Telefonie).
export function buildMediaFrame({ payload, streamRef }) {
  return { event: "media", streamSid: streamRef, media: { payload } };
}

// Barge-in: Twilio verwirft gepufferte Audio.
export function clearPlayback({ streamRef }) {
  return { event: "clear", streamSid: streamRef };
}

/** @type {import("../../ports.js").MediaTransport} */
export const twilioMedia = { parseMediaFrame, buildMediaFrame, clearPlayback };
