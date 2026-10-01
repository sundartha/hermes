import { starteAgent } from "./agenten.mjs";
import { UEBERGABE } from "./verlauf.mjs";

const MS_JE_MINUTE = 60_000;
const WARTEZEIT_OHNE_ANGABE_MINUTEN = 30;
const VORAUSSETZUNG = /^Voraussetzung fehlt:\s*(\S.*)$/m;
const BAU = "bau";
const LESE_WERKZEUGE = ["Read", "Grep", "Glob"];
const LESE_MODELL = "opus";
const OHNE_HOOKS = JSON.stringify({ disableAllHooks: true });
const SCHLAEFER = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
const ERGEBNIS_DES_BAUS = [
  "",
  "## Wenn eine Voraussetzung fehlt",
  "",
  "Geht der Auftrag nur, wenn vorher etwas außerhalb seines Bereichs geändert wird, hörst du auf und antwortest als Letztes mit genau einer Zeile:",
  "Voraussetzung fehlt: <ein Satz, was vorher passieren muss>",
  "",
].join("\n");

const sperre = { bis: 0 };

function warteAufFreigabe() {
  const rest = sperre.bis - Date.now();
  if (rest > 0) Atomics.wait(SCHLAEFER, 0, 0, rest);
}

function sperreWegenLimit({ bis }) {
  const jetzt = Date.now();
  const frei = bis > jetzt ? bis : jetzt + WARTEZEIT_OHNE_ANGABE_MINUTEN * MS_JE_MINUTE;
  sperre.bis = Math.max(sperre.bis, frei);
  return `Nutzungslimit erreicht; das Skript startet neue Agenten erst ab ${new Date(sperre.bis).toISOString()} und macht dann weiter.`;
}

function uebergabe(vorgaenger) {
  if (vorgaenger === null) return "";
  return [
    "",
    "## Übergabe",
    "",
    `Ein früherer Agent hat an diesem Auftrag gearbeitet. Das Skript hat ihn beendet. Grund: ${vorgaenger.grund}`,
    "Seine Änderungen liegen unverändert im Arbeitsbaum; `git status` und `git diff` zeigen sie. Seine letzte Nachricht:",
    "",
    vorgaenger.antwort,
    "",
  ].join("\n");
}

function grundDerSitzung({ limit, aktion }) {
  if (limit) return sperreWegenLimit(limit);
  return aktion?.grund ?? null;
}

function voraussetzung({ rolle, antwort = "" }) {
  return rolle === BAU ? (VORAUSSETZUNG.exec(antwort)?.[1] ?? null) : null;
}

export function setzeEin(kontext, prompt, start) {
  const auftragsPrompt = kontext.rolle === BAU ? `${prompt}${ERGEBNIS_DES_BAUS}` : prompt;
  const sitzungen = [];
  let vorgaenger = null;
  let pruefleiter;
  for (;;) {
    warteAufFreigabe();
    const fortsetzung = vorgaenger === null ? kontext.fortsetzung : undefined;
    const sitzung = starteAgent({ ...kontext, pruefleiter, fortsetzung }, `${auftragsPrompt}${uebergabe(vorgaenger)}`, start);
    const grund = grundDerSitzung(sitzung);
    sitzungen.push(grund ? { ...sitzung, grund } : sitzung);
    if (!sitzung.limit && sitzung.aktion?.art !== UEBERGABE) {
      return { ...sitzung, grund, sitzungen, voraussetzung: voraussetzung(sitzung) };
    }
    vorgaenger = { grund, antwort: sitzung.antwort };
    pruefleiter = sitzung.pruefleiter;
  }
}

export function frage(kontext, prompt) {
  const definition = {
    [kontext.rolle]: {
      description: "Liest das Repo und antwortet mit Text; ändert nichts.",
      prompt: "Du liest nur und antwortest mit Text. Du änderst keine Datei und führst keine Befehle aus.",
      tools: LESE_WERKZEUGE,
      model: LESE_MODELL,
    },
  };
  const argumente = ["--agents", JSON.stringify(definition), "--settings", OHNE_HOOKS, "--tools", LESE_WERKZEUGE.join(",")];
  return setzeEin(kontext, prompt, { agent: kontext.rolle, argumente });
}
