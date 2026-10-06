import { hasInboundNotice } from "./inbound-notice.js";
import { PLACEHOLDER_OPENER } from "../elevenlabs/outbound.js";

export const EROEFFNUNG_DEFEKT = Object.freeze({
  NAMENSSATZ_FEHLT: "namenssatz_fehlt",
  HINWEIS_WORTLAUT_FEHLT: "hinweis_wortlaut_fehlt",
  HINWEIS_MERKMALE_FEHLEN: "hinweis_merkmale_fehlen",
  PLATZHALTER: "platzhalter",
});

const alsText = (wert) => (typeof wert === "string" ? wert : "");

export const EROEFFNUNG_VARIANTE = Object.freeze({ FREMD: "fremd", OWNER: "owner" });

const SOLL_KOPFSATZ = Object.freeze({
  [EROEFFNUNG_VARIANTE.FREMD]: ({ bundle, ownerName }) => bundle.inboundGrussSatz(ownerName),
  [EROEFFNUNG_VARIANTE.OWNER]: ({ bundle, firstName }) => bundle.inboundGrussSatzOwner(firstName),
});

function kopfsatzFehlt({ text, variante, bundle, ownerName, firstName }) {
  const soll = SOLL_KOPFSATZ[variante]?.({ bundle, ownerName, firstName }) ?? "";
  return soll === "" || !text.startsWith(soll);
}

const PRUEFUNGEN = Object.freeze([
  [EROEFFNUNG_DEFEKT.NAMENSSATZ_FEHLT, kopfsatzFehlt],
  [EROEFFNUNG_DEFEKT.HINWEIS_WORTLAUT_FEHLT, ({ text, bundle }) => !text.includes(bundle.inboundHinweisSatz)],
  [EROEFFNUNG_DEFEKT.HINWEIS_MERKMALE_FEHLEN, ({ text }) => !hasInboundNotice(text)],
  [EROEFFNUNG_DEFEKT.PLATZHALTER, ({ text }) => text.includes(PLACEHOLDER_OPENER)],
]);

export function inboundEroeffnungDefekte({ text, bundle, ownerName, firstName, variante }) {
  const eingabe = { text: alsText(text), bundle, ownerName, firstName, variante };
  return PRUEFUNGEN.filter(([, defekt]) => defekt(eingabe)).map(([name]) => name);
}
