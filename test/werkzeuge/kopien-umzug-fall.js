export const WAEHLE = [
  "export function waehle(eintraege, grenze) {",
  "  const treffer = eintraege.filter((eintrag) => eintrag.wert > grenze);",
  "  const sortiert = treffer.toSorted((links, rechts) => links.wert - rechts.wert);",
  "  return sortiert.map((eintrag) => ({ name: eintrag.name, wert: eintrag.wert }));",
  "}",
].join("\n");
export const FREMD = [
  "export function sammle(zeilen, trenner) {",
  "  const teile = zeilen.map((zeile) => String(zeile).trim());",
  "  return teile.filter((teil) => teil.length > 0 && teil !== trenner).join(trenner);",
  "}",
].join("\n");
export const ZWEI = "export function zwei(wert) {\n  return wert * 2;\n}";
export const BLEIBT = "export function bleibt(wert) {\n  return wert;\n}";
export const WEITERGEREICHT = 'export { waehle, zwei } from "./waehlen.js";';
