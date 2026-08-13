// Die vier Messinstrumente (eslint, jscpd, knip, c8) duerfen keine ERZEUGTEN
// Ausgaben messen. Gemessen am 2026-08-13: 87 Dateien mit 37.905 eingefrorenen
// Lint-Verstoessen in eslint-suppressions.json lagen in gebauten Bundles
// (apps/hermes-studio/dist, apps/hermes-animation-lab/dist, apps/web/dist,
// dist-test, dist-test-links, dist-clean-test). Die Ratsche mass damit
// ueberwiegend Minifier-Ausgabe: id-length allein trug 32.965 Unterdrueckungen.
// Eine Zahl, die zu 88 Prozent aus Bundle-Rauschen besteht, misst nicht die
// Sauberkeit des Codes, sondern den Zufall des letzten Builds - und sie sinkt
// nie durch Aufraeumen, sondern nur durch Loeschen eines dist-Verzeichnisses.
//
// EIGENTUEMER-ENTSCHEIDUNG: erzeugte Ausgaben fliegen aus ALLEN VIER
// Instrumenten, danach wird eslint-suppressions.json neu erzeugt.
//
// Diese Faelle sind KEINE Abnahmekriterien (keine Kennung ABNAHME-) und kein
// Katalogtest - sie gehoeren in den Regressionslauf, weil der Zustand nach der
// Reparatur dauerhaft gelten muss. Ein spaeterer Build, der ein neues
// Ausgabeverzeichnis anlegt, oder eine Ausschlussliste, die beim Umbau
// verlorengeht, faellt hier wieder auf.
//
// WARUM PRO INSTRUMENT UND NICHT NUR AM MESSERGEBNIS: knip misst dist heute
// schon nicht (sein project-Bereich umfasst nur src/scripts/test), c8 misst nur
// geladene Dateien. Das ist Zufall der heutigen Konfiguration, kein Ausschluss:
// wer knips project-Bereich morgen auf apps/** erweitert, holt die Bundles
// still zurueck. Der ausdrueckliche Ausschluss ist die haltbare Festlegung,
// nicht der Nebeneffekt eines Geltungsbereichs.
//
// POSITIV-KONTROLLE, in jedem Fall enthalten: geprueft wird zusaetzlich, dass
// ueberhaupt etwas gesehen wird (Unterdrueckungsdatei nicht leer, Ausschlussliste
// nicht leer) und dass die Liste nicht trivial alles ausklammert (eine echte
// Quelldatei bleibt gemessen). Ohne beides waere jeder Fall gegen eine leere
// Menge gruen.
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SUPPRESSIONS_REL = "eslint-suppressions.json";
const JSCPD_CONFIG_REL = ".jscpd.json";
const KNIP_CONFIG_REL = "knip.json";
const PACKAGE_JSON_REL = "package.json";

// Positiv-Kontrolle beider Richtungen: eine echte, gemessene Quelldatei. Sie
// darf in KEINER Ausschlussliste stehen - sonst klammert die Liste trivial
// alles aus und der Fall waere auch dann gruen, wenn nichts mehr gemessen wird.
const SOURCE_PROBE = "src/server.js";

// Positiv-Kontrolle fuer den eslint-Fall: ein Pfad, den eslint bereits heute
// ausklammert. Meldet die Abfrage dafuer "wird gemessen", liest sie die
// ignores-Liste gar nicht - dann sagt ein gruener Ausschluss-Befund nichts.
const KNOWN_IGNORED_PROBE = "node_modules/beispiel/index.js";

// Stellvertreter-Pfade fuer die erzeugten Ausgaben dieses Repos. Die Herkunft
// steht an jedem Eintrag: jedes Verzeichnis ist entweder in einer .gitignore
// als Build-Ausgabe deklariert oder Ziel eines Build-Skripts aus einer
// package.json. Geraten ist keiner davon.
const GENERATED_OUTPUT_PROBES = [
  {
    path: "apps/web/dist/_astro/seite.js",
    origin: "apps/web/.gitignore dist/ - Ziel von astro build",
  },
  {
    path: "apps/web/dist-test/_astro/seite.js",
    origin: "apps/web/.gitignore dist-test/",
  },
  {
    path: "apps/web/dist-test-links/_astro/seite.js",
    origin: "apps/web/.gitignore dist-test-links/",
  },
  {
    path: "apps/web/dist-test-failclosed/_astro/seite.js",
    origin: "apps/web/.gitignore dist-test-failclosed/",
  },
  {
    path: "apps/web/dist-clean-test/_astro/seite.js",
    origin: "Wurzel-.gitignore apps/web/dist-clean-test/",
  },
  {
    path: "apps/web/.astro/content-modules.mjs",
    origin: "apps/web/.gitignore .astro/ - Zwischenstand von astro build",
  },
  {
    path: "apps/hermes-studio/dist/assets/bundle.js",
    origin: "apps/hermes-studio/.gitignore dist/ - Ziel von vite build",
  },
  {
    path: "apps/hermes-studio/out/bundle.js",
    origin: "apps/hermes-studio/.gitignore out/",
  },
  {
    path: "apps/hermes-animation-lab/dist/assets/bundle.js",
    origin: "apps/hermes-animation-lab/.gitignore dist/ - Ziel von vite build",
  },
  {
    path: "build/bundle.js",
    origin: "Wurzel-.gitignore build/",
  },
];

// Eine beliebige, aber bekannte Build-Ausgabe fuer die Positiv-Kontrollen der
// Einordnung und des Glob-Abgleichs, und ein Muster, das sie nachweislich deckt.
const FIRST_PROBE_PATH = GENERATED_OUTPUT_PROBES[0].path;
const PROVEN_GLOB = "**/dist/**";

// Dieselbe Herkunft, als Verzeichnisnamen: damit laesst sich ein BELIEBIGER
// Pfad einordnen (gebraucht fuer die Pruefung der Unterdrueckungsdatei, deren
// Eintraege nicht vorher bekannt sind). dist- als Praefix deckt die Astro-
// Testausgaben dist-test, dist-test-links, dist-test-failclosed und
// dist-clean-test in einem ab.
const GENERATED_DIR_SEGMENTS = new Set(["dist", "build", "out", ".astro"]);
const GENERATED_DIR_PREFIX = "dist-";

// c8 liest seine Ausschluesse aus einer Konfigurationsdatei, aus dem c8-Schluessel
// in package.json oder von der Kommandozeile des coverage-Skripts. Die
// JS-/YAML-Varianten von c8 fehlen hier bewusst: sie kaemen ohne zusaetzlichen
// Parser nicht verlaesslich rein, und keine davon existiert in diesem Repo.
const C8_CONFIG_FILES = [".c8rc", ".c8rc.json", ".nycrc", ".nycrc.json"];
const C8_WHERE = `${C8_CONFIG_FILES.join(" / ")} / package.json c8.exclude / --exclude im coverage-Skript`;

function readRepoFile(relativePath) {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

function readRepoJson(relativePath) {
  return JSON.parse(readRepoFile(relativePath));
}

// --- Glob-Abgleich -----------------------------------------------------------
// jscpd, knip und c8 fuehren ihre Ausschluesse als Glob-Muster derselben
// Schreibweise. Ein eigener winziger Uebersetzer statt einer neuen Dependency:
// gebraucht werden nur ** und *, mehr steht in diesen Listen nicht.
const GLOBSTAR_SLASH_MARK = "\u0000";
const GLOBSTAR_MARK = "\u0001";
const STAR_MARK = "\u0002";
const REGEXP_SPECIALS = /[.+^${}()|[\]\\?]/g;

function globToRegExp(pattern) {
  const marked = pattern
    .replaceAll("**/", GLOBSTAR_SLASH_MARK)
    .replaceAll("**", GLOBSTAR_MARK)
    .replaceAll("*", STAR_MARK);
  const escaped = marked.replace(REGEXP_SPECIALS, "\\$&");
  const body = escaped
    .replaceAll(GLOBSTAR_SLASH_MARK, "(?:[^/]*/)*")
    .replaceAll(GLOBSTAR_MARK, ".*")
    .replaceAll(STAR_MARK, "[^/]*");
  return new RegExp(`^${body}$`);
}

// Der Pfad selbst und jeder seiner Vorfahren-Ordner. Ein Muster darf auf das
// Verzeichnis zeigen statt auf die Datei darin (apps/web/dist deckt alles unter
// apps/web/dist ab) - ohne die Vorfahren wuerde so ein Ausschluss uebersehen.
function pathAndAncestors(relativePath) {
  const segments = relativePath.split("/");
  const candidates = [];
  for (let index = 0; index < segments.length; index += 1) {
    candidates.push(segments.slice(0, index + 1).join("/"));
  }
  return candidates;
}

function matchesAnyGlob(relativePath, patterns) {
  const candidates = pathAndAncestors(relativePath);
  return patterns.some((pattern) => {
    const asRegExp = globToRegExp(pattern);
    return candidates.some((candidate) => asRegExp.test(candidate));
  });
}

// --- Einordnung beliebiger Pfade ---------------------------------------------
function isGeneratedOutputPath(relativePath) {
  const segments = relativePath.split("/");
  const directories = segments.slice(0, -1);
  return directories.some(
    (segment) => GENERATED_DIR_SEGMENTS.has(segment) || segment.startsWith(GENERATED_DIR_PREFIX),
  );
}

// --- Ausschlusslisten der Instrumente ----------------------------------------
function jscpdIgnorePatterns() {
  return readRepoJson(JSCPD_CONFIG_REL).ignore ?? [];
}

function knipIgnorePatterns() {
  return readRepoJson(KNIP_CONFIG_REL).ignore ?? [];
}

function excludeFlagsFrom(scriptLine) {
  const flags = [...scriptLine.matchAll(/--exclude[= ]"?([^\s"]+)"?/g)];
  return flags.map((flag) => flag[1]);
}

function c8ExcludePatterns() {
  const patterns = [];
  for (const relativePath of C8_CONFIG_FILES) {
    if (!existsSync(resolve(REPO_ROOT, relativePath))) continue;
    patterns.push(...(readRepoJson(relativePath).exclude ?? []));
  }
  const packageJson = readRepoJson(PACKAGE_JSON_REL);
  patterns.push(...(packageJson.c8?.exclude ?? []));
  patterns.push(...excludeFlagsFrom(packageJson.scripts?.coverage ?? ""));
  return patterns;
}

// --- Gemeinsame Behauptung fuer die glob-basierten Instrumente ----------------
function describeMissing(probe) {
  return `${probe.path}  (${probe.origin})`;
}

function assertExcludesGeneratedOutput({ instrument, where, patterns }) {
  // Positiv-Kontrolle des Abgleichs selbst: ein Muster, das die Probe deckt,
  // MUSS als Treffer gelten. Ein Abgleich, der immer "kein Treffer" liefert,
  // meldete dieselben Luecken - und der Fall koennte nie gruen werden.
  assert.ok(
    matchesAnyGlob(FIRST_PROBE_PATH, [PROVEN_GLOB]),
    `Positiv-Kontrolle fehlgeschlagen: der Glob-Abgleich erkennt ${PROVEN_GLOB} nicht als Treffer fuer ${FIRST_PROBE_PATH}`,
  );
  assert.ok(
    patterns.length > 0,
    `Positiv-Kontrolle fehlgeschlagen: ${instrument} fuehrt in ${where} keinerlei Ausschluesse - dieser Fall pruefte sonst gegen eine leere Menge`,
  );
  assert.ok(
    !matchesAnyGlob(SOURCE_PROBE, patterns),
    `Positiv-Kontrolle fehlgeschlagen: die Ausschlussliste von ${instrument} (${where}) deckt sogar ${SOURCE_PROBE} ab - sie klammert trivial alles aus`,
  );
  const missing = GENERATED_OUTPUT_PROBES.filter(
    (probe) => !matchesAnyGlob(probe.path, patterns),
  ).map(describeMissing);
  assert.deepEqual(
    missing,
    [],
    `${instrument} misst erzeugte Ausgaben - in ${where} fehlt der Ausschluss fuer:\n  ${missing.join("\n  ")}`,
  );
}

describe("Messinstrumente messen keine erzeugten Ausgaben", () => {
  it("eslint-suppressions.json fuehrt keine erzeugte Ausgabe", () => {
    const suppressions = readRepoJson(SUPPRESSIONS_REL);
    const files = Object.keys(suppressions);
    assert.ok(
      files.length > 0,
      `Positiv-Kontrolle fehlgeschlagen: ${SUPPRESSIONS_REL} ist leer - dieser Fall pruefte gegen eine leere Menge`,
    );
    // Positiv-Kontrolle in BEIDE Richtungen: eine Einordnung, die nie "erzeugt"
    // sagt, macht diesen Fall falsch-gruen; eine, die immer "erzeugt" sagt,
    // macht ihn unerfuellbar.
    assert.ok(
      isGeneratedOutputPath(FIRST_PROBE_PATH),
      `Positiv-Kontrolle fehlgeschlagen: die Einordnung haelt ${FIRST_PROBE_PATH} fuer Quellcode - sie faende dann nie einen Eintrag`,
    );
    assert.ok(
      !isGeneratedOutputPath(SOURCE_PROBE),
      `Positiv-Kontrolle fehlgeschlagen: die Einordnung haelt ${SOURCE_PROBE} fuer eine erzeugte Ausgabe - sie ordnet dann alles ein`,
    );
    const generated = files.filter((file) => isGeneratedOutputPath(file));
    assert.deepEqual(
      generated,
      [],
      `${SUPPRESSIONS_REL} friert Verstoesse in erzeugten Ausgaben ein (${generated.length} Dateien) - nach dem Ausklammern neu erzeugen. Betroffen u.a.:\n  ${generated.join("\n  ")}`,
    );
  });

  // eslint wird nicht ueber den Text seiner ignores-Liste geprueft, sondern
  // gefragt: isPathIgnored liest eslint.config.js mit derselben Semantik wie der
  // echte Lauf. Eine nachgebaute Musterpruefung koennte an einer Schreibweise
  // scheitern, die eslint sehr wohl versteht (oder umgekehrt).
  it("eslint klammert erzeugte Ausgaben aus (eslint.config.js ignores)", async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    assert.ok(
      await eslint.isPathIgnored(KNOWN_IGNORED_PROBE),
      `Positiv-Kontrolle fehlgeschlagen: eslint meldet ${KNOWN_IGNORED_PROBE} als gemessen - die Abfrage liest die ignores-Liste offenbar nicht`,
    );
    assert.ok(
      !(await eslint.isPathIgnored(SOURCE_PROBE)),
      `Positiv-Kontrolle fehlgeschlagen: eslint klammert ${SOURCE_PROBE} aus - die ignores-Liste deckt dann trivial alles ab`,
    );
    const missing = [];
    for (const probe of GENERATED_OUTPUT_PROBES) {
      if (!(await eslint.isPathIgnored(probe.path))) missing.push(describeMissing(probe));
    }
    assert.deepEqual(
      missing,
      [],
      `eslint misst erzeugte Ausgaben - in den ignores von eslint.config.js fehlt der Ausschluss fuer:\n  ${missing.join("\n  ")}`,
    );
  });

  it("jscpd klammert erzeugte Ausgaben aus (.jscpd.json ignore)", () => {
    assertExcludesGeneratedOutput({
      instrument: "jscpd",
      where: `${JSCPD_CONFIG_REL} (ignore)`,
      patterns: jscpdIgnorePatterns(),
    });
  });

  it("knip klammert erzeugte Ausgaben aus (knip.json ignore)", () => {
    assertExcludesGeneratedOutput({
      instrument: "knip",
      where: `${KNIP_CONFIG_REL} (ignore)`,
      patterns: knipIgnorePatterns(),
    });
  });

  it("c8 klammert erzeugte Ausgaben aus (c8-Konfiguration exclude)", () => {
    assertExcludesGeneratedOutput({
      instrument: "c8",
      where: C8_WHERE,
      patterns: c8ExcludePatterns(),
    });
  });
});
