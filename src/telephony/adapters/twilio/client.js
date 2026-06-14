// Zentraler Twilio-Client (heute doppelt in server.js + bridge.js). Lazy gebaut:
// erst beim ersten Aufruf, damit Import/Start ohne echte Credentials gruen bleibt.
import twilio from "twilio";
import { config } from "../../../config.js";

let client = null;

// Baut genau den Client wie bisher: SID + Token + Edge aus der zentralen Config.
export function twilioClient() {
  if (!client) client = twilio(config.twilioSid, config.twilioToken, { edge: config.twilioEdge });
  return client;
}
