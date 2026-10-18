import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { kenntZweck, ohneZweck, zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { FREIGABE_GRUENDE } from "../../tools/freigabe-gruende.mjs";
import { ZWECK_JE_TEIL, alsBericht, gruen, rot, technisch } from "../../tools/rotproben-woche/bericht.mjs";
import { REPO_ROOT, commitAll, outputLines, probeDirectory, probeRepository, runIn, writeFiles } from "./probe-repo.js";
import { scheinGithub } from "./pruefer/hilfen.mjs";
import { API_PFAD, REPO, starteWerkzeug } from "./warteschlange/hilfen.mjs";

const DATEN = "tools/zweck/github.json";
const FREIGABE = "tools/freigabe-pruefung.mjs";
const ROTPROBEN_WOCHE = "tools/rotproben-woche.mjs";
const GITHUB_ID = /"(github\/[a-z-]+)"/g;
const GRUND_AUFRUF = /\b(?:grund|listed)\(\s*([^,\s]+),/g;
const GRUND_KONSTANTE = /^FREIGABE_GRUENDE\.([A-Z_]+)$/;
const DURCHGEREICHT = "zweck";
const TEIL_AUS_LAUF = /\bteile\.([a-z]+) =|alsBericht\(\{ ([a-z]+):/g;
const TEILE_OHNE_ZWECK = ["aufgeraeumt"];
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

test("jeder Teil der Rot-Proben-Woche, der rot werden kann, hat einen Zweck-Text", () => {
  const teile = [...quelle(ROTPROBEN_WOCHE).matchAll(TEIL_AUS_LAUF)].map((treffer) => treffer[1] ?? treffer[2]);
  const bekannt = [...Object.keys(ZWECK_JE_TEIL), ...TEILE_OHNE_ZWECK];
  assert.deepEqual([...new Set(teile)].filter((teil) => !bekannt.includes(teil)), []);
  for (const id of Object.values(ZWECK_JE_TEIL)) assert.ok(kenntZweck(id), id);
});

test("der Bericht der Rot-Proben nennt nach der Tabelle je roter Art den Block in eigenen Zeilen, bei Technik und Grün keinen", () => {
  const probe = { fall: "lint-fehler", pr: 1, workflow: "CI", job: "Prüfungen", schritt: "Lint" };
  const durch = alsBericht({ proben: [{ ...probe, ergebnis: rot("durchgegangen") }], menschen: rot("Mit Approve") });
  const zeilen = durch.zeilen.filter((zeile) => zeile !== "");
  const tabelle = zeilen.indexOf("| lint-fehler | #1 | CI / Prüfungen / Lint | durchgegangen |");
  const block = zeilen.indexOf(zweckBlock("github/rotproben")[0]);
  assert.ok(tabelle >= 0 && block > tabelle, durch.zeilen.join("\n"));
  assert.deepEqual(zeilen.slice(block), [...zweckBlock("github/rotproben"), ...zweckBlock("github/ohne-menschen")]);
  assert.equal(durch.zeilen.at(-2), "");
  const leise = alsBericht({ proben: [{ ...probe, ergebnis: gruen("gestoppt") }], push: technisch("Push-Probe nicht ausgeführt") });
  assert.doesNotMatch(leise.zeilen.join("\n"), /Wozu:/);
  assert.equal(leise.urteile.length, 2);
});

function codeownersLauf(context, bauRegeln) {
  const verzeichnis = probeDirectory(context, {
    ".github/CODEOWNERS": OWNERS,
    ".claude/rollen/bau.json": JSON.stringify({ permissions: { deny: bauRegeln } }),
    ".claude/rollen/test.json": JSON.stringify({ permissions: { deny: ["Edit(tools/**)", "Edit(src/**)"] } }),
  });
  return runIn(REPO_ROOT, process.execPath, [join(REPO_ROOT, "tools/codeowners-abgleich.mjs"), verzeichnis]);
}

test("der CODEOWNERS-Abgleich nennt bei Rot den Block auf stdout und lässt die Befundzeilen auf stderr allein", (context) => {
  const lauf = codeownersLauf(context, ["Edit(tools/**)", "Edit(test/**)", "Edit(scripts/**)"]);
  assert.equal(lauf.status, EXIT_BEFUND, lauf.stderr);
  assert.deepEqual(outputLines(lauf.stderr), ["nur in .claude/rollen/bau.json, nicht in .github/CODEOWNERS: scripts/**"]);
  assert.equal(lauf.stdout, `${zweckBlock("github/codeowners").join("\n")}\n`);
  const gruen = codeownersLauf(context, ["Edit(tools/**)", "Edit(test/**)"]);
  assert.equal(gruen.status, EXIT_OK, gruen.stderr);
  assert.equal(`${gruen.stdout}${gruen.stderr}`, "");
});

test("Workflows prüfen nennt bei Rot den Block auf stdout und lässt die Befundzeilen auf stderr allein", (context) => {
  const kopf = ["name: Probe", "on: push", "permissions: {}", "jobs:", "  probe:", "    runs-on: ubuntu-latest", "    steps:"];
  const verzeichnis = probeDirectory(context, { "probe.yml": [...kopf, "      - run: make || true", ""].join("\n") });
  const lauf = runIn(REPO_ROOT, process.execPath, [join(REPO_ROOT, "tools/workflows-pruefen.mjs"), verzeichnis, join(verzeichnis, "keine")]);
  assert.equal(lauf.status, EXIT_BEFUND, lauf.stderr);
  assert.ok(outputLines(lauf.stderr).every((zeile) => zeile.startsWith(join(verzeichnis, "probe.yml:"))), lauf.stderr);
  assert.equal(lauf.stdout, `${zweckBlock("github/workflows").join("\n")}\n`);
});

function testschutzRepo(context) {
  const vorher = ['import { test } from "node:test";', 'test("eins", () => { if (1 !== 1) throw new Error(); });', ""];
  const verzeichnis = probeRepository(context, { "tools/gate-tests.json": "{}\n", "test/eins.test.js": vorher.join("\n") });
  writeFiles(verzeichnis, { "test/eins.test.js": vorher.join("\n").replace("1 !== 1", "1 !== 2") });
  commitAll(verzeichnis, "Test geändert");
  return verzeichnis;
}

test("der Testschutz nennt nach den Befundzeilen ohne Freigabe den Block", async (context) => {
  const verzeichnis = testschutzRepo(context);
  const github = await scheinGithub(context, new Map([[`GET ${API_PFAD}/pulls/${PR}`, { body: "", head: { ref: "paket/probe" } }]]));
  const lauf = await starteWerkzeug([join(REPO_ROOT, "tools/tests-nur-ergaenzt.mjs"), "--basis", "HEAD~1", "--pr", String(PR)], {
    cwd: verzeichnis,
    umgebung: { GITHUB_API_URL: github.url, GITHUB_TOKEN: "probe", GITHUB_REPOSITORY: REPO },
  });
  assert.equal(lauf.status, EXIT_BEFUND, lauf.stdout + lauf.stderr);
  const zeilen = outputLines(lauf.stderr);
  assert.deepEqual(zeilen.slice(-zweckBlock("github/testschutz").length), zweckBlock("github/testschutz"));
  assert.ok(ohneZweck(zeilen).some((zeile) => zeile.includes("test/eins.test.js, Testfall „eins“")), lauf.stderr);
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
