import { EventEmitter } from "node:events";
import { starteAttrappe } from "../anrufe/attrappen-server.js";

export async function starteAnbieterServer(behandle) {
  const anfragen = [];
  const ereignisse = new EventEmitter();
  const vermerke = (eintrag) => {
    anfragen.push(eintrag);
    ereignisse.emit("aenderung");
  };
  const attrappe = await starteAttrappe((req, res) => {
    let body = "";
    req.on("data", (teil) => (body += teil));
    req.on("end", () => behandle({ req, body, res, vermerke }));
  });
  return { ...attrappe, anfragen, ereignisse };
}
