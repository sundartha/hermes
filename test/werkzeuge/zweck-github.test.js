import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { kenntZweck, zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { FREIGABE_GRUENDE } from "../../tools/freigabe-gruende.mjs";
import { REPO_ROOT, commitAll, outputLines, probeRepository, runIn, writeFiles } from "./probe-repo.js";
import { scheinGithub } from "./pruefer/hilfen.mjs";
import { API_PFAD, REPO, starteWerkzeug } from "./warteschlange/hilfen.mjs";

const DATEN = "tools/zweck/github.json";
const FREIGABE = "tools/freigabe-pruefung.mjs";
const GITHUB_ID = /"(github\/[a-z-]+)"/g;
const GRUND_AUFRUF = /\b(?:grund|listed)\(\s*([^,\s]+),/g;
const GRUND_KONSTANTE = /^FREIGABE_GRUENDE\.([A-Z_]+)$/;
const DURCHGEREICHT = "zweck";
const PR = 7;
const EXIT_OK = 0;
const EXIT_BEFUND = 1;
const OWNERS = "/tools/ @Antonio20045 @jonas986\n";
const OHNE_NETZ = "http://127.0.0.1:9";

function quelle(pfad) {
  return readFileSync(join(REPO_ROOT, pfad), "utf8");
}

function dateienUnter(ordner, endung) {
  return readdirSync(join(REPO_ROOT, ordner), { recursive: true, withFileTypes: true })
    .filter((eintrag) => eintrag.isFile() && eintrag.name.endsWith(endung))
    .map((eintrag) => join(eintrag.parentPath, eintrag.name).slice(REPO_ROOT.length));
}

function quelltextIds() {
  return dateienUnter("tools", ".mjs").flatMap((pfad) => [...quelle(pfad).matchAll(GITHUB_ID)].map((treffer) => treffer[1]));
}

test("jede Gründe-Art der Freigabe-Prüfung hat einen Zweck-Text, und die Prüfung meldet keinen Grund ohne Art", () => {
  const arten = Object.keys(FREIGABE_GRUENDE);
  for (const art of arten) assert.ok(kenntZweck(FREIGABE_GRUENDE[art]), `${art}: kein Text für ${FREIGABE_GRUENDE[art]}`);
  const aufrufe = [...quelle(FREIGABE).matchAll(GRUND_AUFRUF)].map((treffer) => treffer[1]).filter((argument) => argument !== DURCHGEREICHT);
  assert.ok(aufrufe.length >= arten.length, aufrufe.join(", "));
  const genutzt = aufrufe.map((argument) => GRUND_KONSTANTE.exec(argument)?.[1] ?? argument);
  assert.deepEqual(genutzt.filter((art) => !arten.includes(art)), [], "Grund ohne Art aus FREIGABE_GRUENDE");
  assert.deepEqual(arten.filter((art) => !genutzt.includes(art)), [], "Art ohne Grund in tools/freigabe-pruefung.mjs");
});

test("tools/zweck/github.json hat genau die IDs, die die Werkzeuge nennen", () => {
  const genutzt = new Set(quelltextIds());
  for (const id of genutzt) assert.ok(kenntZweck(id), `kein Text für ${id}`);
  assert.deepEqual(Object.keys(JSON.parse(quelle(DATEN))).toSorted(), [...genutzt].toSorted());
});

async function freigabeLauf(context, reviews) {
  const verzeichnis = probeRepository(context, { ".github/CODEOWNERS": OWNERS, "tools/pruefung.mjs": "export const streng = true;\n" });
  const basis = runIn(verzeichnis, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFiles(verzeichnis, { "tools/pruefung.mjs": "export const streng = false;\n" });
  commitAll(verzeichnis, "Prüfung geändert");
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
  const args = [join(REPO_ROOT, FREIGABE), "--basis", basis, "--pr", String(PR), "--registry", OHNE_NETZ, "--downloads", OHNE_NETZ];
  const lauf = await starteWerkzeug(args, {
    cwd: verzeichnis,
    umgebung: { GITHUB_API_URL: github.url, GITHUB_TOKEN: "probe", GITHUB_REPOSITORY: REPO },
  });
  const kommentar = github.anfragen.find(({ methode, pfad }) => methode === "POST" && pfad.endsWith("/comments"));
  return { ...lauf, kommentar: kommentar?.rumpf.body ?? "" };
}

test("die Freigabe-Prüfung nennt ohne Approve nach den Gründen den Block der Gründe-Art, in Log und Kommentar", async (context) => {
  const block = zweckBlock(FREIGABE_GRUENDE.PRUEFUNGSDATEIEN);
  const offen = await freigabeLauf(context, () => []);
  assert.equal(offen.status, EXIT_BEFUND, offen.stdout + offen.stderr);
  const zeilen = outputLines(offen.stdout);
  assert.match(zeilen.at(-block.length - 1), /^Es fehlt eine Freigabe von Antonio20045 oder jonas986/);
  assert.deepEqual(zeilen.slice(-block.length), block);
  const [, abFehlt] = offen.kommentar.split("### Was noch fehlt");
  const [fehlt] = abFehlt.split("\n### ");
  assert.match(fehlt, /- Braucht Freigabe: Bestehende Prüfungsdateien geändert oder gelöscht: tools\/pruefung\.mjs\./);
  assert.ok(block.every((zeile) => fehlt.includes(`\n\n${zeile}\n`)), offen.kommentar);
  const frei = await freigabeLauf(context, (kopf) => [{ user: { login: "Antonio20045" }, state: "APPROVED", commit_id: kopf }]);
  assert.equal(frei.status, EXIT_OK, frei.stdout + frei.stderr);
  assert.doesNotMatch(`${frei.stdout}${frei.kommentar}`, /Wozu:/);
});
