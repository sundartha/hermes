import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

export const BRANCH_PRAEFIX = "ausmisten/";
export const BEREICHE_DATEI = "tools/bereiche.json";
export const GATE_DATEI = "tools/gate-tests.json";
export const TESTORDNER = "test/";
export const UNTERDRUECKUNGEN = "eslint-suppressions.json";
const GESPERRTE_TESTPFADE = [
  "test/werkzeuge/",
  "test/sicherheit/",
  "test/testbaenke-run.mjs",
  "test/i18n-catalog-run.mjs",
];
const GESPERRTE_MODI = new Set(["120000", "160000"]);
const STATUS_GELOESCHT = "D";
const RAW_KOPF = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])\d*$/;
const MAX_GIT_AUSGABE = 268_435_456;
export const QUELLDATEI = /^src\/.+\.[cm]?[jt]s$/;
const FELDER_JE_AENDERUNG = 2;

export function gitLauf(args, verzeichnis, eingabe) {
  return spawnSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd: verzeichnis,
    encoding: "utf8",
    input: eingabe,
    maxBuffer: MAX_GIT_AUSGABE,
  });
}

export function git(args, verzeichnis, eingabe) {
  const lauf = gitLauf(args, verzeichnis, eingabe);
  if (lauf.status !== 0) throw new Error(`git ${args.join(" ")}: ${lauf.stderr.trim()}`);
  return lauf.stdout;
}

export function gitGelingt(args, verzeichnis) {
  return gitLauf(args, verzeichnis).status === 0;
}

export function leseBereiche() {
  const bereiche = JSON.parse(readFileSync(BEREICHE_DATEI, "utf8"));
  for (const eintrag of bereiche) {
    eintrag.muster = [];
    for (const quelle of eintrag.quellen) eintrag.muster.push(new RegExp(quelle));
  }
  return bereiche;
}

export function bereichAusBranch(branch, bereiche) {
  if (typeof branch !== "string") return undefined;
  return bereiche.find(
    ({ bereich, quellen }) => quellen.length > 0 && branch === `${BRANCH_PRAEFIX}${bereich}`,
  );
}

export function bereichDerDatei(datei, bereiche) {
  return bereiche.find(({ muster }) => muster.some((regel) => regel.test(datei)))?.bereich;
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

function istEinfachesObjekt(wert) {
  return wert !== null && typeof wert === "object" && !Array.isArray(wert);
}

function gekuerzt(alt, neu) {
  if (Array.isArray(alt) && Array.isArray(neu)) return listeGekuerzt(alt, neu);
  if (!istEinfachesObjekt(alt) || !istEinfachesObjekt(neu)) return isDeepStrictEqual(alt, neu);
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
  if (!istEinfachesObjekt(alt) || !istEinfachesObjekt(neu)) return false;
  return Object.entries(neu).every(
    ([name, anzahl]) =>
      Object.hasOwn(alt, name) && Number.isInteger(anzahl) && anzahl > 0 && anzahl <= alt[name],
  );
}

const NUR_KUERZEN = new Map([
  ["tools/basis/test-importe.json", gekuerzt],
  ["tools/basis/selbstpruefung.json", gekuerzt],
  ["tools/basis/fester-importpfad.json", gekuerzt],
  ["tools/basis/keine-speicher-attrappe.json", gekuerzt],
  ["tools/basis/anfrage-mit-frist.json", gekuerzt],
  ["tools/basis/zeitglieder-bestand.json", zaehlerGekuerzt],
]);

function nurGekuerzt(altText, neuText, kuerzung) {
  const [alt, neu] = [alsJson(altText), alsJson(neuText)];
  if (alt === undefined || neu === undefined || isDeepStrictEqual(alt.wert, neu.wert)) return false;
  return kuerzung(alt.wert, neu.wert);
}

function bestandsVerstoss({ status, pfad }, { von, bis, verzeichnis }) {
  if (status !== "M")
    return `${pfad}: Bestandsdateien dürfen weder neu entstehen noch verschwinden.`;
  const text = (commit) => git(["show", `${commit}:${pfad}`], verzeichnis);
  if (nurGekuerzt(text(von), text(bis), NUR_KUERZEN.get(pfad))) return undefined;
  return `${pfad}: die Bestandsdatei darf nur Einträge verlieren.`;
}

function ohneZahl(eintrag) {
  return { ...eintrag, count: 0 };
}

function regelVergleich({ datei, regel, vorher, nachher }) {
  if (!Object.hasOwn(nachher, regel)) {
    return { senkung: { datei, regel, vorher: vorher[regel]?.count, nachher: 0 } };
  }
  const [alt, neu] = [vorher[regel]?.count, nachher[regel]?.count];
  const restGleich = isDeepStrictEqual(ohneZahl(vorher[regel]), ohneZahl(nachher[regel]));
  if (!restGleich || !Number.isInteger(neu) || neu <= 0 || neu > alt) {
    return { verstoss: `${UNTERDRUECKUNGEN}: ${datei} ${regel} darf nur sinken.` };
  }
  return neu < alt ? { senkung: { datei, regel, vorher: alt, nachher: neu } } : {};
}

function dateiVergleich(datei, { alt, neu, eigene }) {
  if (isDeepStrictEqual(alt[datei], neu[datei])) return [];
  if (!Object.hasOwn(alt, datei))
    return [{ verstoss: `${UNTERDRUECKUNGEN}: neuer Eintrag für ${datei}.` }];
  if (!eigene.has(datei))
    return [
      {
        verstoss: `${UNTERDRUECKUNGEN}: ${datei} ändert der Branch nicht; ihr Eintrag muss bleiben.`,
      },
    ];
  const [vorher, nachher] = [alt[datei], neu[datei] ?? {}];
  const neueRegeln = Object.keys(nachher).filter((regel) => !Object.hasOwn(vorher, regel));
  return [
    ...neueRegeln.map((regel) => ({
      verstoss: `${UNTERDRUECKUNGEN}: neue Regel ${regel} für ${datei}.`,
    })),
    ...Object.keys(vorher).map((regel) => regelVergleich({ datei, regel, vorher, nachher })),
  ];
}

function unterdrueckungsVergleich({ von, bis, verzeichnis, eigene }) {
  const text = (commit) => git(["show", `${commit}:${UNTERDRUECKUNGEN}`], verzeichnis);
  const [alt, neu] = [alsJson(text(von))?.wert, alsJson(text(bis))?.wert];
  if (!istEinfachesObjekt(alt) || !istEinfachesObjekt(neu)) {
    return { verstoesse: [`${UNTERDRUECKUNGEN}: die Datei ist kein JSON-Objekt.`], senkungen: [] };
  }
  const dateien = [...new Set([...Object.keys(alt), ...Object.keys(neu)])].sort();
  const teile = dateien.flatMap((datei) => dateiVergleich(datei, { alt, neu, eigene }));
  return {
    verstoesse: teile.map(({ verstoss }) => verstoss).filter(Boolean),
    senkungen: teile.map(({ senkung }) => senkung).filter(Boolean),
  };
}

function eigeneTestdateien(liste) {
  return new Set(liste.filter(({ pfad }) => testpfadFrei(pfad)).map(({ pfad }) => pfad));
}

function aenderungsVerstoss(aenderung, stand) {
  const { status, pfad, modi } = aenderung;
  if (status === undefined) return `${pfad}: die Änderung ist nicht lesbar.`;
  if (modi.some((modus) => GESPERRTE_MODI.has(modus))) {
    return `${pfad}: Symlinks und Submodule sind beim Ausmisten gesperrt.`;
  }
  if (NUR_KUERZEN.has(pfad)) return bestandsVerstoss(aenderung, stand);
  if (pfad === UNTERDRUECKUNGEN) {
    if (status !== "M") return `${pfad}: die Datei darf weder neu entstehen noch verschwinden.`;
    const { verstoesse } = unterdrueckungsVergleich(stand);
    return verstoesse.length > 0 ? verstoesse.join("\n") : undefined;
  }
  if (!testpfadFrei(pfad)) {
    return `${pfad}: beim Ausmisten sind nur Dateien unter test/ erlaubt, nicht unter test/werkzeuge/ oder test/sicherheit/ und nicht die Testbank-Skripte.`;
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
  const stand = { von, bis, verzeichnis, gates, eigene: eigeneTestdateien(liste) };
  return liste.map((aenderung) => aenderungsVerstoss(aenderung, stand)).filter(Boolean);
}

export function gesenkteUnterdrueckungen({ von, bis, verzeichnis }) {
  const liste = aenderungen(von, bis, verzeichnis);
  if (!liste.some(({ pfad, status }) => pfad === UNTERDRUECKUNGEN && status === "M")) return [];
  const eigene = eigeneTestdateien(liste);
  return unterdrueckungsVergleich({ von, bis, verzeichnis, eigene }).senkungen;
}

export function testaenderungen(von, bis, verzeichnis) {
  const liste = aenderungen(von, bis, verzeichnis).filter(({ pfad }) => testpfadFrei(pfad));
  return liste.map(({ pfad }) => pfad);
}
