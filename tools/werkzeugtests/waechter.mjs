import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { TOOL_TEST_DIRECTORY } from "../../test/testbaenke-run.mjs";
import { entferneTempOrdner, neuerTempOrdner } from "../temp-ordner.mjs";
import { HARNESS_FILES, LIST_FILE } from "./auswahl.mjs";

const LIST_NAME = LIST_FILE.split("/").at(-1);
const MESSAGE = `liest Produktcode, gehört in ${LIST_NAME} oder auf ein Beispiel-Repo`;
const MAX_GIT_OUTPUT_BYTES = 268_435_456;
const PRODUCT_DIRECTORY = "src/";
const TEST_DIRECTORY = "test/";
const NODE_MODULES = "node_modules";
const PACKAGE_FILE = "package.json";
const EXIT_FAILURE = 1;
const TEMP_PREFIX = "werkzeugtests-waechter-";

function isVisible(path) {
  if (path.startsWith(PRODUCT_DIRECTORY)) return false;
  if (!path.startsWith(TEST_DIRECTORY)) return true;
  return path.startsWith(TOOL_TEST_DIRECTORY) || HARNESS_FILES.includes(path);
}

function trackedFiles(source) {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: source,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  if (result.status !== 0) throw new Error(`git ls-files in ${source} schlug fehl: ${result.stderr}`);
  return result.stdout.split("\0").filter((path) => path !== "");
}

function copyOne(source, target, path) {
  const from = join(source, path);
  const kind = lstatSync(from, { throwIfNoEntry: false });
  if (kind === undefined) return;
  const to = join(target, path);
  mkdirSync(dirname(to), { recursive: true });
  if (kind.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
  else copyFileSync(from, to);
}

function linkInstalledModules(source, target, files) {
  const folders = ["", ...files.filter((path) => path.endsWith(PACKAGE_FILE)).map(dirname)];
  for (const folder of new Set(folders.map((name) => (name === "." ? "" : name)))) {
    const from = join(source, folder, NODE_MODULES);
    if (!existsSync(from)) continue;
    mkdirSync(join(target, folder), { recursive: true });
    symlinkSync(from, join(target, folder, NODE_MODULES));
  }
}

function copyWithoutProduct(source, target) {
  const files = trackedFiles(source);
  mkdirSync(target, { recursive: true });
  for (const path of files.filter(isVisible)) copyOne(source, target, path);
  linkInstalledModules(
    source,
    target,
    files.filter(isVisible),
  );
}

function readRedFiles(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function reportProductReaders(red, redWithProduct) {
  if (redWithProduct === null) return;
  const stillRed = new Set(redWithProduct);
  const readers = red.filter((file) => !stillRed.has(file));
  if (readers.length === 0) return;
  console.log(`Wächter: ${readers.length} Werkzeugtest-Dateien außerhalb der Liste brauchen Produktcode:`);
  for (const file of readers) console.log(`${file}: ${MESSAGE}`);
}

function runInTree({ files, runBank, laufzeitBericht, work }) {
  const tree = join(work, "baum");
  copyWithoutProduct(process.cwd(), tree);
  const redWithoutProduct = join(work, "rot-ohne-produkt.json");
  const timings = join(work, "laufzeit.jsonl");
  console.log(
    `Wächter: ${files.length} Werkzeugtest-Dateien außerhalb der Liste laufen ohne ${PRODUCT_DIRECTORY} und ohne ${TEST_DIRECTORY} (außer ${TOOL_TEST_DIRECTORY}).`,
  );
  const status = runBank(files, {
    cwd: tree,
    rot: redWithoutProduct,
    laufzeit: laufzeitBericht === undefined ? undefined : timings,
  });
  if (laufzeitBericht !== undefined && existsSync(timings)) {
    appendFileSync(laufzeitBericht, readFileSync(timings));
  }
  if (status === 0) return 0;
  const red = readRedFiles(redWithoutProduct) ?? [];
  if (red.length === 0) {
    console.log("Wächter: Lauf ohne Produktcode ist rot, benennt aber keine Testdatei.");
    return status;
  }
  const redWithProduct = join(work, "rot-mit-produkt.json");
  runBank(red, { cwd: process.cwd(), rot: redWithProduct, still: true });
  reportProductReaders(red, readRedFiles(redWithProduct));
  return status;
}

export function guardedRun({ files, runBank, laufzeitBericht }) {
  const work = neuerTempOrdner(TEMP_PREFIX);
  try {
    return runInTree({ files, runBank, laufzeitBericht, work });
  } catch (error) {
    console.log(`Wächter abgebrochen: ${error.message}`);
    return EXIT_FAILURE;
  } finally {
    entferneTempOrdner(work);
  }
}
