import assert from "node:assert/strict";

import { CONVERSATION_IN_PROGRESS } from "../fixtures/elevenlabs-conversations.js";
import { starteAttrappe } from "./attrappen-server.js";

const HTTP_OK = 200;
const START_PFAD = "/v1/convai/sip-trunk/outbound-call";
const KONVERSATION_PFAD = "/v1/convai/conversations/";

export async function starteAnrufstartAttrappe() {
  const anfragen = [];
  const naechsteKonversation = () => `conv_gw0_${anfragen.length}`;
  const attrappe = await starteAttrappe((req, res) => {
    let roh = "";
    req.on("data", (stueck) => (roh += stueck));
    req.on("end", () => {
      anfragen.push({ methode: req.method, pfad: req.url, body: JSON.parse(roh || "{}") });
      const antwort = req.url.startsWith(START_PFAD)
        ? { success: true, conversation_id: naechsteKonversation(), sip_call_id: "sip_gw0" }
        : { ...CONVERSATION_IN_PROGRESS, conversation_id: req.url.slice(KONVERSATION_PFAD.length) };
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(JSON.stringify(antwort));
    });
  });
  return {
    url: attrappe.url,
    starts: () => anfragen.filter((a) => a.methode === "POST" && a.pfad.startsWith(START_PFAD)),
    beendetGespraech: (konversation) => {
      assert.ok(konversation, "ohne Gespraechs-ID laesst sich das Beenden keinem Anruf zuordnen");
      return anfragen.some((a) => a.methode === "DELETE" && a.pfad === KONVERSATION_PFAD + konversation);
    },
    schliessen: attrappe.close,
  };
}
