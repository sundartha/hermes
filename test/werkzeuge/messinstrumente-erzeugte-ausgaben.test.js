import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SUPPRESSIONS_REL = "eslint-suppressions.json";

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
const GENERATED_DIR_SEGMENTS = new Set(["dist", "build", "out", ".astro"]);
const GENERATED_DIR_PREFIX = "dist-";

function readRepoFile(relativePath) {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

function readRepoJson(relativePath) {
  return JSON.parse(readRepoFile(relativePath));
}

function isGeneratedOutputPath(relativePath) {
  const segments = relativePath.split("/");
  const directories = segments.slice(0, -1);
  return directories.some(
    (segment) => GENERATED_DIR_SEGMENTS.has(segment) || segment.startsWith(GENERATED_DIR_PREFIX),
  );
}

function describeMissing(probe) {
  return `${probe.path}  (${probe.origin})`;
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
});
