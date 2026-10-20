import { existsSync } from "node:fs";

const JAVASCRIPT = /\.js$/;
const TYPESCRIPT = ".ts";
export const REPO_WURZEL = new URL("../", import.meta.url);

export function vorhandenerPfad(datei, wurzel) {
  if (!JAVASCRIPT.test(datei)) return datei;
  const zwilling = datei.replace(JAVASCRIPT, TYPESCRIPT);
  const nurZwilling = !existsSync(new URL(datei, wurzel)) && existsSync(new URL(zwilling, wurzel));
  return nurZwilling ? zwilling : datei;
}
