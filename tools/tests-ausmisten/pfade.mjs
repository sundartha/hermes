import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

export const BRANCH_PRAEFIX = "ausmisten/";
export const BEREICHE_DATEI = "tools/bereiche.json";
export const GATE_DATEI = "tools/gate-tests.json";
export const TESTORDNER = "test/";
const ZAEHLER_BESTAND = "tools/basis/zeitglieder-bestand.json";
const NUR_KUERZEN = [
  "tools/basis/test-importe.json",
  "tools/basis/selbstpruefung.json",
  "tools/basis/fester-importpfad.json",
  ZAEHLER_BESTAND,
];
const GESPERRTE_TESTPFADE = [
  "test/werkzeuge/",
  "test/testbaenke-run.mjs",
  "test/i18n-catalog-run.mjs",
];
const GESPERRTE_MODI = new Set(["120000", "160000"]);
const STATUS_GELOESCHT = "D";
const RAW_KOPF = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])\d*$/;
const MAX_GIT_AUSGABE = 268_435_456;
const QUELLDATEI = /^src\/.+\.[cm]?js$/;
const FELDER_JE_AENDERUNG = 2;

export function git(args, verzeichnis, eingabe) {
  const lauf = spawnSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd: verzeichnis,
    encoding: "utf8",
    input: eingabe,
    maxBuffer: MAX_GIT_AUSGABE,
  });
  if (lauf.status !== 0) throw new Error(`git ${args.join(" ")}: ${lauf.stderr.trim()}`);
  return lauf.stdout;
}

export function gitGelingt(args, verzeichnis) {
  return spawnSync("git", args, { cwd: verzeichnis, stdio: "ignore" }).status === 0;
}

export function leseBereiche(wurzel = ".") {
  return JSON.parse(readFileSync(join(wurzel, BEREICHE_DATEI), "utf8"));
}

export function bereichAusBranch(branch, bereiche) {
  if (typeof branch !== "string") return undefined;
  return bereiche.find(
    ({ bereich, quellen }) => quellen.length > 0 && branch === `${BRANCH_PRAEFIX}${bereich}`,
  );
}

export function bereichDerDatei(datei, bereiche) {
  return bereiche.find(({ quellen }) => quellen.some((muster) => new RegExp(muster).test(datei)))
    ?.bereich;
}

export function quellenDesBereichs(bereich, bereiche, dateien) {
  return dateien.filter(
    (datei) => QUELLDATEI.test(datei) && bereichDerDatei(datei, bereiche) === bereich,
  );
}

export function testpfadFrei(pfad) {
  if (!pfad.startsWith(TESTORDNER)) return false;
  return !GESPERRTE_TESTPFADE.some((gesperrt) =>
    gesperrt.endsWith("/") ? pfad.startsWith(gesperrt) : pfad === gesperrt,
  );
}

export function gateDateien(text) {
  return new Set(Object.values(JSON.parse(text)).flatMap(({ tests }) => tests));
}

export function aenderungen(von, bis, verzeichnis) {
  const felder = git(["diff", "--raw", "-z", "--no-renames", "--no-abbrev", von, bis], verzeichnis)
    .split("\0")
    .filter(Boolean);
  const liste = [];
  for (let i = 0; i + 1 < felder.length; i += FELDER_JE_AENDERUNG) {
    const [, altModus, neuModus, status] = RAW_KOPF.exec(felder[i]) ?? [];
    liste.push({ status, pfad: felder[i + 1], modi: [altModus, neuModus] });
  }
  return liste;
}

function listeGekuerzt(alt, neu) {
  let stelle = 0;
  for (const eintrag of neu) {
    while (stelle < alt.length && !isDeepStrictEqual(alt[stelle], eintrag)) stelle += 1;
    if (stelle === alt.length) return false;
    stelle += 1;
  }
  return true;
}

function istObjekt(wert) {
  return wert !== null && typeof wert === "object";
}

function gekuerzt(alt, neu) {
  if (Array.isArray(alt) && Array.isArray(neu)) return listeGekuerzt(alt, neu);
  if (!istObjekt(alt) || !istObjekt(neu) || Array.isArray(alt) || Array.isArray(neu)) {
    return isDeepStrictEqual(alt, neu);
  }
  const schluessel = Object.keys(alt);
  if (!isDeepStrictEqual(schluessel, Object.keys(neu))) return false;
  return schluessel.every((name) => gekuerzt(alt[name], neu[name]));
}

function alsJson(text) {
  try {
    return { wert: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

function zaehlerGekuerzt(alt, neu) {
  if (!istObjekt(alt) || !istObjekt(neu) || Array.isArray(alt) || Array.isArray(neu)) return false;
  return Object.entries(neu).every(
    ([name, anzahl]) =>
      Object.hasOwn(alt, name) && Number.isInteger(anzahl) && anzahl > 0 && anzahl <= alt[name],
  );
}

function nurGekuerzt(altText, neuText, pfad) {
  const [alt, neu] = [alsJson(altText), alsJson(neuText)];
  if (alt === undefined || neu === undefined || isDeepStrictEqual(alt.wert, neu.wert)) return false;
  return pfad === ZAEHLER_BESTAND
    ? zaehlerGekuerzt(alt.wert, neu.wert)
    : gekuerzt(alt.wert, neu.wert);
}

function bestandsVerstoss({ status, pfad }, { von, bis, verzeichnis }) {
  if (status !== "M")
    return `${pfad}: Bestandsdateien dürfen weder neu entstehen noch verschwinden.`;
  const text = (commit) => git(["show", `${commit}:${pfad}`], verzeichnis);
  if (nurGekuerzt(text(von), text(bis), pfad)) return undefined;
  return `${pfad}: die Bestandsdatei darf nur Einträge verlieren.`;
}

function aenderungsVerstoss(aenderung, stand) {
  const { status, pfad, modi } = aenderung;
  if (status === undefined) return `${pfad}: die Änderung ist nicht lesbar.`;
  if (modi.some((modus) => GESPERRTE_MODI.has(modus))) {
    return `${pfad}: Symlinks und Submodule sind beim Ausmisten gesperrt.`;
  }
  if (NUR_KUERZEN.includes(pfad)) return bestandsVerstoss(aenderung, stand);
  if (!testpfadFrei(pfad)) {
    return `${pfad}: beim Ausmisten sind nur Dateien unter test/ erlaubt, nicht unter test/werkzeuge/ und nicht die Testbank-Skripte.`;
  }
  if (status === STATUS_GELOESCHT && stand.gates.has(pfad)) {
    return `${pfad}: Safety-Gate-Tests aus ${GATE_DATEI} dürfen weder gelöscht noch verschoben werden.`;
  }
  return undefined;
}

export function pfadVerstoesse({ von, bis, verzeichnis }) {
  const gates = gateDateien(git(["show", `${von}:${GATE_DATEI}`], verzeichnis));
  const liste = aenderungen(von, bis, verzeichnis);
  if (liste.length === 0) return ["Der Branch ändert nichts gegenüber master."];
  const stand = { von, bis, verzeichnis, gates };
  return liste.map((aenderung) => aenderungsVerstoss(aenderung, stand)).filter(Boolean);
}

export function testaenderungen(von, bis, verzeichnis) {
  const liste = aenderungen(von, bis, verzeichnis).filter(({ pfad }) => testpfadFrei(pfad));
  return liste.map(({ pfad }) => pfad);
}
