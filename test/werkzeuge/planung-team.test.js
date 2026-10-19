import assert from "node:assert/strict";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { planBericht } from "../../tools/auftrag/planung/planbericht.mjs";
import { Abbruch, Team, abdruck, abdruckUnterschiede, rollenStart } from "../../tools/auftrag/planung/team.mjs";
import { REPO_ROOT, commitAll, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const AUFTRAG = join(REPO_ROOT, "tools/auftrag.mjs");
const OHNE_WERKZEUG = ["planer", "entwurf"];
const NUR_LESEN = ["erkunder", "pruefer-planung"];
const VERBOTENE_WERKZEUGE = ["Agent", "Write", "Edit"];
const FREIGABEN = ["Bash(node tools/auftrag.mjs karte:*)", "Bash(node tools/auftrag.mjs suche:*)", "Bash(node tools/auftrag.mjs dateien:*)"];
const SPERREN = ["Read(.env*)", "Read(data/**)", "Edit", "Write", "Bash(rm:*)", "Bash(mv:*)", "Bash(cp:*)", "Bash(touch:*)", "Bash(mkdir:*)", "Bash(rmdir:*)", "Bash(sed:*)"];
const ORDNER = "plaene/P-009-probe";
const EXIT_GRUEN = 0;
const EXIT_AUFRUF = 2;
const ALTE_ZEIT = new Date("2020-01-01T00:00:00Z");
const AUSFUEHRBAR = 0o755;
const NICHT_AUSFUEHRBAR = 0o644;
const VIELE_DATEIEN = 6000;
const LANGER_NAME = "n".repeat(200);
const UNGUELTIGER_BAUM = "1".repeat(40);
const ANDERER_UNGUELTIGER_BAUM = "2".repeat(40);
const KONFIGURATION_GEAENDERT = /planer haben (.+, )?\.git\/config(, | geändert)/;

function wertNach(argumente, schalter) {
  const stelle = argumente.indexOf(schalter);
  assert.notEqual(stelle, -1, `${schalter} fehlt in ${argumente.join(" ")}`);
  return argumente[stelle + 1];
}

function definition(rolle) {
  const { argumente } = rollenStart(REPO_ROOT, rolle);
  return JSON.parse(wertNach(argumente, "--agents"))[rolle];
}

function einstellungen(rolle) {
  const { argumente } = rollenStart(REPO_ROOT, rolle);
  return JSON.parse(readFileSync(join(REPO_ROOT, wertNach(argumente, "--settings")), "utf8"));
}

function probe(context) {
  return probeRepository(context, {
    ".gitignore": ".fortschritt/\ndata/\n.env\ncoverage/\n",
    "package.json": '{"name": "--no-index"}\n',
    "src/eins.js": "export const eins = 1;\n",
    [`${ORDNER}/pitch.md`]: "# Pitch\n",
    ".claude/rollen/bau.json": "{}\n",
  });
}

function git(ort, ...argumente) {
  const lauf = runIn(ort, "git", argumente);
  assert.equal(lauf.status, 0, lauf.stderr);
  return lauf.stdout.trim();
}

function probeMitMelder(context) {
  const ort = probe(context);
  const ablage = probeDirectory(context, {});
  const marke = join(ablage, "ausgefuehrt");
  const skript = join(ablage, "melde.sh");
  writeFileSync(skript, `#!/bin/sh\necho "$0" >> "${marke}"\ncat\n`, { mode: AUSFUEHRBAR });
  git(ort, "config", "core.fsmonitor", skript);
  writeFileSync(join(ort, ".git/hooks/post-index-change"), `#!/bin/sh\nexec "${skript}" </dev/null\n`, { mode: AUSFUEHRBAR });
  return { ort, marke, skript };
}

function assertMelderLiefNicht(marke) {
  assert.equal(existsSync(marke), false, existsSync(marke) ? readFileSync(marke, "utf8") : "");
}

function suche(ort, ...argumente) {
  return runIn(ort, process.execPath, [AUFTRAG, "suche", ...argumente]);
}

function dateien(ort, ...argumente) {
  return runIn(ort, process.execPath, [AUFTRAG, "dateien", ...argumente]);
}

function geaendertNach(ort, aendere) {
  const vorher = abdruck(ort, join(ort, ORDNER));
  aendere();
  return abdruckUnterschiede(ort, vorher, abdruck(ort, join(ort, ORDNER)));
}

test("team: Planer und Entwurf-Schreiber starten ohne jedes Werkzeug", () => {
  for (const rolle of OHNE_WERKZEUG) {
    assert.deepEqual(definition(rolle).tools, []);
    assert.equal(wertNach(rollenStart(REPO_ROOT, rolle).argumente, "--tools"), "");
  }
});

test("team: Erkunder und Prüfer starten mit genau Read und Bash", () => {
  for (const rolle of NUR_LESEN) {
    assert.deepEqual(definition(rolle).tools, ["Read", "Bash"]);
    assert.equal(wertNach(rollenStart(REPO_ROOT, rolle).argumente, "--tools"), "Read,Bash");
  }
});

test("team: keine Rolle des Planungsteams bekommt Agent, Write oder Edit", () => {
  for (const rolle of [...OHNE_WERKZEUG, ...NUR_LESEN]) {
    const gestartet = wertNach(rollenStart(REPO_ROOT, rolle).argumente, "--tools").split(",");
    assert.deepEqual(VERBOTENE_WERKZEUGE.filter((werkzeug) => definition(rolle).tools.includes(werkzeug) || gestartet.includes(werkzeug)), []);
  }
});

test("team: Erkunder und Prüfer dürfen in Bash nur karte, suche und dateien", () => {
  for (const rolle of NUR_LESEN) assert.deepEqual(einstellungen(rolle).permissions.allow, FREIGABEN);
  for (const rolle of OHNE_WERKZEUG) assert.equal(einstellungen(rolle).permissions.allow, undefined);
});

test("team: jede Rolle sperrt .env, data, Edit, Write und die Dateibefehle und schaltet die Sandbox ein", () => {
  for (const rolle of [...OHNE_WERKZEUG, ...NUR_LESEN]) {
    const { permissions, sandbox } = einstellungen(rolle);
    assert.deepEqual(SPERREN.filter((sperre) => !permissions.deny.includes(sperre)), [], rolle);
    assert.equal(sandbox.enabled, true);
    assert.equal(sandbox.allowUnsandboxedCommands, false);
    assert.equal(sandbox.autoAllowBashIfSandboxed, false);
    assert.deepEqual(sandbox.filesystem.denyWrite, ["../.."]);
  }
});

test("team: jede Rolle sperrt das Lesen aller Pfade, die das Projekt sperrt", () => {
  const { permissions } = JSON.parse(readFileSync(join(REPO_ROOT, ".claude/settings.json"), "utf8"));
  const projekt = permissions.deny.filter((regel) => regel.startsWith("Read("));
  assert.ok(projekt.length > 0, "das Projekt sperrt kein Lesen");
  for (const rolle of [...OHNE_WERKZEUG, ...NUR_LESEN]) {
    assert.deepEqual(projekt.filter((regel) => !einstellungen(rolle).permissions.deny.includes(regel)), [], rolle);
  }
});

test("team: der Start läuft eingeschränkt, ohne fremde MCP-Server, mit Aufwand und Rolle aus der Agentendatei", () => {
  const { agent, argumente } = rollenStart(REPO_ROOT, "erkunder");
  assert.equal(agent, "erkunder");
  assert.equal(argumente[0], "--restricted");
  assert.ok(argumente.includes("--strict-mcp-config"));
  assert.equal(wertNach(argumente, "--effort"), "medium");
  assert.equal(wertNach(argumente, "--settings"), ".claude/rollen/erkunder.json");
  const erkunder = definition("erkunder");
  assert.equal(erkunder.model, "sonnet");
  assert.ok(erkunder.prompt.startsWith("Du bist ein Erkunder"));
  assert.ok(!erkunder.prompt.includes("---"));
  assert.equal(definition("planer").model, "opus");
});

test("team: der Abdruck bleibt gleich, wenn niemand etwas ändert", (context) => {
  const ort = probe(context);
  assert.deepEqual(geaendertNach(ort, () => {}), []);
});

test("team: der Abdruck sieht geänderte, neue und ignorierte Dateien, nicht aber planung und den Planungsbericht", (context) => {
  const ort = probe(context);
  assert.deepEqual(geaendertNach(ort, () => writeFileSync(join(ort, "src/eins.js"), "export const eins = 2;\n")), ["src/eins.js"]);
  assert.deepEqual(geaendertNach(ort, () => writeFileSync(join(ort, "src/neu.js"), "neu\n")), ["src/neu.js"]);
  assert.deepEqual(geaendertNach(ort, () => writeFileSync(join(ort, ".claude/rollen/bau.json"), '{"a": 1}\n')), [".claude/rollen/bau.json"]);
  assert.deepEqual(geaendertNach(ort, () => writeFileSync(join(ort, ".env"), "GEHEIM=1\n")), [".env"]);
  assert.deepEqual(geaendertNach(ort, () => {
    mkdirSync(join(ort, "data"), { recursive: true });
    writeFileSync(join(ort, "data/state.json"), "{}\n");
  }), ["data/state.json"]);
  assert.deepEqual(geaendertNach(ort, () => writeFileSync(join(ort, ORDNER, "pitch.md"), "# Pitch geändert\n")), [`${ORDNER}/pitch.md`]);
  assert.deepEqual(geaendertNach(ort, () => {
    mkdirSync(join(ort, ORDNER, "planung"), { recursive: true });
    writeFileSync(join(ort, ORDNER, "planung/schnitt.json"), "{}\n");
    mkdirSync(join(ort, ".fortschritt/P-009-probe"), { recursive: true });
    writeFileSync(join(ort, ".fortschritt/P-009-probe/planung.json"), "{}\n");
  }), []);
});

test("team: der Abdruck sieht eine Änderung gleicher Größe mit derselben Änderungszeit wie im Index", (context) => {
  const ort = probe(context);
  const datei = join(ort, "src/eins.js");
  utimesSync(datei, ALTE_ZEIT, ALTE_ZEIT);
  assert.equal(runIn(ort, "git", ["add", "src/eins.js"]).status, 0);
  assert.deepEqual(geaendertNach(ort, () => {
    writeFileSync(datei, "export const eins = 9;\n");
    utimesSync(datei, ALTE_ZEIT, ALTE_ZEIT);
  }), ["src/eins.js"]);
});

test("team: der Abdruck sieht Änderungen an Git-Konfiguration, Hooks und info", (context) => {
  const ort = probe(context);
  writeFileSync(join(ort, ".git/hooks/pre-push"), "#!/bin/sh\n", { mode: NICHT_AUSFUEHRBAR });
  assert.deepEqual(geaendertNach(ort, () => appendFileSync(join(ort, ".git/config"), "[probe]\n\twert = 1\n")), [".git/config"]);
  assert.deepEqual(geaendertNach(ort, () => writeFileSync(join(ort, ".git/hooks/pre-commit"), "#!/bin/sh\n", { mode: AUSFUEHRBAR })), [".git/hooks/pre-commit"]);
  assert.deepEqual(geaendertNach(ort, () => chmodSync(join(ort, ".git/hooks/pre-push"), AUSFUEHRBAR)), [".git/hooks/pre-push"]);
  assert.deepEqual(geaendertNach(ort, () => writeFileSync(join(ort, ".git/info/exclude"), "src/\n")), [".git/info/exclude"]);
});

function probeMitZweitemWorktree(context) {
  const ort = probe(context);
  const zweiter = join(probeDirectory(context, {}), "zweiter");
  git(ort, "worktree", "add", "-q", "-b", "anderer", zweiter);
  return { ort, zweiter };
}

async function gruppeMit(ort, aendere) {
  const team = new Team(ort, join(ort, ORDNER));
  return team.gruppe([{ rolle: "planer", lauf: async () => {
    aendere();
  } }]);
}

test("team: legt ein anderer Worktree während einer Gruppe einen Branch mit Tracking an oder löscht ihn, bricht die Gruppe nicht ab", async (context) => {
  const { ort, zweiter } = probeMitZweitemWorktree(context);
  await assert.doesNotReject(gruppeMit(ort, () => git(zweiter, "branch", "--track", "spaeter.v2", "anderer")));
  await assert.doesNotReject(gruppeMit(ort, () => git(zweiter, "config", "branch.anderer.remote", "upstream")));
  await assert.doesNotReject(gruppeMit(ort, () => git(zweiter, "branch", "-D", "spaeter.v2")));
});

test("team: ändern sich Hooks-Pfad, Eintrag des eigenen Branches, Remote oder Include in der gemeinsamen Konfiguration, bricht die Gruppe weiter ab", async (context) => {
  const { ort, zweiter } = probeMitZweitemWorktree(context);
  const eigener = git(ort, "symbolic-ref", "--short", "HEAD");
  await assert.rejects(gruppeMit(ort, () => git(zweiter, "config", "core.hooksPath", "/tmp/fremde-hooks")), KONFIGURATION_GEAENDERT);
  await assert.rejects(gruppeMit(ort, () => git(zweiter, "config", `branch.${eigener}.remote`, "upstream")), KONFIGURATION_GEAENDERT);
  await assert.rejects(gruppeMit(ort, () => git(zweiter, "config", "remote.x.url", "https://example.invalid/x.git")), KONFIGURATION_GEAENDERT);
  await assert.rejects(gruppeMit(ort, () => git(zweiter, "config", "include.path", "/tmp/fremde-konfiguration")), KONFIGURATION_GEAENDERT);
  await assert.rejects(gruppeMit(ort, () => git(zweiter, "config", "branch.autoSetupMerge", "always")), KONFIGURATION_GEAENDERT);
});

test("team: steht HEAD auf keinem Branch, bricht auch ein fremder Branch-Eintrag die Gruppe ab", async (context) => {
  const { ort, zweiter } = probeMitZweitemWorktree(context);
  git(ort, "checkout", "-q", "--detach");
  await assert.rejects(gruppeMit(ort, () => git(zweiter, "config", "branch.anderer.remote", "upstream")), KONFIGURATION_GEAENDERT);
});

test("team: der Abdruck sieht eine Änderung am Index und eine Datei, die der Index als unverändert führt", (context) => {
  const ort = probe(context);
  const fremd = git(ort, "rev-parse", "HEAD:package.json");
  assert.deepEqual(geaendertNach(ort, () => git(ort, "update-index", "--cacheinfo", `100644,${fremd},src/eins.js`)), [".git/index"]);
  git(ort, "update-index", "--cacheinfo", `100644,${git(ort, "rev-parse", "HEAD:src/eins.js")},src/eins.js`);
  git(ort, "update-index", "--assume-unchanged", "src/eins.js");
  assert.deepEqual(geaendertNach(ort, () => writeFileSync(join(ort, "src/eins.js"), "export const eins = 3;\n")), ["src/eins.js"]);
});

test("team: der Abdruck sieht einen verschobenen Stand von HEAD", (context) => {
  const ort = probe(context);
  const neu = git(ort, "-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "Probe");
  assert.deepEqual(geaendertNach(ort, () => git(ort, "update-ref", "HEAD", neu)), ["HEAD"]);
});

test("team: der Abdruck führt keinen Befehl aus der Git-Konfiguration des Repos aus", (context) => {
  const { ort, marke, skript } = probeMitMelder(context);
  git(ort, "config", "filter.probe.clean", skript);
  writeFileSync(join(ort, ".git/info/attributes"), "* filter=probe\n");
  abdruck(ort, join(ort, ORDNER));
  assertMelderLiefNicht(marke);
});

test("team: der Abdruck legt keinen Inhalt einer über info/exclude ignorierten Datei in der Objektablage ab und sieht ihre Änderung", (context) => {
  const ort = probe(context);
  writeFileSync(join(ort, ".git/info/exclude"), "lokal-geheim.txt\n");
  writeFileSync(join(ort, "lokal-geheim.txt"), "nur-lokal-4711\n");
  const inhalt = git(ort, "hash-object", "lokal-geheim.txt");
  assert.deepEqual(geaendertNach(ort, () => writeFileSync(join(ort, "lokal-geheim.txt"), "nur-lokal-4712\n")), ["lokal-geheim.txt"]);
  assert.notEqual(runIn(ort, "git", ["cat-file", "-e", inhalt]).status, 0, "der Inhalt der ignorierten Datei liegt in der Objektablage");
});

test("team: der Abdruck sieht eine Änderung, die ein ident-Attribut im Arbeitsbaum verdecken würde", (context) => {
  const ort = probeRepository(context, {
    ".gitattributes": "*.js ident\n",
    "src/gesperrt.js": 'export const gesperrt = "$Id: x $" && true;\n',
  });
  assert.deepEqual(geaendertNach(ort, () => writeFileSync(join(ort, "src/gesperrt.js"), 'export const gesperrt = "$Id: " && false && "$" && true;\n')), ["src/gesperrt.js"]);
});

test("team: der Abdruck sieht neue Dateien in jedem ignorierten Ordner", (context) => {
  const ort = probe(context);
  assert.deepEqual(geaendertNach(ort, () => {
    mkdirSync(join(ort, "coverage"), { recursive: true });
    writeFileSync(join(ort, "coverage/probe.js"), "neu\n");
  }), ["coverage/probe.js"]);
});

test("team: der Abdruck erfasst auch mehr ignorierte Dateien, als eine Ausgabe von Git im Standardpuffer fasst", (context) => {
  const ort = probe(context);
  mkdirSync(join(ort, "coverage"), { recursive: true });
  for (let nummer = 0; nummer < VIELE_DATEIEN; nummer += 1) writeFileSync(join(ort, "coverage", `${LANGER_NAME}-${nummer}`), "");
  assert.equal(Object.keys(abdruck(ort, join(ort, ORDNER)).dateien).filter((pfad) => pfad.startsWith("coverage/")).length, VIELE_DATEIEN);
});

test("team: der Abdruck sieht eine ignorierte Datei mit gleicher Größe und zurückgesetzter Änderungszeit", (context) => {
  const ort = probe(context);
  mkdirSync(join(ort, "data"), { recursive: true });
  writeFileSync(join(ort, ".env"), "GEHEIM=1\n");
  writeFileSync(join(ort, "data/state.json"), '{"a":1}\n');
  utimesSync(join(ort, ".env"), ALTE_ZEIT, ALTE_ZEIT);
  utimesSync(join(ort, "data/state.json"), ALTE_ZEIT, ALTE_ZEIT);
  assert.deepEqual(geaendertNach(ort, () => {
    writeFileSync(join(ort, ".env"), "GEHEIM=2\n");
    writeFileSync(join(ort, "data/state.json"), '{"a":2}\n');
    utimesSync(join(ort, ".env"), ALTE_ZEIT, ALTE_ZEIT);
    utimesSync(join(ort, "data/state.json"), ALTE_ZEIT, ALTE_ZEIT);
  }), [".env", "data/state.json"]);
});

test("team: scheitert der Vergleich der Bäume, bricht der Abdruck ab, statt keine Änderung zu melden", (context) => {
  const ort = probe(context);
  const echt = abdruck(ort, join(ort, ORDNER));
  assert.throws(() => abdruckUnterschiede(ort, { ...echt, baum: UNGUELTIGER_BAUM }, { ...echt, baum: ANDERER_UNGUELTIGER_BAUM }), /diff-tree/);
});

const VERBINDUNG_WEG = "API Error: Connection dropped (ECONNRESET)";
const LIMIT_SPERRE_MS = 50;
const ERSATZ_CLAUDE = `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
const ort = dirname(process.argv[1]);
const argumente = process.argv.slice(2);
const wert = (schalter) => { const stelle = argumente.indexOf(schalter); return stelle === -1 ? undefined : argumente[stelle + 1]; };
readFileSync(0, "utf8");
const protokoll = join(ort, "aufrufe.jsonl");
const stelle = existsSync(protokoll) ? readFileSync(protokoll, "utf8").trim().split("\\n").length : 0;
const schritt = JSON.parse(readFileSync(join(ort, "folge.json"), "utf8"))[stelle];
appendFileSync(protokoll, JSON.stringify({ resume: wert("--resume"), sitzung: wert("--resume") ?? wert("--session-id") }) + "\\n");
const melde = (zeile) => process.stdout.write(JSON.stringify(zeile) + "\\n");
if (schritt.limit) {
  melde({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: Date.now() + ${LIMIT_SPERRE_MS} } });
  melde({ type: "result", is_error: true, result: "limit reached" });
  process.exit(1);
}
melde({ type: "assistant", message: { id: "m" + stelle, content: [{ type: "text", text: schritt.text }], usage: { input_tokens: 1 } } });
melde({ type: "result", is_error: schritt.exit !== undefined, result: schritt.text });
process.exit(schritt.exit ?? 0);
`;

function teamMitErsatz(context, folge) {
  const ort = probeRepository(context, {
    ".gitignore": ".fortschritt/\n",
    [`${ORDNER}/pitch.md`]: "# Pitch\n",
    ".claude/agents/erkunder.md": "---\ndescription: Probe\ntools: Read\nmodel: sonnet\neffort: low\n---\nProbe\n",
  });
  const ablage = probeDirectory(context, { "folge.json": JSON.stringify(folge) });
  const programm = join(ablage, "claude");
  writeFileSync(programm, ERSATZ_CLAUDE, { mode: AUSFUEHRBAR });
  const vorher = process.env.HERMES_CLAUDE;
  process.env.HERMES_CLAUDE = programm;
  context.after(() => {
    if (vorher === undefined) delete process.env.HERMES_CLAUDE;
    else process.env.HERMES_CLAUDE = vorher;
  });
  const team = new Team(ort, join(ort, ORDNER), { netzWartezeitenMs: [0, 0] });
  const aufrufe = () => readFileSync(join(ablage, "aufrufe.jsonl"), "utf8").trim().split("\n").map((zeile) => JSON.parse(zeile));
  return { team, wer: team.teilnehmer("erkunder"), aufrufe };
}

const JSON_ANTWORT = { text: "Bericht.\n\n```json\n{\"fertig\": true}\n```" };
const NETZABBRUCH = { text: VERBINDUNG_WEG, exit: 1 };

async function assertFortgesetzt({ team, wer, aufrufe }) {
  const antwort = await team.frage(wer, "Erkunde.");
  assert.deepEqual(antwort, { art: "json", wert: { fertig: true } });
  const [erster, zweiter] = aufrufe();
  assert.equal(zweiter.resume, erster.sitzung);
  return erster.sitzung;
}

test("team: bricht die API-Verbindung eines Agenten einmal ab, setzt das Skript dieselbe Sitzung fort und protokolliert den Versuch", async (context) => {
  const probe = teamMitErsatz(context, [NETZABBRUCH, JSON_ANTWORT]);
  const { team } = probe;
  const sitzung = await assertFortgesetzt(probe);
  assert.equal(team.netzabbrueche.length, 1);
  assert.deepEqual({ ...team.netzabbrueche[0], zeit: undefined }, { rolle: "erkunder", sitzung, versuch: 1, zeit: undefined, fehler: VERBINDUNG_WEG, warteS: 0 });
  assert.ok(!Number.isNaN(Date.parse(team.netzabbrueche[0].zeit)));
  assert.deepEqual(team.ruecksendungen, {});
  const bericht = planBericht({ exit: 0, grund: "fertig", annahmen: [], befunde: [], beginn: Date.now() }, { root: team.root, team });
  assert.deepEqual(bericht.netzabbrueche, team.netzabbrueche);
});

test("team: bricht die API-Verbindung dreimal ab, bricht die Planung nach zwei Fortsetzungen ab wie bisher", async (context) => {
  const { team, wer, aufrufe } = teamMitErsatz(context, [NETZABBRUCH, NETZABBRUCH, NETZABBRUCH, JSON_ANTWORT]);
  await assert.rejects(team.frage(wer, "Erkunde."), (fehler) => fehler instanceof Abbruch && fehler.message === "erkunder ist abgestürzt (Exit 1)");
  assert.equal(aufrufe().length, 3);
  assert.deepEqual(team.netzabbrueche.map(({ versuch }) => versuch), [1, 2]);
});

test("team: endet ein Agent mit Exit 1 und einem anderen Fehler, bricht die Planung sofort ab", async (context) => {
  const { team, wer, aufrufe } = teamMitErsatz(context, [{ text: "API Error: 400 invalid_request_error", exit: 1 }, JSON_ANTWORT]);
  await assert.rejects(team.frage(wer, "Erkunde."), (fehler) => fehler instanceof Abbruch && fehler.message === "erkunder ist abgestürzt (Exit 1)");
  assert.equal(aufrufe().length, 1);
  assert.deepEqual(team.netzabbrueche, []);
});

test("team: nach dem Nutzungslimit setzt das Skript dieselbe Sitzung fort, ohne einen Netzabbruch zu zählen", async (context) => {
  const probe = teamMitErsatz(context, [{ limit: true }, JSON_ANTWORT]);
  await assertFortgesetzt(probe);
  assert.deepEqual(probe.team.netzabbrueche, []);
});

test("suche: nennt Treffer mit Datei und Zeile", (context) => {
  const lauf = suche(probe(context), "eins", "src");
  assert.equal(lauf.status, EXIT_GRUEN);
  assert.equal(lauf.stdout, "src/eins.js:1:export const eins = 1;\n");
});

test("suche: ohne Treffer meldet sie „keine Treffer“ mit Exit 0", (context) => {
  const lauf = suche(probe(context), "gibt-es-nicht");
  assert.equal(lauf.status, EXIT_GRUEN);
  assert.equal(lauf.stdout.trim(), "keine Treffer");
});

test("suche: ein Pfad mit .. endet mit Exit 2 und sucht nicht", (context) => {
  const lauf = suche(probe(context), "eins", "../src");
  assert.equal(lauf.status, EXIT_AUFRUF);
  assert.equal(lauf.stdout, "");
});

test("suche: ein Muster mit Strich nach -- ist Text und keine Option für git", (context) => {
  const lauf = suche(probe(context), "--", "--no-index", "package.json");
  assert.equal(lauf.status, EXIT_GRUEN);
  assert.equal(lauf.stdout, 'package.json:1:{"name": "--no-index"}\n');
});

test("suche: ein Muster mit Strich ohne -- endet mit Exit 2", (context) => {
  const lauf = suche(probe(context), "--no-index", "package.json");
  assert.equal(lauf.status, EXIT_AUFRUF);
  assert.equal(lauf.stdout, "");
});

test("suche: gibt keine Zeile aus versionierten .env-Dateien und aus data aus", (context) => {
  const ort = probeRepository(context, {
    ".gitignore": "data/\n",
    "src/eins.js": "eins\n",
    ".env.example": "EINS=eins\n",
    "apps/web/.env.local": "EINS=eins\n",
    "apps/web/.ENV.probe": "EINS=eins\n",
  });
  mkdirSync(join(ort, "data"), { recursive: true });
  writeFileSync(join(ort, "data/state.json"), "eins\n");
  git(ort, "add", "-f", "data/state.json");
  commitAll(ort, "data");
  assert.equal(suche(ort, "eins").stdout, "src/eins.js:1:eins\n");
  for (const pfad of [".env.example", ":(icase).ENV.EXAMPLE", ":(glob)**/.env*", "data"]) {
    const lauf = suche(ort, "eins", pfad);
    assert.equal(lauf.status, EXIT_GRUEN, pfad);
    assert.equal(lauf.stdout.trim(), "keine Treffer", pfad);
  }
});

test("suche: führt keinen Befehl aus der Git-Konfiguration des Repos aus", (context) => {
  const { ort, marke } = probeMitMelder(context);
  assert.equal(suche(ort, "eins", "src").status, EXIT_GRUEN);
  assertMelderLiefNicht(marke);
});

test("dateien: nennt die versionierten Dateien, auf Wunsch nur unter den angegebenen Pfaden", (context) => {
  const ort = probe(context);
  writeFileSync(join(ort, "src/neu.js"), "neu\n");
  const alle = dateien(ort);
  assert.equal(alle.status, EXIT_GRUEN);
  assert.equal(alle.stdout, `.claude/rollen/bau.json\n.gitignore\npackage.json\n${ORDNER}/pitch.md\nsrc/eins.js\n`);
  const unterSrc = dateien(ort, "src", "package.json");
  assert.equal(unterSrc.status, EXIT_GRUEN);
  assert.equal(unterSrc.stdout, "package.json\nsrc/eins.js\n");
});

test("dateien: ohne versionierte Datei unter dem Pfad meldet es „keine Dateien“ mit Exit 0", (context) => {
  const lauf = dateien(probe(context), "gibt-es-nicht");
  assert.equal(lauf.status, EXIT_GRUEN);
  assert.equal(lauf.stdout.trim(), "keine Dateien");
});

test("dateien: ein Pfad mit .. oder ein absoluter Pfad endet mit Exit 2 und listet nichts", (context) => {
  const ort = probe(context);
  for (const pfad of ["../src", join(ort, "src")]) {
    const lauf = dateien(ort, pfad);
    assert.equal(lauf.status, EXIT_AUFRUF, pfad);
    assert.equal(lauf.stdout, "", pfad);
  }
});

test("dateien: eine Option endet mit Exit 2, nach -- ist sie ein Pfad und keine Option für git", (context) => {
  const ort = probe(context);
  writeFileSync(join(ort, "src/neu.js"), "neu\n");
  const option = dateien(ort, "--others");
  assert.equal(option.status, EXIT_AUFRUF);
  assert.equal(option.stdout, "");
  const nachTrenner = dateien(ort, "--", "--others");
  assert.equal(nachTrenner.status, EXIT_GRUEN);
  assert.equal(nachTrenner.stdout.trim(), "keine Dateien");
});

test("dateien: führt keinen Befehl aus der Git-Konfiguration des Repos aus", (context) => {
  const { ort, marke } = probeMitMelder(context);
  assert.equal(dateien(ort, "src").status, EXIT_GRUEN);
  assertMelderLiefNicht(marke);
});
