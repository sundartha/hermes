import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { git } from "../warteschlange/gleicher-stand.mjs";

const PROTOKOLLZEILE =
  /^(?:\S+ )?Übernahme-Festhaltung (\S+): Prüfsumme ([0-9a-f]{64}) Baum ([0-9a-f]{40}) Node (\S+) Image (\S+) Wackelig (\d+)\s*$/;

export function pruefsumme(inhalt) {
  return createHash("sha256").update(inhalt).digest("hex");
}

export function laufKennung({ version, umgebung }) {
  const { ImageOS: system, ImageVersion: abbild } = umgebung;
  if (!system || !abbild) return null;
  return { node: version, image: `${system}-${abbild}` };
}

export function festhaltungsZeile({ name, summe, baum, kennung, wackelig }) {
  return `Übernahme-Festhaltung ${name}: Prüfsumme ${summe} Baum ${baum} Node ${kennung.node} Image ${kennung.image} Wackelig ${wackelig}`;
}

export function festhaltungImProtokoll(protokoll, name) {
  const treffer = protokoll
    .split("\n")
    .map((zeile) => PROTOKOLLZEILE.exec(zeile))
    .filter((gefunden) => gefunden !== null && gefunden[1] === name);
  if (treffer.length !== 1) return undefined;
  const [, , summe, baum, node, image, wackelig] = treffer[0];
  return { summe, baum, kennung: { node, image }, wackelig: Number(wackelig) };
}

export function wackeligeDateien(pfad) {
  if (!existsSync(pfad)) return 0;
  return JSON.parse(readFileSync(pfad, "utf8")).wackelig?.length ?? 0;
}

export function geprueftBaum(wurzel) {
  return git(["rev-parse", "HEAD^{tree}"], { root: wurzel }).trim();
}
