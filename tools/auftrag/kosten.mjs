import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TRANSKRIPT_ENDUNG = ".jsonl";
const NICHT_ALPHANUMERISCH = /[^A-Za-z0-9]/g;
const ZAEHLER = {
  cacheRead: "cache_read_input_tokens",
  cacheWrite: "cache_creation_input_tokens",
  input: "input_tokens",
  output: "output_tokens",
};

function leer() {
  return { turns: 0, cacheRead: 0, cacheWrite: 0, input: 0, output: 0, gesamt: 0 };
}

export function transkriptVerzeichnis(root) {
  return join(homedir(), ".claude", "projects", root.replace(NICHT_ALPHANUMERISCH, "-"));
}

function transkripteDerSitzung(verzeichnis, sitzung) {
  const haupt = join(verzeichnis, `${sitzung}${TRANSKRIPT_ENDUNG}`);
  const unter = join(verzeichnis, sitzung);
  const weitere = existsSync(unter)
    ? readdirSync(unter, { recursive: true })
        .filter((name) => name.endsWith(TRANSKRIPT_ENDUNG))
        .map((name) => join(unter, name))
    : [];
  return [haupt, ...weitere].filter((datei) => existsSync(datei));
}

function verbrauchJeAntwort(datei) {
  const jeAntwort = new Map();
  readFileSync(datei, "utf8")
    .split("\n")
    .forEach((zeile, nummer) => {
      let satz;
      try {
        satz = JSON.parse(zeile);
      } catch {
        return;
      }
      const verbrauch = satz?.message?.usage ?? satz?.usage;
      if (!verbrauch || typeof verbrauch !== "object") return;
      jeAntwort.set(satz.message?.id ?? `${datei}:${nummer}`, verbrauch);
    });
  return [...jeAntwort.values()];
}

function addiere(summe, verbrauch) {
  const neu = { ...summe, turns: summe.turns + 1 };
  for (const [feld, schluessel] of Object.entries(ZAEHLER)) neu[feld] += verbrauch[schluessel] ?? 0;
  neu.gesamt = neu.cacheRead + neu.cacheWrite + neu.input + neu.output;
  return neu;
}

export function kostenDerSitzung(root, { rolle, sitzung }) {
  const dateien = transkripteDerSitzung(transkriptVerzeichnis(root), sitzung);
  const summe = dateien.flatMap(verbrauchJeAntwort).reduce(addiere, leer());
  return { rolle, sitzung, gemessen: dateien.length > 0, ...summe };
}

export function kostenDesAuftrags(root, agenten) {
  const sitzungen = agenten.map((agent) => kostenDerSitzung(root, agent));
  const gemessen = sitzungen.length > 0 && sitzungen.every((sitzung) => sitzung.gemessen);
  const summe = sitzungen.reduce(
    (gesamt, sitzung) => {
      const neu = { ...gesamt };
      for (const feld of Object.keys(gesamt)) neu[feld] += sitzung[feld];
      return neu;
    },
    leer(),
  );
  return { gemessen, sitzungen, summe };
}
