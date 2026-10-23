import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { UMBAU_AUSWEG } from "../../tools/auftrag/format.mjs";
import { mitErsatzWerkzeugen } from "./ersatz-werkzeuge.js";
import { REPO_ROOT, isolatedEnvironment, passingTest, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const AUSFUEHRBAR = 0o755;
const EXIT_ROT = 1;
const ISSUE = 54;
const ZWEITE_RUNDE = 2;
const PROBE = "probe@example.invalid";
const CODEBLOCK = "```";
const alsBlock = (felder) => `${CODEBLOCK}json\n${JSON.stringify(felder)}\n${CODEBLOCK}`;

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
const ESLINT = join(REPO_ROOT, "node_modules/eslint/bin/eslint.js");
const MIT_ALTFUNKTION = {
  "eslint.config.js": 'export default [{ files: ["**/*.js"], rules: { "no-unused-vars": "error" } }];\n',
  "eslint-suppressions.json": JSON.stringify({ [ZAHL]: { "no-unused-vars": { count: 1 } } }),
  [ZAHL]: "const alt = 1;\nexport const ZAHL = 1;\n",
  "package.json": JSON.stringify({
    type: "module",
    scripts: { lint: `node ${JSON.stringify(ESLINT)} . --pass-on-unpruned-suppressions`, "test:betroffen": "node -e 0 --", test: "node --test" },
  }),
};
const AUFTRAG = { id: "A1", art: "umbau", ziel: "Räume zahl auf", bereich: ZAHL, erwarteteDateien: [ZAHL], vorbild: ZAHL, abnahme: "test/zahl.test.js" };
const ZAHL_ZWEI = "test/zahl-zwei.test.js";
const FUNKTION = { ...AUFTRAG, art: "funktion", erwarteteDateien: [ZAHL, ZAHL_ZWEI], abnahme: ZAHL_ZWEI, erwarteterFehler: "1 !== 2", wasDarfNiePassieren: [] };
const ROTER_TEST = [{ dateien: { [ZAHL_ZWEI]: 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { ZAHL } from "../src/zahl.js";\ntest("zwei", () => assert.equal(ZAHL, 2));\n' } }];

const aufruf = (name, input) => ({ type: "assistant", message: { content: [{ type: "tool_use", id: name, name, input }] } });
const rueckgabe = (id, content) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content }] } });

function lauf(context, { auftrag = AUFTRAG, ...drehbuch }, dateien = {}) {
  const repo = probeRepository(context, { ...REPO, ...dateien });
  const phase = { phase: "probe", issue: ISSUE, entwurf: { [auftrag.bereich]: "Entwurf." }, auftraege: [auftrag] };
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
      ...mitErsatzWerkzeugen(werkzeug),
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

test("„Auftrag passt nicht“ zählt nicht als rote Runde und führt mit dem Grund wörtlich zur Entscheidungsnotiz", (context) => {
  const grund = "Der Abnahmetest verlangt ein Verhalten, das der Entwurf ausschließt.";
  const bau = [{ dateien: { "src/zahl.js": "kaputt\n" }, antwort: `Ich höre auf.\nAuftrag passt nicht: ${grund}` }];
  const { repo, ergebnis, beleg, datei } = lauf(context, { bau, notiz: [{ antwort: "1. Test ändern" }] });
  assert.equal(ergebnis.status, EXIT_ROT);
  const { runde, runden, ausstieg, entscheidung } = beleg("A1");
  assert.deepEqual([runde, runden, ausstieg], [1, [], grund]);
  assert.ok(entscheidung.text.includes(`\nAuftrag passt nicht: ${grund}\n`), entscheidung.text);
  assert.ok(datei("gh.log").includes(`Auftrag passt nicht: ${grund}`));
  assert.equal(datei("anzahl-bau"), "1");
  assert.equal(runIn(repo, "git", ["status", "--porcelain"]).stdout, "");
});

test("die letzte Antwort des Bau-Agenten steht als Hinweis in der Fehlerausgabe der zweiten Runde und in der Notiz", (context) => {
  const fremd = { "fremd.js": "x\n" };
  const bau = [
    { dateien: fremd, antwort: "Ich brauche fremd.js." },
    { dateien: fremd, antwort: "Ohne fremd.js geht es nicht.\nPaket: 99" },
  ];
  const { beleg, datei } = lauf(context, { bau, notiz: [{ antwort: "1. Bereich erweitern" }] });
  assert.match(datei("prompt-bau.txt"), /Fehlerausgabe der vorigen Runde[\s\S]*Hinweise des Bau-Agenten:\n> Ich brauche fremd\.js\./);
  const { runden, entscheidung } = beleg("A1");
  assert.equal(runden.length, ZWEITE_RUNDE);
  assert.ok(entscheidung.text.includes("Hinweise des Bau-Agenten:\n> Ohne fremd.js geht es nicht.\n> Paket: 99\n"), entscheidung.text);
});

test("„Voraussetzung fehlt“ verwirft die Arbeit, baut erst einen Umbau-Auftrag und geht beim zweiten Mal zurück in die Entwurfsprüfung", (context) => {
  const umbau = { ziel: "Lege text an", bereich: "src/text.js", erwarteteDateien: ["src/text.js"], vorbild: "src/zahl.js" };
  const plan = [{ antwort: alsBlock({ ...umbau, abnahme: "test/zahl.test.js", entwurf: "Text anlegen." }) }];
  const bau = [
    { dateien: { "src/zahl.js": "kaputt\n" }, antwort: "Voraussetzung fehlt: Es braucht zuerst src/text.js." },
    { dateien: { "src/text.js": "export const TEXT = 1;\n" } },
    { antwort: "Voraussetzung fehlt: Es fehlt noch mehr." },
  ];
  const { repo, ergebnis, beleg } = lauf(context, { bau, plan, test: ROTER_TEST, auftrag: FUNKTION });
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.equal(beleg("A1-plan").grund, "Voraussetzung fehlt: Es braucht zuerst src/text.js.");
  assert.equal(beleg("A1-umbau").ergebnis, "grün");
  const { ergebnis: urteil, runde, grund } = beleg("A1");
  assert.deepEqual([urteil, runde], ["entwurfsprüfung", 1]);
  assert.match(grund, /^Zurück in die Entwurfsprüfung: Voraussetzung fehlt zum zweiten Mal: Es fehlt noch mehr\.$/);
  assert.equal(runIn(repo, "git", ["log", "-1", "--format=%s"]).stdout.trim(), "Lege text an");
  assert.equal(runIn(repo, "git", ["status", "--porcelain"]).stdout, "");
});

const ALTFUNKTION_FEHLT = `Voraussetzung fehlt: Altfunktionen aufräumen: ${ZAHL}:alt`;
const ALTFUNKTION_UMBAU = { ziel: "Räume die Altfunktion alt auf", bereich: ZAHL, erwarteteDateien: [ZAHL], abnahme: "test/zahl.test.js" };

function raeumtAltfunktionAuf(context, planAntwort) {
  const bau = [
    { antwort: ALTFUNKTION_FEHLT },
    { dateien: { [ZAHL]: "export const ZAHL = 1;\n" } },
    { dateien: { [ZAHL]: "export const ZAHL = 2;\n" } },
  ];
  const { repo, ergebnis, beleg, datei } = lauf(context, { bau, plan: [{ antwort: planAntwort }], test: ROTER_TEST, auftrag: FUNKTION }, MIT_ALTFUNKTION);
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr + JSON.stringify(beleg("A1-plan")?.befunde));
  const git = (...args) => runIn(repo, "git", args).stdout.trim();
  assert.deepEqual(git("log", "--format=%s").split("\n"), [AUFTRAG.ziel, ALTFUNKTION_UMBAU.ziel, "Basis"]);
  assert.match(beleg("A1-plan").grund, /^Voraussetzung fehlt: Altfunktionen aufräumen: src\/zahl\.js:alt$/);
  assert.deepEqual(git("show", "--name-only", "--format=", "HEAD~1").split("\n").sort(), ["eslint-suppressions.json", ZAHL]);
  const vorher = JSON.parse(git("show", "HEAD~2:eslint-suppressions.json"));
  const nachher = JSON.parse(git("show", "HEAD~1:eslint-suppressions.json"));
  assert.deepEqual([Object.keys(vorher), Object.keys(nachher)], [[ZAHL], []]);
  assert.equal(datei("anzahl-bau"), String(bau.length));
  return beleg("A1-plan").umbau;
}

test("„Altfunktionen aufräumen“ baut erst einen Umbau, der eslint-suppressions.json kürzt, und startet dann den Auftrag neu", (context) => {
  raeumtAltfunktionAuf(context, alsBlock({ ...ALTFUNKTION_UMBAU, entwurf: "Die ungenutzte Variable alt fällt weg." }));
});

test("ein Umbau-Vorschlag, dessen JSON länger als 1000 Zeichen ist, wird aus der vollständigen Antwort gelesen", (context) => {
  const entwurf = `Die ungenutzte Variable alt fällt weg. ${"Der Default { record: async () => {} } bleibt gleich. ".repeat(30)}`;
  const vorschlag = JSON.stringify({ ...ALTFUNKTION_UMBAU, entwurf }, null, 2);
  assert.ok(vorschlag.length > 1000);
  const umbau = raeumtAltfunktionAuf(context, `${CODEBLOCK}json\n${vorschlag}\n${CODEBLOCK}`);
  assert.deepEqual(umbau, { ...ALTFUNKTION_UMBAU, id: "A1-umbau", art: "umbau", prueft: UMBAU_AUSWEG });
});

test("liefert der Plan-Agent kein JSON-Objekt, geht der Auftrag mit genau diesem Grund zurück in die Entwurfsprüfung", (context) => {
  const bau = [{ antwort: ALTFUNKTION_FEHLT }];
  const drehbuch = { bau, plan: [{ antwort: "Dafür sehe ich keinen sinnvollen Umbau." }], test: ROTER_TEST, auftrag: FUNKTION };
  const { repo, ergebnis, beleg } = lauf(context, drehbuch, MIT_ALTFUNKTION);
  assert.equal(ergebnis.status, EXIT_ROT);
  const { befunde, umbau } = beleg("A1-plan");
  assert.deepEqual([befunde.length, umbau], [1, undefined]);
  assert.match(befunde[0], /JSON/);
  const { ergebnis: urteil, grund } = beleg("A1");
  assert.deepEqual([urteil, grund], ["entwurfsprüfung", `Zurück in die Entwurfsprüfung: Kein gültiger Umbau-Auftrag: ${befunde[0]}`]);
  assert.equal(runIn(repo, "git", ["log", "--format=%s"]).stdout.trim(), "Basis");
});

test("der Bau-Agent eines Umbaus bekommt den Aufräumsatz statt des Absatzes zu Altfunktionen, ein anderer Auftrag den Absatz unverändert", (context) => {
  const abgeben = [
    "Muss der Auftrag eine Funktion ändern, die noch Einträge in `eslint-suppressions.json` hat, änderst du sie nicht selbst. Du hörst auf und antwortest als Letztes mit genau einer Zeile, die alle betroffenen Funktionen nennt:",
    "Voraussetzung fehlt: Altfunktionen aufräumen: <Datei>:<Funktion>, …",
  ].join("\n");
  const ausserhalb = "Voraussetzung fehlt: <ein Satz, was vorher passieren muss>";
  const aufraeumen = /Du räumst die Funktionen deines Umbaus auf, auch wenn sie Einträge in `eslint-suppressions\.json` haben; die Zahl der Einträge darf für keine Regel und Datei steigen, und die Pin-Prüfung \(`scripts\/check-staged-suppressions\.js`\) bleibt unverändert\./;
  const bau = [{ antwort: "Voraussetzung fehlt: Es braucht zuerst src/text.js." }];
  const umbau = lauf(context, { bau }).datei("prompt-bau.txt");
  assert.ok(umbau.includes(ausserhalb), umbau);
  assert.match(umbau, aufraeumen);
  assert.ok(!umbau.includes("Altfunktionen aufräumen:"), umbau);
  const anderer = lauf(context, { bau, test: ROTER_TEST, auftrag: FUNKTION }).datei("prompt-bau.txt");
  assert.ok(anderer.includes(`${ausserhalb}\n\n${abgeben}\n`), anderer);
  assert.doesNotMatch(anderer, aufraeumen);
});

test("meldet ein Umbau „Voraussetzung fehlt“, schiebt das Werkzeug keinen Umbau ein und geht sofort zurück in die Entwurfsprüfung", (context) => {
  const { repo, ergebnis, beleg, datei } = lauf(context, { bau: [{ dateien: { [ZAHL]: "kaputt\n" }, antwort: ALTFUNKTION_FEHLT }] }, MIT_ALTFUNKTION);
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.deepEqual([beleg("A1-plan"), beleg("A1-umbau"), datei("anzahl-plan"), datei("anzahl-bau")], [null, null, "", "1"]);
  const { ergebnis: urteil, grund } = beleg("A1");
  assert.deepEqual([urteil, grund], ["entwurfsprüfung", `Zurück in die Entwurfsprüfung: Umbau meldet fehlende Voraussetzung: ${ALTFUNKTION_FEHLT.replace("Voraussetzung fehlt: ", "")}`]);
  assert.equal(runIn(repo, "git", ["log", "--format=%s"]).stdout.trim(), "Basis");
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

const LANGE_NOTIZ = [
  "1. Den fehlenden Test zuerst schreiben lassen.",
  ...Array.from({ length: 40 }, (_, nummer) => `Begründung ${nummer + 1}: Die Lücke betrifft ein geschütztes Kosten-Gate und muss belegt werden.`),
  "2. Den Teil herausnehmen.",
  "Empfehlung: Option 1.",
].join("\n");
const LANGE_BAU_ANTWORT = ["Erst habe ich fremd.js gelesen.", ...Array.from({ length: 30 }, (_, nummer) => `Schritt ${nummer + 1}: geprüft, fremd.js wird gebraucht.`), "Ohne fremd.js geht es nicht."].join("\n");

test("eine lange Notiz und lange Hinweise stehen vollständig in der Entscheidung, mit der Sitzung der vollen Antwort", (context) => {
  assert.ok(LANGE_NOTIZ.length > 1000 && LANGE_BAU_ANTWORT.length > 1000);
  const fremd = { "fremd.js": "x\n" };
  const bau = [{ dateien: fremd, antwort: "Ich brauche fremd.js." }, { dateien: fremd, antwort: LANGE_BAU_ANTWORT }];
  const { beleg, datei } = lauf(context, { bau, notiz: [{ antwort: LANGE_NOTIZ }] });
  const { entscheidung, agenten } = beleg("A1");
  assert.ok(entscheidung.text.includes(`\n${LANGE_NOTIZ}\n`), entscheidung.text);
  const zitiert = LANGE_BAU_ANTWORT.split("\n").map((zeile) => `> ${zeile}`).join("\n");
  assert.ok(entscheidung.text.includes(`Hinweise des Bau-Agenten:\n${zitiert}\n`), entscheidung.text);
  for (const { sitzung } of [entscheidung.agenten.at(-1), agenten.findLast(({ rolle }) => rolle === "bau")]) {
    assert.ok(entscheidung.text.includes(sitzung), `${sitzung} fehlt in der Notiz`);
  }
  assert.ok(datei("gh.log").includes("1. Den fehlenden Test zuerst schreiben lassen."));
});

test("eine Notiz über der Grenze ist am Ende an einer Wortgrenze gekürzt und als gekürzt gekennzeichnet", (context) => {
  const riesig = `1. Anfang der Notiz.\n${"Wort ".repeat(30_000)}Schluss.`;
  const schleife = [aufruf("Bash", { command: "npm test" }), rueckgabe("Bash", "1 rot")];
  const { beleg } = lauf(context, { bau: [{ schleife }], notiz: [{ antwort: riesig }] });
  const { entscheidung } = beleg("A1");
  const sitzung = entscheidung.agenten.at(-1).sitzung;
  const absatz = entscheidung.text.slice(entscheidung.text.indexOf("1. Anfang der Notiz."));
  assert.match(absatz, new RegExp(`^1\\. Anfang der Notiz\\.\\n(Wort )+… \\[gekürzt; die volle Antwort steht in Sitzung ${sitzung}\\]`));
  assert.ok(!entscheidung.text.includes("Schluss."));
  assert.ok(entscheidung.text.length < 65_536, String(entscheidung.text.length));
});

test("jede rote Runde behält ihren Beleg; der letzte steht weiter unter dem Namen des Auftrags", (context) => {
  const schleife = [aufruf("Bash", { command: "npm test" }), rueckgabe("Bash", "1 rot")];
  const { beleg } = lauf(context, { bau: [{ schleife }], notiz: [{ antwort: "1. Bereich erweitern" }] });
  const erste = beleg("A1.runde-1");
  assert.ok(erste, "A1.runde-1.json fehlt");
  assert.equal(erste.runde, 1);
  assert.match(erste.grund, /^Stillstand: Bash/);
  assert.equal(erste.entscheidung, null);
  const letzte = beleg("A1");
  assert.equal(letzte.runde, ZWEITE_RUNDE);
  assert.match(letzte.entscheidung.text, /Bereich erweitern/);
  assert.equal(beleg("A1.runde-2"), null);
});

test("ein neuer Lauf desselben Auftrags überschreibt keinen Beleg eines früheren Laufs", (context) => {
  const frueher = (runde) => JSON.stringify({ phase: "probe", auftrag: "A1", runde, grund: `früherer Lauf, Runde ${runde}` });
  const vorher = { ".fortschritt/probe/A1.runde-1.json": frueher(1), ".fortschritt/probe/A1.json": frueher(ZWEITE_RUNDE) };
  const schleife = [aufruf("Bash", { command: "npm test" }), rueckgabe("Bash", "1 rot")];
  const { repo, beleg } = lauf(context, { bau: [{ schleife }], notiz: [{ antwort: "1. Bereich erweitern" }] }, vorher);
  assert.equal(beleg("A1.runde-1").grund, "früherer Lauf, Runde 1");
  assert.equal(beleg("A1.runde-2").grund, "früherer Lauf, Runde 2");
  const namen = readdirSync(join(repo, ".fortschritt/probe")).filter((name) => name.startsWith("A1.runde-1."));
  const neu = namen.map((name) => JSON.parse(readFileSync(join(repo, ".fortschritt/probe", name), "utf8"))).filter(({ grund }) => /^Stillstand: Bash/.test(grund));
  assert.equal(neu.length, 1, namen.join(", "));
  assert.equal(beleg("A1").runde, ZWEITE_RUNDE);
  assert.match(beleg("A1").entscheidung.text, /Bereich erweitern/);
});

const ALT_BLEIBT = { dateien: { [ZAHL]: "const alt = 2;\nexport const ZAHL = 1;\n" } };
const UNTERDRUECKUNGEN_AM_ANFANG = JSON.parse(MIT_ALTFUNKTION["eslint-suppressions.json"]);

test("ein Aufräum-Umbau, der die Altfunktion stehen lässt, wird nicht als grüner Umbau festgehalten", (context) => {
  const plan = [{ antwort: alsBlock({ ...ALTFUNKTION_UMBAU, entwurf: "Die ungenutzte Variable alt fällt weg." }) }];
  const drehbuch = { bau: [{ antwort: ALTFUNKTION_FEHLT }, ALT_BLEIBT], plan, notiz: [{ antwort: "1. Umbau wiederholen" }], test: ROTER_TEST, auftrag: FUNKTION };
  const { repo, ergebnis, beleg } = lauf(context, drehbuch, MIT_ALTFUNKTION);
  const git = (...args) => runIn(repo, "git", args).stdout.trim();
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.stdout + ergebnis.stderr);
  assert.notEqual(beleg("A1-umbau")?.ergebnis, "grün");
  assert.equal(git("log", "--format=%s"), "Basis");
  assert.deepEqual(JSON.parse(git("show", "HEAD:eslint-suppressions.json")), UNTERDRUECKUNGEN_AM_ANFANG);
});

test("ein geplanter Umbau, der keine Altfunktion aufräumen soll, bleibt grün, auch wenn eslint-suppressions.json gleich bleibt", (context) => {
  const { repo, ergebnis, beleg } = lauf(context, { bau: [ALT_BLEIBT] }, MIT_ALTFUNKTION);
  const git = (...args) => runIn(repo, "git", args).stdout.trim();
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
  assert.equal(beleg("A1").ergebnis, "grün");
  assert.deepEqual(git("log", "--format=%s").split("\n"), [AUFTRAG.ziel, "Basis"]);
  assert.deepEqual(JSON.parse(git("show", "HEAD:eslint-suppressions.json")), UNTERDRUECKUNGEN_AM_ANFANG);
});

test("ein Umbau aus einer anderen fehlenden Voraussetzung bleibt grün, auch wenn eslint-suppressions.json gleich bleibt", (context) => {
  const vorbereiten = { ...ALTFUNKTION_UMBAU, ziel: "Bereite zahl vor" };
  const bau = [{ antwort: `Voraussetzung fehlt: Erst muss alt in ${ZAHL} den Wert 2 haben.` }, ALT_BLEIBT, { dateien: { [ZAHL]: "const alt = 2;\nexport const ZAHL = 2;\n" } }];
  const plan = [{ antwort: alsBlock({ ...vorbereiten, entwurf: "alt bekommt den Wert 2." }) }];
  const { repo, ergebnis, beleg } = lauf(context, { bau, plan, test: ROTER_TEST, auftrag: FUNKTION }, MIT_ALTFUNKTION);
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
  assert.equal(beleg("A1-umbau").ergebnis, "grün");
  assert.deepEqual(runIn(repo, "git", ["log", "--format=%s"]).stdout.trim().split("\n"), [FUNKTION.ziel, vorbereiten.ziel, "Basis"]);
});
