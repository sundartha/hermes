import { starteAttrappe } from "../../test/anrufe/attrappen-server.js";
import { echtWarten } from "../../test/echt-warten.js";
import { CONVERSATION_IN_PROGRESS } from "../../test/fixtures/elevenlabs-conversations.js";

const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 500;
const START_PFAD = "/v1/convai/sip-trunk/outbound-call";
const KONVERSATION_PFAD = "/v1/convai/conversations/";
const PROZENT = 100;
const GESPRAECH_DAUER_S = 30;
const ABSCHIED = [{ role: "agent", message: "Auf Wiederhoeren." }];

export const ANBIETER_VERHALTEN = Object.freeze({
  verzoegerungMs: 40,
  gespraechMs: 1500,
  fehlerJeHundertAbfragen: 2,
});

export async function starteLastAttrappe(verhalten = ANBIETER_VERHALTEN) {
  const begonnen = new Map();
  let abfragen = 0;
  const antworte = (res, status, koerper) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(koerper));
  };
  const abfrage = (res, id) => {
    abfragen += 1;
    if ((abfragen * verhalten.fehlerJeHundertAbfragen) % PROZENT < verhalten.fehlerJeHundertAbfragen)
      return antworte(res, HTTP_SERVER_ERROR, { detail: "lastlauf: erzwungener Fehler" });
    const fertig = Date.now() - begonnen.get(id) >= verhalten.gespraechMs;
    if (!fertig) return antworte(res, HTTP_OK, { ...CONVERSATION_IN_PROGRESS, conversation_id: id });
    return antworte(res, HTTP_OK, {
      conversation_id: id,
      status: "done",
      transcript: ABSCHIED,
      analysis: null,
      metadata: { call_duration_secs: GESPRAECH_DAUER_S, error: null },
    });
  };
  const behandle = async (req, res) => {
    await echtWarten(verhalten.verzoegerungMs);
    if (req.url.startsWith(START_PFAD)) {
      const id = `conv_last_${begonnen.size}`;
      begonnen.set(id, Date.now());
      return antworte(res, HTTP_OK, { success: true, conversation_id: id, sip_call_id: "sip_last" });
    }
    if (req.method === "GET") return abfrage(res, req.url.slice(KONVERSATION_PFAD.length));
    return antworte(res, HTTP_OK, {});
  };
  return starteAttrappe((req, res) => {
    req.resume();
    req.on("end", () => behandle(req, res));
  });
}
