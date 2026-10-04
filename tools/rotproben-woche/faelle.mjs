import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { rot, technisch } from "./bericht.mjs";
import { befehl, bereinigt, git } from "./git.mjs";

export const PAKET = "20";
const ROTPROBE = fileURLToPath(new URL("../rotprobe.mjs", import.meta.url));
const ZEILENENDE = "\n";
const PR_NUMMER = /^\d+$/;

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
    datei: "test/plans-find-plan.test.js",
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

function patchFuer(fall) {
  if (!existsSync(fall.datei)) throw new NichtErzeugbar(`nicht erzeugbar: ${fall.datei} fehlt`);
  writeFileSync(fall.datei, geaendert(fall, readFileSync(fall.datei, "utf8")));
  try {
    const prefixe = ["--src-prefix=a/", "--dst-prefix=b/"];
    return git(["diff", "--no-color", "--no-ext-diff", ...prefixe, "--", fall.datei]);
  } finally {
    git(["checkout", "--", fall.datei]);
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
