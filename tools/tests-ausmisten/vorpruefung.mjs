import { MUTANTEN_ZUSTAND } from "../mutationspruefung/zustand.mjs";
import { git } from "./pfade.mjs";

const GLOBAL = String.raw`(?:globalThis|global|process\s*\.\s*env)`;
const ZEILENMUSTER = [
  { muster: new RegExp(String.raw`\b${GLOBAL}\s*(?:\?\.\s*)?\[`), grund: "berechneter Schlüssel" },
  {
    muster: new RegExp(
      String.raw`\b(?:Object\s*\.\s*(?:keys|values|entries|assign|getOwnPropertyNames|getOwnPropertyDescriptors?)|Reflect\s*\.\s*(?:ownKeys|get|has|getOwnPropertyDescriptor)|JSON\s*\.\s*stringify)\s*\(\s*(?:\{\s*\.\.\.\s*)?${GLOBAL}\b`,
    ),
    grund: "Aufzählung",
  },
  { muster: new RegExp(String.raw`\bfor\s*\([^)]*\bin\s+${GLOBAL}\b`), grund: "Aufzählung" },
  {
    muster: new RegExp(
      String.raw`(?:^|[=(,:?]|=>|\breturn\b|\.\.\.)\s*(?:globalThis|process\s*\.\s*env)\s*(?:[;,)\]}]|$)`,
    ),
    grund: "Weitergabe als Wert",
  },
  { muster: /["']node:process["']|require\s*\(\s*["']process["']\s*\)/, grund: "node:process" },
  { muster: /\/proc\//, grund: "/proc/" },
  { muster: /\bprintenv\b|["'`]env["'`]/, grund: "Umgebung über ein Programm" },
];
const NICHT_BEZEICHNER = /[^A-Za-z0-9_]/g;
const DIFF_KOPF = "diff --git ";
const NEUE_DATEI = "+++ ";
const NEUE_DATEI_PFAD = /^\+\+\+ b\/(.+)$/;
const KEINE_DATEI = "+++ /dev/null";
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const HINZU = "+";
const BINAER = "-";
const ZUSATZ =
  ". Ein Test darf weder erkennen, ob ein Mutant aktiv ist, noch Umgebung oder globale Werte durchsuchen.";

function kopfzeile(zustand, text) {
  const hunk = HUNK.exec(text);
  if (hunk) return { ...zustand, imKopf: false, zeile: Number(hunk[1]) };
  if (!text.startsWith(NEUE_DATEI)) return zustand;
  if (text === KEINE_DATEI) return { ...zustand, datei: null };
  const pfad = NEUE_DATEI_PFAD.exec(text)?.[1];
  if (pfad === undefined)
    zustand.unlesbar.push(`${text.slice(NEUE_DATEI.length)}: Dateiname nicht lesbar`);
  return { ...zustand, datei: pfad ?? null };
}

function hinzugefuegteZeilen(diff) {
  const jeDatei = new Map();
  let zustand = { datei: null, imKopf: false, zeile: 0, unlesbar: [] };
  for (const text of diff.split("\n")) {
    if (text.startsWith(DIFF_KOPF)) zustand = { ...zustand, datei: null, imKopf: true };
    else if (zustand.imKopf || HUNK.test(text)) zustand = kopfzeile(zustand, text);
    else if (zustand.datei !== null && text.startsWith(HINZU)) {
      const liste = jeDatei.get(zustand.datei) ?? [];
      liste.push({ zeile: zustand.zeile, text: text.slice(HINZU.length) });
      jeDatei.set(zustand.datei, liste);
      zustand = { ...zustand, zeile: zustand.zeile + 1 };
    }
  }
  return { jeDatei, unlesbar: zustand.unlesbar };
}

function strykerZustand(text) {
  return MUTANTEN_ZUSTAND.some((muster) => muster.test(text));
}

function gruendeDer(text) {
  if (strykerZustand(text)) return ["Strykers Zustand"];
  return ZEILENMUSTER.filter(({ muster }) => muster.test(text)).map(({ grund }) => grund);
}

function dateiBefunde(datei, zeilen) {
  const befunde = zeilen.flatMap(({ zeile, text }) =>
    gruendeDer(text).map((grund) => `${datei}:${zeile}: ${grund}`),
  );
  const verdichtet = zeilen.map(({ text }) => text.replace(NICHT_BEZEICHNER, "")).join("");
  if (befunde.length === 0 && strykerZustand(verdichtet)) {
    befunde.push(`${datei}: zusammengesetzt ergeben die hinzugefügten Zeilen Strykers Zustand`);
  }
  return befunde;
}

function binaerdateien({ von, bis, verzeichnis }) {
  const zeilen = git(
    ["diff", "--numstat", "--no-renames", "-z", von, bis, "--", "test/"],
    verzeichnis,
  )
    .split("\0")
    .filter(Boolean);
  return zeilen
    .filter((zeile) => zeile.startsWith(`${BINAER}\t${BINAER}\t`))
    .map((zeile) => `${zeile.split("\t").at(-1)}: Binärdateien sind beim Ausmisten gesperrt`);
}

export function vorpruefung(stand) {
  const diff = git(
    [
      "diff",
      "-U0",
      "--no-renames",
      "--no-color",
      "--no-ext-diff",
      stand.von,
      stand.bis,
      "--",
      "test/",
    ],
    stand.verzeichnis,
  );
  const { jeDatei, unlesbar } = hinzugefuegteZeilen(diff);
  const befunde = [...[...jeDatei].flatMap(([datei, zeilen]) => dateiBefunde(datei, zeilen))];
  return [...unlesbar, ...binaerdateien(stand), ...befunde].map((befund) => `${befund}${ZUSATZ}`);
}
