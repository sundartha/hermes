import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { env } from "node:process";

const TRANSKRIPT_ENDUNG = ".jsonl";
const NICHT_ALPHANUMERISCH = /[^A-Za-z0-9]/g;
const STANDARD_KONFIGURATION = ".claude";
const HEIMAT = "~";
const UNTER_HEIMAT = /^~[/\\]/;
const ZAEHLER = {
  cacheRead: "cache_read_input_tokens",
  cacheWrite: "cache_creation_input_tokens",
  input: "input_tokens",
  output: "output_tokens",
};

function leer() {
  return { turns: 0, cacheRead: 0, cacheWrite: 0, input: 0, output: 0, gesamt: 0 };
}

function konfigurationsVerzeichnis() {
  const angabe = (env.CLAUDE_CONFIG_DIR ?? "").trim();
  if (angabe === "") return join(homedir(), STANDARD_KONFIGURATION);
  if (angabe === HEIMAT) return homedir();
  if (UNTER_HEIMAT.test(angabe)) return join(homedir(), angabe.slice(HEIMAT.length + 1));
  return resolve(angabe);
}

export function transkriptVerzeichnis(root) {
  const echt = existsSync(root) ? realpathSync(root) : root;
  return join(konfigurationsVerzeichnis(), "projects", echt.replace(NICHT_ALPHANUMERISCH, "-"));
}

export function transkripteDerSitzung(verzeichnis, sitzung) {
  const haupt = join(verzeichnis, `${sitzung}${TRANSKRIPT_ENDUNG}`);
  const unter = join(verzeichnis, sitzung);
  const weitere = existsSync(unter)
    ? readdirSync(unter, { recursive: true })
        .filter((name) => name.endsWith(TRANSKRIPT_ENDUNG))
        .map((name) => join(unter, name))
    : [];
  return [haupt, ...weitere].filter((datei) => existsSync(datei));
}

export function verbrauchJeAntwort(datei) {
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

export function summeDerVerbraeuche(verbraeuche) {
  return verbraeuche.reduce(addiere, leer());
}

export function summeDerDateien(dateien) {
  return summeDerVerbraeuche(dateien.flatMap(verbrauchJeAntwort));
}

export function kostenDerSitzung(root, { rolle, sitzung }) {
  const dateien = transkripteDerSitzung(transkriptVerzeichnis(root), sitzung);
  const summe = summeDerDateien(dateien);
  return { rolle, sitzung, gemessen: dateien.length > 0, ...summe };
}

export function kostenDesAuftrags(root, agenten) {
  const eindeutig = new Map(agenten.map((agent) => [agent.sitzung, agent]));
  const sitzungen = [...eindeutig.values()].map((agent) => kostenDerSitzung(root, agent));
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
