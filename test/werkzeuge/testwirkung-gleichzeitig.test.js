import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  REPO_ROOT,
  commitAll,
  isolatedEnvironment,
  probeRepository,
  writeFiles,
} from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/testwirkung.mjs");
const ROTPROBEN = join(REPO_ROOT, "test/werkzeuge/rotproben/testwirkung");
const GLEICHZEITIG = "TESTWIRKUNG_GLEICHZEITIG";
const KERNE_JE_LAUF = 2;
const EXIT_ABBRUCH = 2;
const MINDESTDAUER_MS = 100;
const PARTNERFRIST_MS = 20_000;
const SAMMELFRIST_MS = PARTNERFRIST_MS;
const LAEUFE_NEUER_TESTS = ["A", "B1", "B2", "B3", "B4", "B5"];
const ALS_MODUL = { "package.json": '{ "type": "module" }\n' };

function ordner(context, praefix) {
  const verzeichnis = mkdtempSync(join(tmpdir(), praefix));
  context.after(() => rmSync(verzeichnis, { recursive: true, force: true }));
  return verzeichnis;
}

function treffpunkt(
  sammelordner,
  {
    partnerfristMs = PARTNERFRIST_MS,
    genug = "gesehen.has(anderer) || fertig.has(anderer)",
    pruefung = "assert.ok(hoechstens >= 0);",
  } = {},
) {
  return [
    'import assert from "node:assert/strict";',
    'import { readdirSync, rmSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'import { test } from "node:test";',
    `const ORDNER = ${JSON.stringify(sammelordner)};`,
    "function art() {",
    "  try {",
    "    assert.ok(true);",
    '    return "echt";',
    "  } catch {",
    '    return "attrappe";',
    "  }",
    "}",
    'test("trifft andere Läufe", async () => {',
    "  const eigen = `lebt-${art()}-${process.pid}`;",
    '  writeFileSync(join(ORDNER, eigen), "");',
    "  const beginn = Date.now();",
    "  const gesehen = new Set();",
    "  const fertig = new Set();",
    "  let hoechstens = 0;",
    '  const anderer = art() === "echt" ? "attrappe" : "echt";',
    `  const genug = () => ${genug};`,
    `  let ende = beginn + ${partnerfristMs};`,
    "  while (Date.now() < ende) {",
    "    const namen = readdirSync(ORDNER);",
    '    const andere = namen.filter((name) => name.startsWith("lebt-") && name !== eigen);',
    "    hoechstens = Math.max(hoechstens, andere.length);",
    '    for (const name of andere) gesehen.add(name.split("-")[1]);',
    '    for (const name of namen.filter((name) => name.startsWith("bericht-"))) fertig.add(name.split("-")[1]);',
    `    if (genug()) ende = Math.min(ende, Date.now() + ${MINDESTDAUER_MS});`,
    "    await new Promise((weiter) => setTimeout(weiter, 5));",
    "  }",
    "  rmSync(join(ORDNER, eigen));",
    "  writeFileSync(join(ORDNER, `bericht-${art()}-${process.pid}.json`), JSON.stringify({ art: art(), hoechstens, gesehen: [...gesehen] }));",
    `  ${pruefung}`,
    "});",
    "",
  ].join("\n");
}

function mitlesend(ausgabe, sammelordner) {
  return [
    'import assert from "node:assert/strict";',
    'import { readFileSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'import { test } from "node:test";',
    `const ORDNER = ${JSON.stringify(sammelordner)};`,
    'test("zählt die Laufzeilen vor sich", () => {',
    `  const zeilen = readFileSync(${JSON.stringify(ausgabe)}, "utf8").split("\\n").filter((zeile) => zeile.startsWith("Testwirkung: "));`,
    "  writeFileSync(join(ORDNER, `bericht-${process.pid}.json`), JSON.stringify({ davor: zeilen.length }));",
    "  assert.ok(zeilen.length >= 0);",
    "});",
    "",
  ].join("\n");
}

function umgebung(gleichzeitig) {
  const ohneEinstellung = Object.fromEntries(
    Object.entries(isolatedEnvironment()).filter(([name]) => name !== GLEICHZEITIG),
  );
  return gleichzeitig === undefined
    ? ohneEinstellung
    : { ...ohneEinstellung, [GLEICHZEITIG]: gleichzeitig };
}

function ausgabedatei(context) {
  return join(ordner(context, "testwirkung-ausgabe-"), "stdout.txt");
}

function testwirkung(context, repo, { gleichzeitig, ausgabe = ausgabedatei(context) }) {
  const datei = openSync(ausgabe, "w");
  try {
    const lauf = spawnSync(process.execPath, [WERKZEUG, "--basis", "HEAD~1"], {
      cwd: repo,
      encoding: "utf8",
      env: umgebung(gleichzeitig),
      stdio: ["ignore", datei, "pipe"],
    });
    return { status: lauf.status, stderr: lauf.stderr, stdout: readFileSync(ausgabe, "utf8") };
  } finally {
    closeSync(datei);
  }
}

function aenderung(context, vorher, nachher) {
  const repo = probeRepository(context, { ...ALS_MODUL, ...vorher });
  writeFiles(repo, nachher);
  commitAll(repo, "Änderung");
  return repo;
}

function berichte(sammelordner) {
  return readdirSync(sammelordner)
    .filter((name) => name.startsWith("bericht-"))
    .map((name) => JSON.parse(readFileSync(join(sammelordner, name), "utf8")));
}

function neuerTreffpunkt(context, optionen) {
  const sammelordner = ordner(context, "testwirkung-treffpunkt-");
  const repo = aenderung(
    context,
    {},
    { "test/treffen.test.js": treffpunkt(sammelordner, optionen) },
  );
  return { sammelordner, repo };
}

test("testwirkung: der Lauf unter der Attrappe und die fünf Wiederholungen laufen gleichzeitig", (context) => {
  const { sammelordner, repo } = neuerTreffpunkt(context);
  const lauf = testwirkung(context, repo, { gleichzeitig: "6" });
  const gelaufen = berichte(sammelordner);
  assert.equal(gelaufen.length, LAEUFE_NEUER_TESTS.length, lauf.stdout + lauf.stderr);
  assert.ok(
    gelaufen.some(({ hoechstens }) => hoechstens >= 1),
    JSON.stringify(gelaufen),
  );
});

test("testwirkung: die Prüfung geänderter bestehender Tests läuft gleichzeitig mit den Wiederholungen", (context) => {
  const sammelordner = ordner(context, "testwirkung-treffpunkt-");
  const vorher = { "test/treffen.test.js": treffpunkt(sammelordner) };
  const nachher = {
    "test/treffen.test.js": treffpunkt(sammelordner, {
      pruefung: 'assert.ok(hoechstens >= 0, "Bericht geschrieben");',
    }),
  };
  const lauf = testwirkung(context, aenderung(context, vorher, nachher), { gleichzeitig: "9" });
  const unterAttrappe = berichte(sammelordner).filter(({ art }) => art === "attrappe");
  assert.ok(unterAttrappe.length > 0, lauf.stdout + lauf.stderr);
  assert.ok(
    unterAttrappe.some(({ gesehen }) => gesehen.includes("echt")),
    JSON.stringify(unterAttrappe),
  );
});

function erwarteAndereZugleich(context, { sammelordner, repo }, { gleichzeitig, andere }) {
  const lauf = testwirkung(context, repo, { gleichzeitig });
  const gelaufen = berichte(sammelordner);
  assert.equal(gelaufen.length, LAEUFE_NEUER_TESTS.length, lauf.stdout + lauf.stderr);
  assert.equal(
    Math.max(...gelaufen.map(({ hoechstens }) => hoechstens)),
    andere,
    JSON.stringify({ gleichzeitig, gelaufen }),
  );
}

test("testwirkung: mit TESTWIRKUNG_GLEICHZEITIG=2 laufen genau zwei Läufe zugleich", (context) => {
  erwarteAndereZugleich(context, neuerTreffpunkt(context), { gleichzeitig: "2", andere: 1 });
});

test("testwirkung: ohne Einstellung laufen so viele Läufe zugleich, wie zwei Kerne je Lauf zulassen", (context) => {
  const grenze = Math.max(1, Math.floor(availableParallelism() / KERNE_JE_LAUF));
  const andere = Math.min(grenze, LAEUFE_NEUER_TESTS.length) - 1;
  const treffen = neuerTreffpunkt(context, {
    partnerfristMs: SAMMELFRIST_MS,
    genug: `hoechstens >= ${andere}`,
  });
  erwarteAndereZugleich(context, treffen, { andere });
});

test("testwirkung: ein ungültiger Wert für TESTWIRKUNG_GLEICHZEITIG bricht die Prüfung ab", (context) => {
  const { repo } = neuerTreffpunkt(context, { partnerfristMs: MINDESTDAUER_MS });
  const lauf = testwirkung(context, repo, { gleichzeitig: "0" });
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.match(
    lauf.stderr,
    /^Abbruch: TESTWIRKUNG_GLEICHZEITIG=0 ist keine Zahl von Läufen ab 1\.$/m,
  );
});

test("testwirkung: jeder Lauf meldet sein Ende sofort mit einer Zeile", (context) => {
  const sammelordner = ordner(context, "testwirkung-mitlesen-");
  const ausgabe = ausgabedatei(context);
  const repo = aenderung(
    context,
    {},
    { "test/mitlesen.test.js": mitlesend(ausgabe, sammelordner) },
  );
  const lauf = testwirkung(context, repo, { gleichzeitig: "1", ausgabe });
  assert.deepEqual(
    berichte(sammelordner)
      .map(({ davor }) => davor)
      .sort(),
    [0, 1, 2, 3, 4, 5],
    lauf.stdout + lauf.stderr,
  );
  const laufzeilen = lauf.stdout.split("\n").filter((zeile) => zeile.startsWith("Testwirkung: "));
  const ohneDauer = laufzeilen.map((zeile) => zeile.replace(/ \d+ s$/, " … s"));
  assert.deepEqual(
    ohneDauer,
    LAEUFE_NEUER_TESTS.map((name) => `Testwirkung: ${name} 1 Dateien 1 Tests … s`),
  );
});

function abbrechend(sammelordner) {
  return [
    'import assert from "node:assert/strict";',
    'import { execFileSync } from "node:child_process";',
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'import { test } from "node:test";',
    `const ORDNER = ${JSON.stringify(sammelordner)};`,
    'test("beendet den eigenen Lauf unter der Attrappe", async () => {',
    '  writeFileSync(join(ORDNER, `gestartet-${process.pid}`), "");',
    "  let echt = true;",
    "  try {",
    "    assert.ok(true);",
    "  } catch {",
    "    echt = false;",
    "  }",
    "  if (!echt) {",
    '    const gruppe = execFileSync("ps", ["-o", "ppid=", "-p", String(process.ppid)], { encoding: "utf8" });',
    '    process.kill(Number(gruppe.trim()), "SIGKILL");',
    "    return;",
    "  }",
    "  const beginn = Date.now();",
    `  while (Date.now() - beginn < ${PARTNERFRIST_MS}) await new Promise((weiter) => setTimeout(weiter, 5));`,
    '  writeFileSync(join(ORDNER, `fertig-${process.pid}`), "");',
    "  assert.ok(echt);",
    "});",
    "",
  ].join("\n");
}

function marken(sammelordner, praefix) {
  return readdirSync(sammelordner).filter((name) => name.startsWith(praefix)).length;
}

test("testwirkung: bricht ein Lauf mit einem Signal ab, endet die Prüfung und beendet laufende Läufe, ohne wartende zu starten", (context) => {
  const sammelordner = ordner(context, "testwirkung-abbruch-");
  const repo = aenderung(context, {}, { "test/abbruch.test.js": abbrechend(sammelordner) });
  const lauf = testwirkung(context, repo, { gleichzeitig: "2" });
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /^Abbruch: Testlauf abgebrochen: SIGKILL$/m);
  assert.ok(marken(sammelordner, "gestartet-") <= 2, readdirSync(sammelordner).join(", "));
  assert.equal(marken(sammelordner, "fertig-"), 0, readdirSync(sammelordner).join(", "));
});

test("testwirkung: bricht bei nur einem Platz ein Lauf mit einem Signal ab, startet kein wartender Lauf mehr", (context) => {
  const sammelordner = ordner(context, "testwirkung-abbruch-");
  const repo = aenderung(context, {}, { "test/abbruch.test.js": abbrechend(sammelordner) });
  const lauf = testwirkung(context, repo, { gleichzeitig: "1" });
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.equal(marken(sammelordner, "gestartet-"), 1, readdirSync(sammelordner).join(", "));
  assert.equal(marken(sammelordner, "fertig-"), 0, readdirSync(sammelordner).join(", "));
});

function rotprobe(name) {
  const { vorher, dateien, erwartet } = JSON.parse(readFileSync(join(ROTPROBEN, name), "utf8"));
  const alsText = (stand) =>
    Object.fromEntries(
      Object.entries(stand ?? {}).map(([pfad, zeilen]) => [pfad, `${zeilen.join("\n")}\n`]),
    );
  return { vorher: alsText(vorher), dateien: alsText(dateien), erwartet };
}

test("testwirkung: alle Rotproben der Testwirkung ergeben bei gleichzeitigen Läufen ihre erwartete Meldung", (context) => {
  const faelle = readdirSync(ROTPROBEN)
    .map(rotprobe)
    .filter(({ erwartet }) => erwartet !== undefined);
  assert.ok(faelle.length > 0);
  for (const { vorher, dateien, erwartet } of faelle) {
    const lauf = testwirkung(context, aenderung(context, vorher, dateien), { gleichzeitig: "6" });
    assert.ok(lauf.stdout.includes(erwartet), `${erwartet}\n${lauf.stdout}${lauf.stderr}`);
  }
});
