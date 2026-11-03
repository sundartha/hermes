import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "../probe-repo.js";
import { scheinGithub } from "../pruefer/hilfen.mjs";
import { API_PFAD, REPO, starteWerkzeug } from "../warteschlange/hilfen.mjs";

const FREIGABE = join(REPO_ROOT, "tools/freigabe-pruefung.mjs");
const PR = 7;
const OHNE_NETZ = "http://127.0.0.1:9";
const EXIT_OK = 0;

export async function freigabeImProbeRepo(context, { verzeichnis, basis, reviews = () => [] }) {
  const kopf = runIn(verzeichnis, "git", ["rev-parse", "HEAD"]).stdout.trim();
  const github = await scheinGithub(
    context,
    new Map([
      [`GET ${API_PFAD}/pulls/${PR}`, { number: PR, head: { sha: kopf }, labels: [] }],
      [`GET ${API_PFAD}/pulls/${PR}/reviews`, reviews(kopf)],
      [`GET ${API_PFAD}/issues/${PR}/comments`, []],
      [`POST ${API_PFAD}/issues/${PR}/comments`, {}],
      [`POST ${API_PFAD}/issues/${PR}/labels`, {}],
    ]),
  );
  const args = [
    "--basis",
    basis,
    "--pr",
    String(PR),
    "--registry",
    OHNE_NETZ,
    "--downloads",
    OHNE_NETZ,
  ];
  const lauf = await starteWerkzeug([FREIGABE, ...args], {
    cwd: verzeichnis,
    umgebung: { GITHUB_API_URL: github.url, GITHUB_TOKEN: "probe", GITHUB_REPOSITORY: REPO },
  });
  return { ...lauf, anfragen: github.anfragen };
}

const freigabeVonAntonio = (kopf) => [
  {
    user: { login: "Antonio20045" },
    state: "APPROVED",
    commit_id: kopf,
    submitted_at: "2026-11-03T12:00:00Z",
  },
];

export async function aenderungPruefen(context, { basisDateien, aenderung, loeschen = [] }) {
  const verzeichnis = probeRepository(context, basisDateien);
  const basis = runIn(verzeichnis, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFiles(verzeichnis, aenderung);
  for (const pfad of loeschen) rmSync(join(verzeichnis, pfad));
  commitAll(verzeichnis, "Änderung");
  return freigabeImProbeRepo(context, { verzeichnis, basis, reviews: freigabeVonAntonio });
}

export function urteilDer(lauf, pruefung) {
  const kommentar = lauf.anfragen.find(
    ({ methode, pfad }) => methode === "POST" && pfad.endsWith("/comments"),
  );
  const urteile = [...(kommentar?.rumpf.body ?? "").matchAll(/\*\*([^:*]+): (\S+)\*\*/g)];
  return urteile.find(([, name]) => name === pruefung)?.[2];
}

export function grundZeile(stdout) {
  return stdout.split("\n").find((zeile) => zeile.includes("Bestehende Prüfungsdateien")) ?? "";
}

export function codeOhneFreigabe(lauf) {
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /Art art:code\./);
  assert.equal(grundZeile(lauf.stdout), "");
}

export function nachgerechnet(verzeichnis, { modul, funktion, basis, pfade }) {
  const url = pathToFileURL(join(REPO_ROOT, modul)).href;
  const aufruf = [
    `import { ${funktion} } from ${JSON.stringify(url)};`,
    "const pfade = process.argv.slice(1);",
    `const menge = ${funktion}(${JSON.stringify(basis)}, pfade.map((path) => ({ status: "M", path })));`,
    "console.log(JSON.stringify([...menge].sort()));",
  ].join("\n");
  const lauf = runIn(verzeichnis, process.execPath, ["--input-type=module", "-e", aufruf, ...pfade]);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  return JSON.parse(lauf.stdout);
}
