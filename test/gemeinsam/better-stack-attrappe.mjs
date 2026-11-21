import { EventEmitter } from "node:events";
import { starteAttrappe } from "../anrufe/attrappen-server.js";
import { ANTWORTFRIST_MS, abrufMitFrist, fristSignal } from "./antwortfrist.mjs";

const HTTP_OK = 200;

export async function starteBetterStackAttrappe({ antwortStatus = HTTP_OK, halten = false } = {}) {
  const meldungen = [];
  const wartende = [];
  const schranken = [];
  const gehalten = [];
  const ereignisse = new EventEmitter();
  const attrappe = await starteAttrappe((anfrage, antwort) => {
    let roh = "";
    anfrage.on("data", (teil) => (roh += teil));
    anfrage.on("end", () => {
      const koerper = JSON.parse(roh);
      const antworten = () => antwort.writeHead(antwortStatus).end();
      if (halten && !koerper.schranke) gehalten.push(antworten);
      else antworten();
      if (koerper.schranke) return schranken.shift()();
      const { id, status } = koerper.incident;
      meldungen.push({ methode: anfrage.method, contentType: anfrage.headers["content-type"], koerper, id, status, text: koerper.text });
      ereignisse.emit("aenderung");
      for (const wartender of wartende.filter((eintrag) => meldungen.length >= eintrag.anzahl)) wartender.bereit(meldungen);
    });
  });
  const url = `${attrappe.url}/geheimer-eingang-q7x9`;
  const aufMeldungen = (anzahl) =>
    meldungen.length >= anzahl
      ? Promise.resolve(meldungen)
      : new Promise((bereit, abgelehnt) => {
          wartende.push({ anzahl, bereit });
          fristSignal().addEventListener("abort", () =>
            abgelehnt(new Error(`${anzahl} Meldung(en) erwartet, nach ${ANTWORTFRIST_MS} ms ${meldungen.length} erhalten`)),
          );
        });
  const schranke = () =>
    new Promise((bereit) => {
      schranken.push(bereit);
      abrufMitFrist(url, { method: "POST", body: JSON.stringify({ schranke: true }) });
    });
  const freigeben = () => gehalten.splice(0).forEach((antworten) => antworten());
  return { url, ereignisse, meldungen, aufMeldungen, schranke, freigeben, close: attrappe.close };
}
