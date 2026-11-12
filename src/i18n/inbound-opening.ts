import { hasInboundNotice } from "./inbound-notice.ts";
import { PLACEHOLDER_OPENER } from "../elevenlabs/outbound.js";

export const EROEFFNUNG_DEFEKT = Object.freeze({
  NAMENSSATZ_FEHLT: "namenssatz_fehlt",
  HINWEIS_WORTLAUT_FEHLT: "hinweis_wortlaut_fehlt",
  HINWEIS_MERKMALE_FEHLEN: "hinweis_merkmale_fehlen",
  PLATZHALTER: "platzhalter",
});

interface Bundle {
  inboundGrussSatz: (name: string) => string;
  inboundGrussSatzOwner: (name: string) => string;
  inboundHinweisSatz: string;
}

interface Eingabe {
  text: string;
  bundle: Bundle;
  ownerName: string;
  firstName: string;
  variante: string;
}

const alsText = (wert: unknown): string => (typeof wert === "string" ? wert : "");

export const EROEFFNUNG_VARIANTE = Object.freeze({ FREMD: "fremd", OWNER: "owner" });

const istFremd = (variante: string): boolean => variante === EROEFFNUNG_VARIANTE.FREMD;

const SOLL_KOPFSATZ: Readonly<Record<string, (sollform: Pick<Eingabe, "bundle" | "ownerName" | "firstName">) => string>> = Object.freeze({
  [EROEFFNUNG_VARIANTE.FREMD]: ({ bundle, ownerName }) => bundle.inboundGrussSatz(ownerName),
  [EROEFFNUNG_VARIANTE.OWNER]: ({ bundle, firstName }) => bundle.inboundGrussSatzOwner(firstName),
});

function kopfsatzFehlt({ text, variante, bundle, ownerName, firstName }: Eingabe): boolean {
  const soll = SOLL_KOPFSATZ[variante]?.({ bundle, ownerName, firstName }) ?? "";
  return soll === "" || !text.startsWith(soll);
}

const PRUEFUNGEN: readonly (readonly [string, (eingabe: Eingabe) => boolean])[] = Object.freeze([
  [EROEFFNUNG_DEFEKT.NAMENSSATZ_FEHLT, kopfsatzFehlt],
  [EROEFFNUNG_DEFEKT.HINWEIS_WORTLAUT_FEHLT, ({ text, bundle, variante }) => istFremd(variante) && !text.includes(bundle.inboundHinweisSatz)],
  [EROEFFNUNG_DEFEKT.HINWEIS_MERKMALE_FEHLEN, ({ text, variante }) => istFremd(variante) && !hasInboundNotice(text)],
  [EROEFFNUNG_DEFEKT.PLATZHALTER, ({ text }) => text.includes(PLACEHOLDER_OPENER)],
]);

export function inboundEroeffnungDefekte(
  { text, bundle, ownerName, firstName, variante }: Omit<Eingabe, "text"> & { text: unknown },
): string[] {
  const eingabe = { text: alsText(text), bundle, ownerName, firstName, variante };
  return PRUEFUNGEN.filter(([, defekt]) => defekt(eingabe)).map(([name]) => name);
}
