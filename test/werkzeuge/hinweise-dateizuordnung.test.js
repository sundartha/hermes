import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const ERZEUGEN = join(WURZEL, "tools/hinweise-erzeugen.mjs");
const PRUEFEN = join(WURZEL, "tools/pruefen.mjs");
const PROJEKTKONFIGURATION = pathToFileURL(join(WURZEL, "eslint.config.js")).href;
const FRIST_MS = 240_000;
const KARTE = "tools/bausteine.json";
const KOPF = "## Bausteine in diesem Ordner (erzeugt aus tools/bausteine.json mit npm run hinweise)";
const arbeitsbaeume = [];

after(() => {
  for (const ordner of arbeitsbaeume) rmSync(ordner, { recursive: true, force: true, maxRetries: 3 });
});

function ohneGitUmgebung() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
}

function git(ordner, ...args) {
  const lauf = spawnSync("git", ["-c", "user.name=probe", "-c", "user.email=probe@example.com", ...args], { cwd: ordner, encoding: "utf8", env: ohneGitUmgebung() });
  assert.equal(lauf.status, 0, lauf.stderr);
  return lauf.stdout;
}

function einchecken(ordner) {
  git(ordner, "init", "-q", "-b", "paket/probe");
  writeFileSync(join(ordner, ".git/info/exclude"), "/node_modules\n");
  git(ordner, "add", "-A");
  git(ordner, "commit", "-q", "-m", "basis");
  git(ordner, "update-ref", "refs/remotes/hermes/master", "HEAD");
  symlinkSync(join(WURZEL, "node_modules"), join(ordner, "node_modules"));
}

function schreiben(ordner, dateien) {
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
    writeFileSync(join(ordner, pfad), inhalt);
  }
}

const KARTE_PROBE = {
  schichten: [["texte", "basis"], ["web", "api", "start"]],
  bausteine: [
    { baustein: "texte", zweck: "Texte.", quellen: ["src/i18n/"], eingaenge: ["src/i18n/index.js"], nutzt: [] },
    { baustein: "basis", zweck: "Basis.", quellen: ["src/util.js"], eingaenge: "alle", nutzt: [] },
    { baustein: "web", zweck: "Web-Routen.", quellen: ["src/routes/b.ts", "src/routes/a.js"], eingaenge: ["src/routes/b.ts"], nutzt: [] },
    { baustein: "api", zweck: "Api.", quellen: ["src/api/", "src/routes/c.js"], eingaenge: [], nutzt: [] },
    { baustein: "start", zweck: "Start.", quellen: ["src/start.js", "src/i18n/z.js"], eingaenge: ["src/start.js"], nutzt: [] },
  ],
  altlast: [],

  javascriptBestand: ["src/api/x.js", "src/i18n/index.js", "src/i18n/z.js", "src/routes/a.js", "src/routes/c.js", "src/start.js", "src/util.js"],
};
const KARTE_UMGEZOGEN = {
  ...KARTE_PROBE,
  bausteine: KARTE_PROBE.bausteine.map((eintrag) => (eintrag.baustein === "web" ? { ...eintrag, quellen: ["src/routes/a.js"] } : eintrag.baustein === "start" ? { ...eintrag, quellen: ["src/start.js", "src/routes/b.ts"] } : eintrag)),
};
const QUELLEN = {
  "src/i18n/index.js": "export const TEXT = 1;\n",
  "src/api/x.js": "export const X = 1;\n",
  "src/routes/a.js": "export const A = 1;\n",
  "src/routes/b.ts": "export const B: number = 1;\n",
  "src/routes/c.js": "export const C = 1;\n",
  "src/start.js": "export const START = 1;\n",
  "src/util.js": "export const UTIL = 1;\n",
  "src/i18n/z.js": "export const Z = 1;\n",
};
const ROUTEN_BLOCK = [
  KOPF,
  "- web: a.js, b.ts. Zweck: Web-Routen. Darf nutzen: texte, basis. Eingang: b.ts.",
  "- api: c.js. Zweck und Darf nutzen: stehen in `src/api/CLAUDE.md`, dem ersten Ordner von api. Eingang: kein Eingang hier.",
  "- Ort für Neues: Neue Route mit `npm run neu -- route <baustein> <name>`; der Baustein steht in tools/bausteine.json.",
];
const WURZEL_BLOCK = [
  KOPF,
  "- basis: util.js. Zweck: Basis. Darf nutzen: nichts. Jede Datei hier ist Eingang.",
  "- start: start.js. Zweck: Start. Darf nutzen: texte, basis. Eingang: start.js.",
  "- Ort für Neues: Neue Dateien direkt in `src/` nur, wenn tools/bausteine.json sie einem Baustein nennt, sonst ist die Architektur rot.",
];

function probeBaum(karte = KARTE_PROBE, dateien = {}) {
  const ordner = mkdtempSync(join(tmpdir(), "hinweise-zuordnung-"));
  arbeitsbaeume.push(ordner);
  schreiben(ordner, {
    "package.json": '{"type":"module"}\n',
    "eslint.config.js": `export { default } from "${PROJEKTKONFIGURATION}";\n`,
    ".dependency-cruiser.cjs": readFileSync(join(WURZEL, ".dependency-cruiser.cjs")),
    [KARTE]: JSON.stringify(karte),
    "tools/katalog-pruefen.mjs": "process.exitCode = 0;\n",
    "test/leer.js": "export const LEER = 1;\n",
    ...QUELLEN,
    ...dateien,
  });
  einchecken(ordner);
  return ordner;
}

function laufen(skript, ordner, ...args) {
  return spawnSync("node", [skript, ...args], { cwd: ordner, encoding: "utf8", timeout: FRIST_MS, env: ohneGitUmgebung() });
}

function hinweise(ordner) {
  const lauf = laufen(ERZEUGEN, ordner);
  assert.equal(lauf.status, 0, lauf.stderr);
  return lauf.stdout;
}

function zeilen(ordner, pfad) {
  return readFileSync(join(ordner, pfad), "utf8").split("\n");
}

test("npm run hinweise schreibt in src/routes/CLAUDE.md je Baustein mit Dateien im Ordner eine Zeile und den Ort für Neues", () => {
  const ordner = probeBaum();
  hinweise(ordner);
  assert.deepEqual(zeilen(ordner, "src/routes/CLAUDE.md"), [...ROUTEN_BLOCK, ""]);
});

test("npm run hinweise schreibt in src/CLAUDE.md nur die Dateien direkt in src und nennt den Karteneintrag", () => {
  const ordner = probeBaum();
  hinweise(ordner);
  assert.deepEqual(zeilen(ordner, "src/CLAUDE.md"), [...WURZEL_BLOCK, ""]);
  assert.equal(existsSync(join(ordner, "src/i18n/CLAUDE.md")), true);
  assert.ok(!readFileSync(join(ordner, "src/i18n/CLAUDE.md"), "utf8").includes("## Bausteine in diesem Ordner"));
  assert.equal(existsSync(join(ordner, "src/api/CLAUDE.md")), true);
});

test("ein zweiter Lauf von npm run hinweise ändert nichts und Text außerhalb des Blocks bleibt", () => {
  const ordner = probeBaum(KARTE_PROBE, { "src/routes/CLAUDE.md": "# Routen\n\nText davor.\n" });
  const erster = hinweise(ordner);
  assert.match(erster, /^src\/routes\/CLAUDE\.md: Kartenteil geschrieben$/m);
  const text = readFileSync(join(ordner, "src/routes/CLAUDE.md"), "utf8");
  assert.equal(text, `# Routen\n\nText davor.\n\n${ROUTEN_BLOCK.join("\n")}\n`);
  writeFileSync(join(ordner, "src/routes/CLAUDE.md"), `${text}\nText danach.\n- eigene Liste\n`);
  const zweiter = hinweise(ordner);
  assert.match(zweiter, /0 Dateien geändert\.$/m);
  assert.equal(readFileSync(join(ordner, "src/routes/CLAUDE.md"), "utf8"), `${text}\nText danach.\n- eigene Liste\n`);
});

test("die Architekturprüfung meldet einen fehlenden oder veralteten Kartenteil und nach npm run hinweise nichts mehr", () => {
  const ordner = probeBaum();
  const meldung = "src/routes/CLAUDE.md passt nicht mehr zu tools/bausteine.json: npm run hinweise ausführen.";
  const fehlt = laufen(PRUEFEN, ordner, "architektur");
  assert.equal(fehlt.status, 1, fehlt.stdout);
  assert.ok(fehlt.stdout.includes(meldung), fehlt.stdout);
  assert.ok(fehlt.stdout.includes("src/CLAUDE.md passt nicht mehr zu tools/bausteine.json"), fehlt.stdout);
  hinweise(ordner);
  const sauber = laufen(PRUEFEN, ordner, "architektur");
  assert.equal(sauber.status, 0, sauber.stdout);
  assert.ok(!sauber.stdout.includes("passt nicht mehr"), sauber.stdout);
  writeFileSync(join(ordner, KARTE), JSON.stringify(KARTE_UMGEZOGEN));
  const veraltet = laufen(PRUEFEN, ordner, "architektur");
  assert.equal(veraltet.status, 1, veraltet.stdout);
  assert.ok(veraltet.stdout.includes(meldung), veraltet.stdout);
  hinweise(ordner);
  const danach = laufen(PRUEFEN, ordner, "architektur");
  assert.ok(!danach.stdout.includes("passt nicht mehr"), danach.stdout);
});

test("auf dem echten Baum entstehen genau src/CLAUDE.md und src/routes/CLAUDE.md neu und kein vorhandener Kartenblock ändert sich", () => {
  const ordner = mkdtempSync(join(tmpdir(), "hinweise-zuordnung-echt-"));
  arbeitsbaeume.push(ordner);
  const neu = ["src/CLAUDE.md", "src/routes/CLAUDE.md"].map((pfad) => join(WURZEL, pfad));
  for (const eintrag of ["src", "tools", "package.json"]) cpSync(join(WURZEL, eintrag), join(ordner, eintrag), { recursive: true, filter: (pfad) => !neu.includes(pfad) });
  einchecken(ordner);
  hinweise(ordner);
  const status = git(ordner, "status", "--porcelain").split("\n").filter((zeile) => zeile !== "");
  assert.deepEqual(status, ["?? src/CLAUDE.md", "?? src/routes/CLAUDE.md"]);
});
