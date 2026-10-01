import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env, execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { git } from "./git.mjs";
import { beleg, fuehreAus } from "./pruefungen.mjs";

const SCHRITT = fileURLToPath(new URL("bisektion-schritt.mjs", import.meta.url));
const MAX_RUECKSPRUENGE = 7;
const SPRUNGFAKTOR = 2;
const GUT = 0;
const SCHLECHT = 1;
const MAX_DIFF_ZEILEN = 80;

function guterStand(baum, basis, schritt) {
  for (let sprung = 0, abstand = 1; sprung < MAX_RUECKSPRUENGE; sprung += 1, abstand *= SPRUNGFAKTOR) {
    const kandidat = spawnSync("git", ["rev-parse", "-q", "--verify", `${basis}~${abstand}`], { cwd: baum, encoding: "utf8" });
    if (kandidat.status !== 0) return null;
    git(["checkout", "-q", "--detach", kandidat.stdout.trim()], { cwd: baum });
    const urteil = spawnSync(schritt[0], schritt.slice(1), { cwd: baum, env }).status;
    if (urteil === GUT) return kandidat.stdout.trim();
    if (urteil !== SCHLECHT) return null;
  }
  return null;
}

function arbeitsbaum(root, basis) {
  const verzeichnis = mkdtempSync(join(tmpdir(), "bisektion-"));
  const baum = join(verzeichnis, "baum");
  git(["worktree", "add", "--detach", "-q", baum, basis], { cwd: root });
  if (existsSync(join(root, "node_modules"))) symlinkSync(join(root, "node_modules"), join(baum, "node_modules"));
  const aufraeumen = () => {
    spawnSync("git", ["bisect", "reset", "-q"], { cwd: baum });
    git(["worktree", "remove", "--force", baum], { cwd: root });
    rmSync(verzeichnis, { recursive: true, force: true });
  };
  return { verzeichnis, baum, aufraeumen };
}

function ursprung(lauf, baum, schuldig) {
  const anzeige = git(["show", "--stat", "--patch", "--format=%H %s", schuldig], { cwd: baum });
  const [kopfzeile] = anzeige.split("\n");
  const gekuerzt = anzeige.split("\n").slice(0, MAX_DIFF_ZEILEN).join("\n");
  lauf.berichtszeilen.push(`Eingeführt mit: ${kopfzeile}`);
  lauf.zusaetze.push(`## Commit, der den Fehler eingeführt hat\n\n\`git bisect\` mit dem roten Abnahmetest nennt:\n\n\`\`\`\n${gekuerzt}\n\`\`\`\n`);
}

function suche(lauf, { verzeichnis, baum }) {
  const { auftrag, root } = lauf.kontext;
  const kopie = join(verzeichnis, "abnahme.test.js");
  writeFileSync(kopie, readFileSync(join(root, auftrag.abnahme)));
  const schritt = [execPath, SCHRITT, auftrag.abnahme, kopie, auftrag.erwarteterFehler];
  const gut = guterStand(baum, lauf.basis, schritt);
  if (gut === null) {
    lauf.hinweise.push("Bisect entfällt: der Abnahmetest ist auf keinem älteren Stand grün oder dort nicht ausführbar.");
    return true;
  }
  git(["bisect", "start", lauf.basis, gut], { cwd: baum });
  const ergebnis = fuehreAus("bisect", ["git", "bisect", "run", ...schritt], { cwd: baum, env });
  lauf.pruefungen.push(beleg(ergebnis));
  if (ergebnis.exitCode === 0) ursprung(lauf, baum, git(["rev-parse", "refs/bisect/bad"], { cwd: baum }).trim());
  return true;
}

export function bisektion(lauf) {
  if (lauf.kontext.auftrag.art !== "fehlerbehebung") return true;
  const arbeit = arbeitsbaum(lauf.kontext.root, lauf.basis);
  try {
    return suche(lauf, arbeit);
  } finally {
    arbeit.aufraeumen();
  }
}
