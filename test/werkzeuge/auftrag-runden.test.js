import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, isolatedEnvironment, passingTest, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const AUSFUEHRBAR = 0o755;
const EXIT_ROT = 1;
const ISSUE = 54;
const ZWEITE_RUNDE = 2;
const PROBE = "probe@example.invalid";

const CLAUDE = `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const ort = dirname(process.env.ERSATZ_DREHBUCH);
const rolle = process.env.HERMES_ROLLE;
const zaehler = join(ort, "anzahl-" + rolle);
const nummer = existsSync(zaehler) ? Number(readFileSync(zaehler, "utf8")) : 0;
writeFileSync(zaehler, String(nummer + 1));
const liste = JSON.parse(readFileSync(process.env.ERSATZ_DREHBUCH, "utf8"))[rolle] ?? [{}];
const einsatz = liste[Math.min(nummer, liste.length - 1)];
appendFileSync(join(ort, "prompt-" + rolle + ".txt"), readFileSync(0, "utf8") + "\\n");
appendFileSync(join(ort, "starts.txt"), rolle + " " + Date.now() + "\\n");
for (const [pfad, inhalt] of Object.entries(einsatz.dateien ?? {})) writeFileSync(pfad, inhalt);
const zeige = (ereignis) => process.stdout.write(JSON.stringify(ereignis) + "\\n");
(einsatz.zeilen ?? []).forEach(zeige);
for (let runde = 0; einsatz.schleife && runde < 500; runde += 1) {
  einsatz.schleife.forEach(zeige);
  await new Promise((weiter) => setTimeout(weiter, 20));
}
if (einsatz.limit) {
  zeige({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: Math.ceil(Date.now() / 1000) + 2 } });
  process.exitCode = 1;
}
zeige({ type: "result", is_error: Boolean(einsatz.limit), result: einsatz.limit ? "Usage limit reached" : einsatz.antwort ?? "fertig" });
`;

const GH = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const eingabe = process.argv.includes("-") ? readFileSync(0, "utf8") : "";
appendFileSync(process.env.ERSATZ_GH, JSON.stringify([...process.argv.slice(2), eingabe]) + "\\n");
`;

const REPO = {
  ".gitignore": ".fortschritt/\n",
  "src/zahl.js": "export const ZAHL = 1;\n",
  "test/zahl.test.js": passingTest("zahl"),
  "package.json": JSON.stringify({ type: "module", scripts: { lint: "node -e 0", "test:betroffen": "node -e 0 --", test: "node --test" } }),
};

const ZAHL = "src/zahl.js";
const AUFTRAG = { id: "A1", art: "umbau", ziel: "Räume zahl auf", bereich: ZAHL, erwarteteDateien: [ZAHL], vorbild: ZAHL, abnahme: "test/zahl.test.js" };

const aufruf = (name, input) => ({ type: "assistant", message: { content: [{ type: "tool_use", id: name, name, input }] } });
const rueckgabe = (id, content) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content }] } });
const pruefleiter = (zeilen) => [
  aufruf("Edit", {}),
  { type: "system", subtype: "hook_response", hook_event: "Stop", stderr: zeilen.join("\n") },
];

function lauf(context, drehbuch) {
  const repo = probeRepository(context, REPO);
  const phase = { phase: "probe", issue: ISSUE, entwurf: { [AUFTRAG.bereich]: "Entwurf." }, auftraege: [AUFTRAG] };
  const werkzeug = probeDirectory(context, {
    "claude.mjs": CLAUDE,
    "gh.mjs": GH,
    "drehbuch.json": JSON.stringify(drehbuch),
    "phase.json": JSON.stringify(phase),
  });
  for (const name of ["claude.mjs", "gh.mjs"]) chmodSync(join(werkzeug, name), AUSFUEHRBAR);
  const ergebnis = spawnSync(process.execPath, [join(REPO_ROOT, "tools/auftrag.mjs"), "lauf", join(werkzeug, "phase.json")], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...isolatedEnvironment(),
      HOME: werkzeug,
      HERMES_CLAUDE: join(werkzeug, "claude.mjs"),
      HERMES_GH: join(werkzeug, "gh.mjs"),
      ERSATZ_DREHBUCH: join(werkzeug, "drehbuch.json"),
      ERSATZ_GH: join(werkzeug, "gh.log"),
      ...Object.fromEntries(["AUTHOR", "COMMITTER"].flatMap((rolle) => [[`GIT_${rolle}_NAME`, "Probe"], [`GIT_${rolle}_EMAIL`, PROBE]])),
    },
  });
  const lies = (pfad) => (existsSync(pfad) ? readFileSync(pfad, "utf8") : "");
  const beleg = (name) => JSON.parse(lies(join(repo, ".fortschritt/probe", `${name}.json`)) || "null");
  return { repo, ergebnis, beleg, datei: (name) => lies(join(werkzeug, name)) };
}

test("eine Werkzeugschleife stoppt den Agenten, die zweite Runde bekommt die Fehlerausgabe, danach folgt die Entscheidungsnotiz", (context) => {
  const schleife = [aufruf("Bash", { command: "npm test" }), rueckgabe("Bash", "1 rot")];
  const { ergebnis, beleg, datei } = lauf(context, { bau: [{ schleife }], notiz: [{ antwort: "1. Bereich erweitern" }] });
  assert.equal(ergebnis.status, EXIT_ROT);
  const { grund, runde, runden } = beleg("A1");
  assert.match(grund, /^Stillstand: Bash lief dreimal mit derselben Eingabe und lieferte dasselbe Ergebnis/);
  assert.equal(runde, ZWEITE_RUNDE);
  assert.match(runden[0], /^Runde 1: Stillstand: Bash/);
  assert.match(datei("prompt-bau.txt"), /Fehlerausgabe der vorigen Runde[\s\S]*Runde 1: Stillstand: Bash/);
  assert.match(datei("gh.log"), new RegExp(`"comment","${ISSUE}".*Entscheidung nötig.*Bereich erweitern`));
  assert.ok(datei("gh.log").includes(`"edit","${ISSUE}","--add-label","entscheidung"`));
});

test("dreimal dieselbe Prüfleiter-Meldung aus dem Auftrag trotz Änderung stoppt den Agenten, fremde rote Tests zählen nicht", (context) => {
  const fremd = "✗ fremd (test/fremd.test.js:1:1)";
  const zeilen = [...pruefleiter([fremd]), ...pruefleiter([fremd]), ...pruefleiter([fremd])];
  const bau = [{ zeilen, schleife: pruefleiter(["✗ zählt (test/zahl.test.js:3:1)", fremd]) }];
  const { grund, agenten } = lauf(context, { bau }).beleg("A1");
  assert.match(grund, /^Stillstand: Die Prüfleiter meldete dreimal hintereinander dieselbe Fehlermeldung.*✗ zählt \(test\/zahl\.test\.js\)$/);
  assert.deepEqual(agenten[0].fremdeBefunde, [fremd]);
});

test("„Voraussetzung fehlt“ verwirft die Arbeit, baut erst einen Umbau-Auftrag und geht beim zweiten Mal zurück in die Entwurfsprüfung", (context) => {
  const umbau = { ziel: "Lege text an", bereich: "src/text.js", erwarteteDateien: ["src/text.js"], vorbild: "src/zahl.js" };
  const plan = [{ antwort: JSON.stringify({ ...umbau, abnahme: "test/zahl.test.js", entwurf: "Text anlegen." }) }];
  const bau = [
    { dateien: { "src/zahl.js": "kaputt\n" }, antwort: "Voraussetzung fehlt: Es braucht zuerst src/text.js." },
    { dateien: { "src/text.js": "export const TEXT = 1;\n" } },
    { antwort: "Voraussetzung fehlt: Es fehlt noch mehr." },
  ];
  const { repo, ergebnis, beleg } = lauf(context, { bau, plan });
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.equal(beleg("A1-plan").grund, "Voraussetzung fehlt: Es braucht zuerst src/text.js.");
  assert.equal(beleg("A1-umbau").ergebnis, "grün");
  const { ergebnis: urteil, runde, grund } = beleg("A1");
  assert.deepEqual([urteil, runde], ["entwurfsprüfung", 1]);
  assert.match(grund, /^Zurück in die Entwurfsprüfung: Voraussetzung fehlt zum zweiten Mal: Es fehlt noch mehr\.$/);
  assert.equal(runIn(repo, "git", ["log", "-1", "--format=%s"]).stdout.trim(), "Lege text an");
  assert.equal(runIn(repo, "git", ["status", "--porcelain"]).stdout, "");
});

test("ein voller Kontext geht an einen frischen Agenten; nach der Limit-Meldung startet der nächste erst nach dem Zurücksetzen", (context) => {
  const voll = { type: "assistant", message: { usage: { input_tokens: 100_000 }, content: [{ type: "text", text: "Halbzeit" }] } };
  const bau = [{ zeilen: [voll], schleife: [] }, { limit: true }, { dateien: { "src/zahl.js": "export const ZAHL = 2;\n" } }];
  const { ergebnis, beleg, datei } = lauf(context, { bau });
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
  const [uebergeben, abgebrochen, weiter] = beleg("A1").agenten;
  assert.match(uebergeben.grund, /^Übergabe: Der Kontext erreichte 100000 Token/);
  assert.match(datei("prompt-bau.txt"), /## Übergabe[\s\S]*Halbzeit/);
  assert.match(abgebrochen.grund, /^Nutzungslimit erreicht; das Skript startet neue Agenten erst ab \S+ und macht dann weiter\.$/);
  const freigabe = Date.parse(/ab (\S+) und/.exec(abgebrochen.grund)[1]);
  const starts = datei("starts.txt").trim().split("\n").map((zeile) => Number(zeile.split(" ")[1]));
  assert.ok(starts.at(-1) >= freigabe, `${starts.at(-1)} < ${freigabe}`);
  assert.equal(weiter.exitCode, 0);
});
