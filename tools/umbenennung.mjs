import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { posix } from "node:path";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { ESLint } from "eslint";
import { VisitorKeys } from "espree";

import { alleKnoten } from "./eslint-rules/knoten.js";
import { einstellungenFuer, gelesen, gleicherBaum } from "./syntaxbaum.mjs";

const ENDUNGSPAARE = new Map([
  [".js", ".ts"],
  [".mjs", ".mts"],
  [".cjs", ".cts"],
]);
const TYPESCRIPT = /\.([cm]?)ts$/;
const ENDUNG = /\.[cm]?[jt]s$/;
const RELATIVE_QUELLE = /^\.{1,2}\//;
const QUELLKNOTEN = new Set([
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportAllDeclaration",
  "ImportExpression",
]);
const PFADABHAENGIG = { meta: "import", bezeichner: new Set(["__filename", "module"]) };
const FELDER_JE_EINTRAG = 2;
const GELOESCHT = "D";
const HINZUGEFUEGT = "A";
const MAX_GIT_AUSGABE = 268_435_456;
const EXIT_GRUEN = 0;
const EXIT_ABBRUCH = 2;
const GRUND = {
  syntax:
    "TypeScript-Syntax mit Laufzeitwirkung (enum, namespace mit Werten, Parameter-Property, <T>-Assertion, import/export =) oder unlesbar",
  lesbar: "Laufzeitcode nicht lesbar",
  pfad: "Laufzeitcode liest den eigenen Dateipfad (import.meta, __filename, module)",
  geaendert: "Laufzeitcode nach Entfernen der Typen anders als vorher",
};
const AUFRUF = "Aufruf: node tools/umbenennung.mjs --basis <commit> [--bis <commit>]";

function git(args) {
  const lauf = spawnSync("git", args, { encoding: "utf8", maxBuffer: MAX_GIT_AUSGABE });
  if (lauf.status !== 0) throw new Error(`git ${args.join(" ")}: ${lauf.stderr.trim()}`);
  return lauf.stdout;
}

export function inhalt(stand, datei) {
  if (stand === undefined) return existsSync(datei) ? readFileSync(datei, "utf8") : undefined;
  const lauf = spawnSync("git", ["show", `${stand}:${datei}`], {
    encoding: "utf8",
    maxBuffer: MAX_GIT_AUSGABE,
  });
  return lauf.status === 0 ? lauf.stdout : undefined;
}

function aenderungen(von, bis) {
  const felder = git([
    "diff",
    "--no-renames",
    "--name-status",
    "-z",
    von,
    ...(bis ? [bis] : []),
    "--",
  ]).split("\0");
  const nachArt = { [GELOESCHT]: new Set(), [HINZUGEFUEGT]: new Set() };
  for (let index = 0; index + 1 < felder.length; index += FELDER_JE_EINTRAG)
    nachArt[felder[index]]?.add(felder[index + 1]);
  if (bis === undefined) {
    for (const datei of git(["ls-files", "--others", "--exclude-standard", "-z"])
      .split("\0")
      .filter(Boolean)) {
      nachArt[HINZUGEFUEGT].add(datei);
    }
  }
  return nachArt;
}

function typescriptPfad(datei) {
  const endung = ENDUNG.exec(datei)?.[0];
  const neu = ENDUNGSPAARE.get(endung);
  return neu === undefined ? undefined : `${datei.slice(0, -endung.length)}${neu}`;
}

function javascriptPfad(datei) {
  return datei.replace(TYPESCRIPT, ".$1js");
}

export function umbenennungsPaare({ von, bis }) {
  const { [GELOESCHT]: geloescht, [HINZUGEFUEGT]: hinzugefuegt } = aenderungen(von, bis);
  return [...geloescht]
    .map((alt) => ({ alt, neu: typescriptPfad(alt) }))
    .filter(({ neu }) => neu !== undefined && hinzugefuegt.has(neu))
    .sort((links, rechts) => links.alt.localeCompare(rechts.alt));
}

function laufzeitText(datei, text) {
  if (!TYPESCRIPT.test(datei)) return text;
  try {
    return stripTypeScriptTypes(text, { mode: "strip" });
  } catch {
    return undefined;
  }
}

function liestEigenenPfad(baum) {
  return alleKnoten({ ast: baum, visitorKeys: VisitorKeys }).some(
    (knoten) =>
      (knoten.type === "MetaProperty" && knoten.meta.name === PFADABHAENGIG.meta) ||
      (knoten.type === "Identifier" && PFADABHAENGIG.bezeichner.has(knoten.name)),
  );
}

function folgtUmbenennung(baum, datei, altFuer) {
  for (const knoten of alleKnoten({ ast: baum, visitorKeys: VisitorKeys })) {
    const quelle = QUELLKNOTEN.has(knoten.type) ? knoten.source : undefined;
    if (quelle?.type !== "Literal" || typeof quelle.value !== "string") continue;
    const alt = RELATIVE_QUELLE.test(quelle.value)
      ? altFuer.get(posix.join(posix.dirname(datei), quelle.value))
      : undefined;
    if (alt === undefined) continue;
    const [neuEndung, altEndung] = [ENDUNG.exec(quelle.value)[0], ENDUNG.exec(alt)[0]];
    quelle.value = `${quelle.value.slice(0, -neuEndung.length)}${altEndung}`;
    quelle.raw = `${quelle.raw.slice(0, -neuEndung.length - 1)}${altEndung}${quelle.raw.at(-1)}`;
  }
  return baum;
}

async function laufzeitBaeume({ alt, neu }, eslint) {
  const texte = [laufzeitText(alt.pfad, alt.text), laufzeitText(neu.pfad, neu.text)];
  if (texte.includes(undefined)) return { grund: GRUND.syntax };
  const einstellungen = await einstellungenFuer(javascriptPfad(alt.pfad), eslint);
  const baeume = texte.map((text) => gelesen(text, einstellungen));
  if (baeume.includes(undefined)) return { grund: GRUND.lesbar };
  if (alt.pfad !== neu.pfad && baeume.some(liestEigenenPfad)) return { grund: GRUND.pfad };
  return { baeume };
}

export async function laufzeitVergleich({ alt, neu }, { paare = [], eslint = new ESLint() } = {}) {
  const { baeume, grund } = await laufzeitBaeume({ alt, neu }, eslint);
  if (baeume === undefined) return { gleich: false, grund };
  const altFuer = new Map(paare.map(({ alt: vorher, neu: nachher }) => [nachher, vorher]));
  const gleich = gleicherBaum(baeume[0], folgtUmbenennung(baeume[1], neu.pfad, altFuer));
  return gleich ? { gleich } : { gleich, grund: GRUND.geaendert };
}

export async function umbenennungen({ von, bis }, eslint = new ESLint()) {
  const paare = umbenennungsPaare({ von, bis });
  const geprueft = [];
  for (const paar of paare) {
    const [altText, neuText] = [inhalt(von, paar.alt), inhalt(bis, paar.neu)];
    const vergleich =
      altText === undefined || neuText === undefined
        ? { gleich: false, grund: GRUND.lesbar }
        : await laufzeitVergleich(
            { alt: { pfad: paar.alt, text: altText }, neu: { pfad: paar.neu, text: neuText } },
            { paare, eslint },
          );
    geprueft.push({
      ...paar,
      nurTypen: vergleich.gleich,
      ...(vergleich.grund ? { grund: vergleich.grund } : {}),
    });
  }
  return {
    paare: geprueft,
    nurTypen: (neu) => geprueft.find((paar) => paar.neu === neu && paar.nurTypen)?.alt,
    vorher: (alt) => geprueft.find((paar) => paar.alt === alt && paar.nurTypen)?.neu,
    vergleiche: (alt, neu) => laufzeitVergleich({ alt, neu }, { paare, eslint }),
  };
}

function zeile({ alt, neu, nurTypen, grund }) {
  return nurTypen
    ? `${alt} → ${neu}: nur Typen ergänzt, Laufzeitcode gleich.`
    : `${alt} → ${neu}: geändert (${grund}).`;
}

async function main() {
  const { values } = parseArgs({ options: { basis: { type: "string" }, bis: { type: "string" } } });
  if (values.basis === undefined) {
    console.error(AUFRUF);
    return EXIT_ABBRUCH;
  }
  const { paare } = await umbenennungen({ von: values.basis, bis: values.bis });
  if (paare.length === 0) console.log("Keine Umbenennung .js→.ts.");
  for (const paar of paare) console.log(zeile(paar));
  return EXIT_GRUEN;
}

if (import.meta.url === pathToFileURL(realpathSync(argv[1] ?? ".")).href) {
  try {
    process.exitCode = await main();
  } catch (fehler) {
    console.error(`Abbruch: ${fehler.message}`);
    process.exitCode = EXIT_ABBRUCH;
  }
}
