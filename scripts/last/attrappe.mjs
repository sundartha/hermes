import { starteAnrufstartAttrappe } from "../../test/anrufe/elevenlabs-anrufstart-attrappe.js";
import { starteAttrappe } from "../../test/anrufe/attrappen-server.js";
import { abrufMitFrist } from "../../test/gemeinsam/antwortfrist.mjs";
import { echtWarten } from "../../test/echt-warten.js";

const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 500;
const WAHL_PFAD = "/v2/calls";
const KONVERSATION_PFAD = "/v1/convai/conversations/";
const KONVERSATION_VORSATZ = "conv_";
const VORSPANN_VORSATZ = "vorspann-";
const EL_BEIN_ENDUNG = "-el";
const PROZENT = 100;
const GESPRAECH_DAUER_S = 30;
const ABSCHIED = [{ role: "agent", message: "Auf Wiederhoeren." }];

export const ANBIETER_VERHALTEN = Object.freeze({
  verzoegerungMs: 40,
  gespraechMs: 1500,
  fehlerJeHundertAbfragen: 2,
});

export async function starteLastAttrappe({ signer, verhalten = ANBIETER_VERHALTEN }) {
  const anbieter = await starteAnrufstartAttrappe({ signer });
  const begonnen = new Map();
  const aufgelegt = new Set();
  let abfragen = 0;
  const antworte = (res, status, { typ, koerper }) => {
    res.writeHead(status, { "content-type": typ });
    res.end(koerper);
  };
  const antworteJson = (res, status, koerper) => antworte(res, status, { typ: "application/json", koerper: JSON.stringify(koerper) });
  const leiteWeiter = async (req, res, roh) => {
    const antwort = await abrufMitFrist(anbieter.url + req.url, {
      method: req.method,
      headers: { "content-type": "application/json" },
      body: req.method === "GET" ? undefined : roh,
    });
    antworte(res, antwort.status, { typ: antwort.headers.get("content-type"), koerper: Buffer.from(await antwort.arrayBuffer()) });
  };
  const legeAufNachGespraech = (callId) =>
    setTimeout(() => {
      if (aufgelegt.has(callId)) return;
      aufgelegt.add(callId);
      anbieter.legtAuf(`${KONVERSATION_VORSATZ}${callId}`).catch(() => aufgelegt.delete(callId));
    }, verhalten.gespraechMs);
  const merkeBeginn = (roh) => {
    const befehl = JSON.parse(roh || "{}").command_id ?? "";
    if (!befehl.startsWith(VORSPANN_VORSATZ) || befehl.endsWith(EL_BEIN_ENDUNG)) return;
    const callId = befehl.slice(VORSPANN_VORSATZ.length);
    begonnen.set(callId, Date.now());
    legeAufNachGespraech(callId);
  };
  const fehlerFaellig = () => {
    abfragen += 1;
    return (abfragen * verhalten.fehlerJeHundertAbfragen) % PROZENT < verhalten.fehlerJeHundertAbfragen;
  };
  const beantworteKonversation = async (req, res, roh) => {
    if (fehlerFaellig()) return antworteJson(res, HTTP_SERVER_ERROR, { detail: "lastlauf: erzwungener Fehler" });
    const konversation = req.url.slice(KONVERSATION_PFAD.length);
    const callId = konversation.slice(KONVERSATION_VORSATZ.length);
    const fertig = Date.now() - (begonnen.get(callId) ?? Date.now()) >= verhalten.gespraechMs;
    if (!fertig) return leiteWeiter(req, res, roh);
    if (!aufgelegt.has(callId)) {
      aufgelegt.add(callId);
      await anbieter.legtAuf(konversation);
    }
    return antworteJson(res, HTTP_OK, {
      conversation_id: konversation,
      status: "done",
      transcript: ABSCHIED,
      analysis: null,
      metadata: { call_duration_secs: GESPRAECH_DAUER_S, error: null },
    });
  };
  const behandle = async (req, res, roh) => {
    await echtWarten(verhalten.verzoegerungMs);
    if (req.url === WAHL_PFAD) merkeBeginn(roh);
    if (req.method === "GET" && req.url.startsWith(KONVERSATION_PFAD)) return beantworteKonversation(req, res, roh);
    return leiteWeiter(req, res, roh);
  };
  const meldeFehler = (fehler) => console.error("[lastlauf] attrappe:", fehler.message);
  const vorgeschaltet = await starteAttrappe((req, res) => {
    let roh = "";
    req.on("data", (stueck) => (roh += stueck));
    req.on("end", () => behandle(req, res, roh).catch(meldeFehler));
  });
  return {
    url: vorgeschaltet.url,
    verbinde: anbieter.verbinde,
    legtAuf: anbieter.legtAuf,
    close: async () => {
      await vorgeschaltet.close();
      await anbieter.schliessen();
    },
  };
}
