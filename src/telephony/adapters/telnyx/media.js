// Telnyx-Adapter Port 4 (MediaTransport): Telnyx-Media-Stream-Frames <-> neutral.
// DOKU-BASIERT (Telnyx-Recherche 2026-06-14), LIVE UNBESTAETIGT: das exakte
// Payload-Format (rohe u-law base64 wie Twilio ANGENOMMEN vs. RTP-gewrappt) ist
// das offene WS-Echo-Test-Gate (scripts/telnyx-ws-echo.mjs). Bis gruen bleibt
// Telnyx-Realtime produktiv gesperrt (.env.example-Warnung).
// Protokoll-Unterschiede zu Twilio: snake_case stream_id statt streamSid;
// Outbound/clear brauchen KEINE stream_id (Telnyx-Doku).
import { MEDIA_EVENT } from "../../media-events.js";

// Roh-WS-Nachricht (bereits JSON.parse't) -> neutrales MediaFrame. start: stream_id +
// TeXML-<Parameter> landet bei Telnyx in customParameters (ANGENOMMEN), dynamic_variables
// als zweite belegte Quelle geprueft. providerCallRef -> call.twilioSid (Brueckenfeld).
export function parseMediaFrame(msg) {
  switch (msg.event) {
    case "start": {
      const params = msg.start?.customParameters || msg.start?.dynamic_variables || {};
      return {
        event: MEDIA_EVENT.START,
        streamRef: msg.start?.stream_id,
        callId: params.call_id,
        streamToken: params.stream_token || "",
        providerCallRef: msg.start?.call_control_id ?? msg.start?.callSid,
      };
    }
    case "media":
      return { event: MEDIA_EVENT.MEDIA, payload: msg.media?.payload };
    case "stop":
      return { event: MEDIA_EVENT.STOP };
    default:
      return { event: MEDIA_EVENT.OTHER };
  }
}

// Neutrale Audio-Payload -> Telnyx-Outbound-WS-Objekt (KI -> Telefonie). OHNE stream_id
// (Telnyx-Doku-Symmetrie). Payload-Format (rohe u-law base64) ist die offene Annahme.
export function buildMediaFrame({ payload }) {
  return { event: "media", media: { payload } };
}

// Barge-in: Telnyx verwirft gepufferte Audio. OHNE stream_id (Telnyx-Doku-Symmetrie).
export function clearPlayback() {
  return { event: "clear" };
}

/** @type {import("../../ports.js").MediaTransport} */
export const telnyxMedia = { parseMediaFrame, buildMediaFrame, clearPlayback };
