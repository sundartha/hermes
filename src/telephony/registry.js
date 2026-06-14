// Telefonie-Registry: liefert die aktive Adapter-Instanz. P0 hat genau einen
// Adapter (Twilio) - die Auswahl ist bewusst fix, kein Env-Switch (das ist spaeter).
import { twilioVoice } from "./adapters/twilio/voice.js";
import { twilioMessaging } from "./adapters/twilio/messaging.js";

/** @returns {import("./ports.js").VoiceControl} */
export const voiceControl = () => twilioVoice;

/** @returns {import("./ports.js").Messaging} */
export const messaging = () => twilioMessaging;
