// Zentraler Twilio-Client (heute doppelt in server.js + bridge.js). Lazy gebaut:
// erst beim ersten Aufruf, damit Import/Start ohne echte Credentials gruen bleibt.
import twilio from "twilio";
import { config } from "../../../config.js";

let client = null;
// TEST-ONLY-Seam (S1-16): die SDK-Factory ist injizierbar, damit der twilioVoice-Adapter
// (originateCall/endCall) gegen einen Fake-Client getestet werden kann, OHNE das echte
// Twilio-SDK zu treffen. KEIN Env-/Config-Toggle (nie ueber Konfiguration aktivierbar) ->
// im Produktionspfad immer der echte twilio-Import. Der Test MUSS im finally restore()
// rufen; node --test isoliert jede Testdatei ohnehin in einem eigenen Prozess.
let sdkFactory = twilio;

// Baut genau den Client wie bisher: SID + Token + Edge aus der zentralen Config.
export function twilioClient() {
  if (!client) client = sdkFactory(config.twilioSid, config.twilioToken, { edge: config.twilioEdge });
  return client;
}

// TEST-ONLY: injiziert eine Fake-SDK-Factory und verwirft den memoisierten Client, sodass
// der naechste twilioClient()-Aufruf die Fake-Factory nutzt. Liefert eine restore()-Funktion,
// die Factory UND memoisierten Client exakt auf den vorherigen Stand zuruecksetzt (im finally
// aufzurufen). Nie im Produktionspfad erreicht (kein Toggle) - Verhalten dort byte-identisch.
export function __setTwilioSdkFactoryForTest(factory) {
  const prevFactory = sdkFactory;
  const prevClient = client;
  sdkFactory = factory;
  client = null;
  return () => {
    sdkFactory = prevFactory;
    client = prevClient;
  };
}
