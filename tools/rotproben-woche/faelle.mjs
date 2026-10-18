import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ROTPROBEN_DIR, fileText } from "../pruefungen-messen.mjs";
import { rot, technisch } from "./bericht.mjs";
import { befehl, bereinigt, git } from "./git.mjs";

export const PAKET = "20";
const ROTPROBE = fileURLToPath(new URL("../rotprobe.mjs", import.meta.url));
const ZEILENENDE = "\n";
const PR_NUMMER = /^\d+$/;
const TESTDATEI = /\.test\.js$/;
const UNGESCHUETZTE_TESTS = "test/werkzeuge/";
const DATEINAMENTRENNER = "\0";
const PREFIXE = ["--src-prefix=a/", "--dst-prefix=b/"];
const DIFF_MIT_UNTERSCHIED = 1;

export const FAELLE = [
  {
    fall: "lint-fehler",
    datei: "src/billing/provider-enum.js",
    anhang: "// const ALTE_GRENZE = MAX_ENUM_LENGTH;\n",
    workflow: "CI",
    job: "Prüfungen",
    schritt: "Lint",
    pflicht: "CI",
  },
  {
    fall: "lint-konfiguration",
    datei: "eslint.config.js",
    anker: '"no-useless-constructor": "error"',
    ersatz: '"no-useless-constructor": "off"',
    workflow: "Prüfungen prüfen",
    job: "Prüfungen prüfen",
    schritt: "ESLint-Konfiguration, Unterordner und only prüfen",
    pflicht: "Prüfungen prüfen",
  },
  {
    fall: "umgeschriebener-test",
    ordner: "test",
    anker: 'assert.equal(findPlan("nope"), null);',
    ersatz: 'assert.equal(findPlan("gibt-es-nicht"), null);',
    workflow: "Testschutz",
    job: "Testschutz",
    schritt: "Bestehende Tests nur ergänzt",
    pflicht: "Testschutz",
  },
  {
    fall: "geschuetzte-datei",
    datei: ".github/CODEOWNERS",
    anhang: ZEILENENDE,
    workflow: "Freigabe",
    job: "Freigabe-Prüfung",
    schritt: "Freigabe-Prüfung",
    pflicht: "Freigabe-Prüfung",
  },
  {
    fall: "ts-any",
    vorlage: `${ROTPROBEN_DIR}/eslint/ts-any.json`,
    workflow: "CI",
    job: "Prüfungen",
    schritt: "Lint",
    pflicht: "CI",
  },
  {
    fall: "ts-as",
    vorlage: `${ROTPROBEN_DIR}/eslint/ts-as.json`,
    workflow: "CI",
    job: "Prüfungen",
    schritt: "Lint",
    pflicht: "CI",
  },
  {
    fall: "ts-typfehler",
    vorlage: `${ROTPROBEN_DIR}/typpruefung/typfehler-der-laeuft.json`,
    workflow: "CI",
    job: "Prüfungen",
    schritt: "Typprüfung",
    pflicht: "CI",
  },
];

class NichtErzeugbar extends Error {}

export function branchFuer(fall) {
  return `rotprobe/${PAKET}-${fall}`;
}

export function fallNamens(name) {
  return FAELLE.find(({ fall }) => fall === name);
}

export function sauberOderAbbruch() {
  if (git(["status", "--porcelain", "--untracked-files=no"]).trim() !== "") {
    throw new Error("Der Arbeitsbaum hat uncommittete Änderungen; die Proben brauchen einen sauberen Stand.");
  }
}

function geaendert({ datei, anker, ersatz, anhang }, text) {
  if (anhang !== undefined) {
    const abgeschlossen = text === "" || text.endsWith(ZEILENENDE) ? text : `${text}${ZEILENENDE}`;
    return `${abgeschlossen}${anhang}`;
  }
  if (!text.includes(anker)) throw new NichtErzeugbar(`nicht erzeugbar: ${datei}/${anker}`);
  return text.replace(anker, () => ersatz);
}

function vorlageFuer({ datei, ordner, anker }) {
  if (datei !== undefined) return datei;
  const kandidaten = git(["ls-files", "-z", "--", ordner])
    .split(DATEINAMENTRENNER)
    .filter((pfad) => TESTDATEI.test(pfad) && !pfad.startsWith(UNGESCHUETZTE_TESTS));
  const vorlage = kandidaten.find((pfad) => existsSync(pfad) && readFileSync(pfad, "utf8").includes(anker));
  if (vorlage === undefined) {
    throw new NichtErzeugbar(`nicht erzeugbar: keine Testdatei unter ${ordner}/ enthält ${anker}`);
  }
  return vorlage;
}

function neuDiff(pfad) {
  const lauf = befehl("git", ["diff", "--no-color", "--no-ext-diff", "--no-index", ...PREFIXE, "--", "/dev/null", pfad]);
  if (lauf.status !== DIFF_MIT_UNTERSCHIED) throw new Error(`git diff ist gescheitert: ${bereinigt(lauf.stderr)}`);
  return lauf.stdout;
}

function neueDateienPatch(vorlage) {
  if (!existsSync(vorlage)) throw new NichtErzeugbar(`nicht erzeugbar: ${vorlage} fehlt`);
  const { dateien, vorher, loeschen } = JSON.parse(readFileSync(vorlage, "utf8"));
  if (vorher !== undefined || loeschen !== undefined) {
    throw new NichtErzeugbar(`nicht erzeugbar: ${vorlage} braucht vorher oder loeschen; die Wochenprobe legt nur neue Dateien an`);
  }
  const pfade = Object.keys(dateien);
  const vorhanden = pfade.find((pfad) => existsSync(pfad));
  if (vorhanden !== undefined) throw new NichtErzeugbar(`nicht erzeugbar: ${vorhanden} gibt es schon`);
  const angelegt = [];
  try {
    return pfade
      .map((pfad) => {
        angelegt.push(mkdirSync(dirname(pfad), { recursive: true }));
        writeFileSync(pfad, fileText(dateien[pfad]));
        return neuDiff(pfad);
      })
      .join("");
  } finally {
    for (const pfad of pfade) rmSync(pfad, { force: true });
    for (const ordner of angelegt.filter(Boolean)) rmSync(ordner, { recursive: true, force: true });
  }
}

function patchFuer(fall) {
  if (fall.vorlage !== undefined) return neueDateienPatch(fall.vorlage);
  const datei = vorlageFuer(fall);
  if (!existsSync(datei)) throw new NichtErzeugbar(`nicht erzeugbar: ${datei} fehlt`);
  writeFileSync(datei, geaendert({ ...fall, datei }, readFileSync(datei, "utf8")));
  try {
    return git(["diff", "--no-color", "--no-ext-diff", ...PREFIXE, "--", datei]);
  } finally {
    git(["checkout", "--", datei]);
  }
}

function schreibePatch(fall, ordner) {
  const ziel = join(ordner, `${fall.fall}.patch`);
  writeFileSync(ziel, patchFuer(fall));
  return ziel;
}

export function patchesSchreiben(ordner) {
  mkdirSync(ordner, { recursive: true });
  return FAELLE.map((fall) => {
    try {
      return { fall: fall.fall, datei: schreibePatch(fall, ordner) };
    } catch (fehler) {
      if (fehler instanceof NichtErzeugbar) return { fall: fall.fall, fehler: fehler.message };
      throw fehler;
    }
  });
}

function probeAnlegen(fall, ordner) {
  const lauf = befehl(process.execPath, [ROTPROBE, PAKET, fall.fall, schreibePatch(fall, ordner)]);
  const zeilen = lauf.stderr.split(ZEILENENDE).filter((zeile) => zeile.trim() !== "");
  if (lauf.status !== 0) throw new Error(`rotprobe.mjs: ${bereinigt(zeilen.at(-1) ?? "")}`);
  const nummer = lauf.stdout.trim();
  if (!PR_NUMMER.test(nummer)) throw new Error("rotprobe.mjs hat keine PR-Nummer ausgegeben");
  return Number(nummer);
}

function angelegt(fall, ordner) {
  try {
    return { ...fall, pr: probeAnlegen(fall, ordner) };
  } catch (fehler) {
    if (fehler instanceof NichtErzeugbar) return { ...fall, ergebnis: rot(fehler.message) };
    return { ...fall, ergebnis: technisch(`nicht angelegt: ${fehler.message}`) };
  }
}

export function probenAnlegen() {
  const ordner = mkdtempSync(join(tmpdir(), "rotproben-woche-"));
  try {
    return FAELLE.map((fall) => angelegt(fall, ordner));
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}
