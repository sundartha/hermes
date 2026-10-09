import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { IDS, befund } from "./befunde.mjs";
import { BLOCKIERT, WEITER, ergebnisVon, leseJson, schreibeJson, setzeAusgaben } from "./ausgabe.mjs";
import {
  MIN_AGENT_SEKUNDEN,
  agentBefehl,
  budgetFehlt,
  budgetMinuten,
  istWartend,
  nimmToken,
  restSekunden,
  starteAgent,
} from "./agent.mjs";
import { BUDGET_NAME, FIXER_PATCH } from "./fixer.mjs";
import { patchPruefsumme, schreibePatch, wendeAn } from "./patch.mjs";
import { DATEI as VORPRUEFUNG, ORDNER } from "./vorpruefen.mjs";
import { DATEI as ZIEL } from "./waehlen.mjs";

export const AGENT_ORDNER = "agent";
export const AGENT_DATEI = "agent.json";
export const AGENT_PATCH = "agent.patch";
const PROMPT = "tools/ziele/aufraeumen-agent.md";
const WERKZEUGE = "Read,Edit,Grep,Glob";
const MODELL = "sonnet";
const MAX_PFAD = 300;
const MAX_BEHOBEN = 50;
const ZEITABLAUF = "Zeitablauf";
const TOKEN_IM_PATCH = "Patch enthielt das Token";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const FELDER = ["behobeneBefunde", "datei", "geaendert", "sorte"];
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: FELDER,
  properties: {
    geaendert: { type: "boolean" },
    datei: { type: "string", maxLength: MAX_PFAD },
    sorte: { type: "string", enum: ["knip", "jscpd", "altfunktion"] },
    behobeneBefunde: { type: "array", maxItems: MAX_BEHOBEN, items: { type: "string", maxLength: MAX_PFAD } },
  },
};

export function gueltigeAntwort(wert, ziel) {
  if (wert === null || typeof wert !== "object" || Array.isArray(wert)) return null;
  const felder = Object.keys(wert).sort().join(",") === FELDER.join(",");
  const liste = Array.isArray(wert.behobeneBefunde) && wert.behobeneBefunde.length <= MAX_BEHOBEN;
  const passend = wert.datei === ziel.datei && wert.sorte === ziel.sorte && typeof wert.geaendert === "boolean";
  return felder && liste && passend ? wert : null;
}

export function auftragstext(ziel) {
  return [
    `Ziel: ${ziel.datei}`,
    `Datei im Arbeitsordner: ${basename(ziel.datei)}`,
    `Sorte: ${ziel.sorte}`,
    "Befunde, die nach den Fixern noch übrig sind oder deren Reste du entfernen sollst:",
    ...ziel.zielbefunde.map((text) => `- ${text}`),
    `Ändere nur ${basename(ziel.datei)}. Antworte mit dem JSON nach dem vorgegebenen Schema; datei ist ${ziel.datei}, sorte ist ${ziel.sorte}.`,
    "",
  ].join("\n");
}

export function ergebnisDesAgenten(ziel, lauf) {
  const zaehler = { tokens: lauf.tokens, zuege: lauf.zuege };
  if (!lauf.grund) return { ...ergebnisVon(WEITER, ""), ...zaehler, antwort: lauf.antwort };
  const ergebnis = { ...ergebnisVon(BLOCKIERT, `Agent: ${lauf.grund}`), ...zaehler };
  if (istWartend(lauf.grund)) return ergebnis;
  const text = `Der Aufräum-Agent für ${ziel.sorte} in ${ziel.datei} ist ohne gültiges Ergebnis geendet: ${lauf.grund}.`;
  if (lauf.grund === ZEITABLAUF) return { ...ergebnis, befunde: [befund(IDS.zeit, ziel.datei, text)] };
  if (lauf.budget) return { ...ergebnis, befunde: [befund(IDS.budget, ziel.datei, text)] };
  return { ...ergebnis, befunde: [befund(IDS.agent, ziel.datei, text)], rot: true };
}

async function inArbeitsordner(root, ziel, ausfuehren) {
  const ordner = mkdtempSync(join(tmpdir(), "ziele-agent-"));
  const kopie = join(ordner, basename(ziel.datei));
  try {
    copyFileSync(join(root, ziel.datei), kopie);
    const lauf = await ausfuehren(ordner);
    copyFileSync(kopie, join(root, ziel.datei));
    return lauf;
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

function zeitrahmen(root, ordner) {
  const minuten = budgetMinuten(root, BUDGET_NAME);
  if (minuten === null) return { fehler: { grund: budgetFehlt(BUDGET_NAME), tokens: 0, zuege: 0 } };
  const start = leseJson(join(ordner, ORDNER), VORPRUEFUNG)?.start ?? new Date().toISOString();
  const sekunden = restSekunden(minuten, { start, jetzt: Date.now() });
  if (sekunden < MIN_AGENT_SEKUNDEN) return { fehler: { grund: `nur noch ${sekunden} s im Budget`, budget: true, tokens: 0, zuege: 0 } };
  return { sekunden };
}

async function fuehreAgentAus({ root, ordner, ziel, token }) {
  const { fehler, sekunden } = zeitrahmen(root, ordner);
  if (fehler) return fehler;
  const befehl = agentBefehl({ werkzeuge: WERKZEUGE, erlaubt: [`Edit(${basename(ziel.datei)})`], modell: MODELL, schema: SCHEMA, prompt: PROMPT });
  return inArbeitsordner(root, ziel, (arbeitsordner) =>
    starteAgent({ root: arbeitsordner, befehl, eingabe: auftragstext(ziel), sekunden, token, pruefeAntwort: (wert) => gueltigeAntwort(wert, ziel) }),
  );
}

function sichererPatch(root, ausgabe, token) {
  const pfad = join(ausgabe, AGENT_PATCH);
  const patch = schreibePatch(root, pfad);
  if (!token || !patch.includes(token)) return { pruefsumme: patchPruefsumme(patch) };
  rmSync(pfad, { force: true });
  return { grund: TOKEN_IM_PATCH };
}

export async function befehl({ ordner }, root) {
  const token = nimmToken();
  const ziel = leseJson(join(ordner, ORDNER), ZIEL);
  if (ziel?.agent !== true) throw new Error("das Ziel verlangt keinen Agenten");
  const ausgabe = join(ordner, AGENT_ORDNER);
  wendeAn(root, join(ordner, ORDNER, FIXER_PATCH));
  const lauf = await fuehreAgentAus({ root, ordner, ziel, token });
  const patch = lauf.grund ? {} : sichererPatch(root, ausgabe, token);
  const { rot, ...ergebnis } = ergebnisDesAgenten(ziel, patch.grund ? { ...lauf, grund: patch.grund } : lauf);
  schreibeJson(ausgabe, AGENT_DATEI, { ...ergebnis, pruefsumme: patch.pruefsumme ?? null });
  setzeAusgaben({ ausgang: ergebnis.ausgang, grund: ergebnis.grund, patch_sha: patch.pruefsumme ?? "" });
  console.log(`Agent: ${ergebnis.ausgang}${ergebnis.grund ? ` (${ergebnis.grund})` : ""}, Tokens ${ergebnis.tokens}, Züge ${ergebnis.zuege}`);
  return rot ? EXIT_ROT : EXIT_GRUEN;
}
