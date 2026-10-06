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

const SOURCE_PROBE = "src/server.js";

const KNOWN_IGNORED_PROBE = "node_modules/beispiel/index.js";

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

const FIRST_PROBE_PATH = GENERATED_OUTPUT_PROBES[0].path;
const PROVEN_GLOB = "**/dist/**";

const GENERATED_DIR_SEGMENTS = new Set(["dist", "build", "out", ".astro"]);
const GENERATED_DIR_PREFIX = "dist-";

const C8_CONFIG_FILES = [".c8rc", ".c8rc.json", ".nycrc", ".nycrc.json"];
const C8_WHERE = `${C8_CONFIG_FILES.join(" / ")} / package.json c8.exclude / --exclude im coverage-Skript`;

function readRepoFile(relativePath) {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

function readRepoJson(relativePath) {
  return JSON.parse(readRepoFile(relativePath));
}

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

function isGeneratedOutputPath(relativePath) {
  const segments = relativePath.split("/");
  const directories = segments.slice(0, -1);
  return directories.some(
    (segment) => GENERATED_DIR_SEGMENTS.has(segment) || segment.startsWith(GENERATED_DIR_PREFIX),
  );
}

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

function describeMissing(probe) {
  return `${probe.path}  (${probe.origin})`;
}

function assertExcludesGeneratedOutput({ instrument, where, patterns }) {
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
