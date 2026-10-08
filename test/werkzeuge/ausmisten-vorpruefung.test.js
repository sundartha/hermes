import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  DOPPELT,
  REPO_ID,
  REPOSITORY,
  ausmistenRepo,
  eingangsLauf,
  starte,
} from "./ausmisten/hilfen.mjs";
import { ereignisDatei } from "./pruefer/hilfen.mjs";
import { probeDirectory } from "./probe-repo.js";

const WERKZEUG = "tools/tests-ausmisten.mjs";
const EXIT_ROT = 1;
const NEUER_TEST = "test/post/neu.test.js";
const AKTIVER_MUTANT = ["__STRY", "KER_ACTIVE_MUT", "ANT__"].join("");
const BINAERDATEN = Buffer.from("\0\0binär\0");

function testMit(...zeilen) {
  return ['import { test } from "node:test";', 'test("neu", () => {', ...zeilen, "});", ""].join(
    "\n",
  );
}

async function miss(context, fall) {
  const repo = ausmistenRepo(context, fall.dateien);
  const kopf = fall.leer ? repo.master : repo.committe(fall.neu ?? {}, fall.weg ?? [DOPPELT]);
  repo.git(["checkout", "-q", repo.master]);
  if (fall.master !== undefined) repo.committe(fall.master);
  const umgebung = {
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_EVENT_PATH: fall.ohneEreignis
      ? ""
      : ereignisDatei(context, eingangsLauf(kopf, fall.lauf)),
    GITHUB_OUTPUT: "",
  };
  const aus = probeDirectory(context, {});
  const ergebnis = await starte(WERKZEUG, {
    args: [
      fall.befehl ?? "planen",
      "--aus",
      aus,
      ...(fall.befehl ? ["--plan-daten", aus, "--basis-daten", aus, "--paket", "0"] : []),
    ],
    cwd: repo.ordner,
    umgebung,
  });
  return { ...ergebnis, repo, aus };
}

async function erwarteRot(context, fall, grund) {
  const ergebnis = await miss(context, fall);
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.ok(ergebnis.ausgabe.includes(grund), ergebnis.ausgabe);
  return ergebnis;
}

test("ausmisten-vorpruefung: eine Zeile, die Strykers Zustand liest, stoppt die Messung", async (context) => {
  const neu = {
    [NEUER_TEST]: testMit(`  if (process.env.${AKTIVER_MUTANT}) throw new Error();`),
  };
  await erwarteRot(context, { neu }, `${NEUER_TEST}:3: Strykers Zustand`);
});

test("ausmisten-vorpruefung: ein aus Stücken zusammengesetzter Stryker-Name stoppt die Messung", async (context) => {
  const neu = {
    [NEUER_TEST]: testMit('  const name = ["__stry", "ker_ACTIVE"]', '    .join("");'),
  };
  await erwarteRot(
    context,
    { neu },
    `${NEUER_TEST}: zusammengesetzt ergeben die hinzugefügten Zeilen Strykers Zustand`,
  );
});

test("ausmisten-vorpruefung: process.env mit berechnetem Schlüssel stoppt die Messung", async (context) => {
  const neu = { [NEUER_TEST]: testMit('  const name = "X";', "  void process.env[name];") };
  await erwarteRot(context, { neu }, `${NEUER_TEST}:4: berechneter Schlüssel`);
});

test("ausmisten-vorpruefung: globalThis mit berechnetem Schlüssel stoppt die Messung", async (context) => {
  const neu = { [NEUER_TEST]: testMit("  void globalThis[Symbol.for(1)];") };
  await erwarteRot(context, { neu }, `${NEUER_TEST}:3: berechneter Schlüssel`);
});

test("ausmisten-vorpruefung: eine Zeile, die mit ++ beginnt, wird trotzdem geprüft", async (context) => {
  const neu = {
    [NEUER_TEST]: ["let zaehler = 0;", "++zaehler, globalThis[zaehler];", ""].join("\n"),
  };
  await erwarteRot(context, { neu }, `${NEUER_TEST}:2: berechneter Schlüssel`);
});

test("ausmisten-vorpruefung: Object.keys(process.env) stoppt die Messung", async (context) => {
  const neu = { [NEUER_TEST]: testMit("  void Object.keys(process.env);") };
  await erwarteRot(context, { neu }, `${NEUER_TEST}:3: Aufzählung`);
});

test("ausmisten-vorpruefung: process.env als Wert weitergegeben stoppt die Messung", async (context) => {
  const neu = { [NEUER_TEST]: testMit("  const umgebung = process.env;", "  void umgebung;") };
  await erwarteRot(context, { neu }, `${NEUER_TEST}:3: Weitergabe als Wert`);
});

test("ausmisten-vorpruefung: ein Zugriff auf /proc/ stoppt die Messung", async (context) => {
  const neu = { [NEUER_TEST]: testMit('  const pfad = "/proc/self/environ";', "  void pfad;") };
  await erwarteRot(context, { neu }, `${NEUER_TEST}:3: /proc/`);
});

test("ausmisten-vorpruefung: ein Import von node:process stoppt die Messung", async (context) => {
  const neu = { [NEUER_TEST]: ['import { env } from "node:process";', "void env;", ""].join("\n") };
  await erwarteRot(context, { neu }, `${NEUER_TEST}:1: node:process`);
});

test("ausmisten-vorpruefung: eine neue Binärdatei stoppt die Messung", async (context) => {
  const neu = { "test/post/daten.bin": BINAERDATEN };
  await erwarteRot(
    context,
    { neu },
    "test/post/daten.bin: Binärdateien sind beim Ausmisten gesperrt",
  );
});

test("ausmisten-vorpruefung: ein Branch, der src/ ändert, stoppt die Messung", async (context) => {
  const neu = { "src/post/eingang.js": "export function eingang(text) {\n  return text;\n}\n" };
  await erwarteRot(
    context,
    { neu },
    "src/post/eingang.js: beim Ausmisten sind nur Dateien unter test/ erlaubt",
  );
});

test("ausmisten-vorpruefung: ein Branch, der nicht auf dem aktuellen master liegt, stoppt die Messung", async (context) => {
  const master = { "test/post/neu-auf-master.test.js": testMit("") };
  await erwarteRot(context, { master }, "erst rebasen");
});

test("ausmisten-vorpruefung: ein Push auf Ausmisten/posteingang wird nicht gemessen", async (context) => {
  const lauf = { head_branch: "Ausmisten/posteingang" };
  await erwarteRot(
    context,
    { lauf },
    "Herkunft: der Branch heißt nicht genau ausmisten/<Bereich mit Quellen>",
  );
});

test("ausmisten-vorpruefung: ein Push aus einem fremden Repository wird nicht gemessen", async (context) => {
  const lauf = { head_repository: { id: REPO_ID + 1, full_name: REPOSITORY } };
  await erwarteRot(context, { lauf }, "Herkunft: der Branch liegt nicht in diesem Repository");
});

test("ausmisten-vorpruefung: ein gescheiterter Eingangslauf wird nicht gemessen", async (context) => {
  await erwarteRot(
    context,
    { lauf: { conclusion: "failure" } },
    "Herkunft: der auslösende Lauf ist nicht erfolgreich",
  );
});

test("ausmisten-vorpruefung: der Branch-Job prüft vor dem Ausführen und legt nichts über master", async (context) => {
  const neu = { [NEUER_TEST]: testMit("  void process.env[String(1)];") };
  const ergebnis = await erwarteRot(
    context,
    { neu, befehl: "branch" },
    `${NEUER_TEST}:3: berechneter Schlüssel`,
  );
  assert.equal(ergebnis.repo.git(["status", "--porcelain"]).stdout, "");
});

test("ausmisten-vorpruefung: ohne auslösenden Lauf wird nicht gemessen", async (context) => {
  const ergebnis = await miss(context, { ohneEreignis: true });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /Herkunft: kein auslösender Lauf im Ereignis/);
});

test("ausmisten-vorpruefung: eine ungültige Kopf-SHA wird nicht gemessen", async (context) => {
  await erwarteRot(context, { lauf: { head_sha: "HEAD" } }, "Herkunft: die Kopf-SHA ist ungültig");
});

test("ausmisten-vorpruefung: ein Kopf-Repository mit anderem Namen wird nicht gemessen", async (context) => {
  const lauf = { head_repository: { id: REPO_ID, full_name: "fremd/hermes" } };
  await erwarteRot(context, { lauf }, "Herkunft: der Branch liegt nicht in diesem Repository");
});

test("ausmisten-vorpruefung: ein Branch ohne Änderung wird nicht gemessen", async (context) => {
  await erwarteRot(context, { weg: [], leer: true }, "Der Branch ändert nichts gegenüber master");
});

test("ausmisten-vorpruefung: for … in über process.env stoppt die Messung", async (context) => {
  const neu = { [NEUER_TEST]: testMit("  for (const name in process.env) void name;") };
  await erwarteRot(context, { neu }, `${NEUER_TEST}:3: Aufzählung`);
});

test("ausmisten-vorpruefung: global mit berechnetem Schlüssel stoppt die Messung", async (context) => {
  const neu = { [NEUER_TEST]: testMit("  void global[String(1)];") };
  await erwarteRot(context, { neu }, `${NEUER_TEST}:3: berechneter Schlüssel`);
});

test("ausmisten-vorpruefung: die Umgebung über ein Programm zu lesen stoppt die Messung", async (context) => {
  const neu = { [NEUER_TEST]: testMit('  const programm = "printenv";', "  void programm;") };
  await erwarteRot(context, { neu }, `${NEUER_TEST}:3: Umgebung über ein Programm`);
});

test("ausmisten-vorpruefung: der Branch-Job ohne gültigen Plan legt nichts über master", async (context) => {
  const ergebnis = await erwarteRot(context, { befehl: "branch" }, "Plan unbrauchbar");
  assert.equal(ergebnis.repo.git(["status", "--porcelain"]).stdout, "");
});

test("ausmisten-vorpruefung: ein gelöschter Test, der nur tools/ prüft, ist nicht messbar und stoppt die Planung", async (context) => {
  const nurWerkzeug = "test/post/werkzeug.test.js";
  const dateien = {
    "tools/pruefen.mjs": "export const ok = true;\n",
    [nurWerkzeug]: 'const programm = "tools/pruefen.mjs";\nvoid programm;\n',
  };
  const ergebnis = await erwarteRot(context, { dateien, weg: [nurWerkzeug] }, "Nicht messbar:");
  assert.match(
    ergebnis.ausgabe,
    /test\/post\/werkzeug\.test\.js: erreicht keine Datei der Messmenge/,
  );
});

test("ausmisten-vorpruefung: eine geänderte Datendatei ohne Nutzer ist nicht messbar und stoppt die Planung", async (context) => {
  const daten = "test/daten/frei.json";
  const dateien = { [daten]: '{ "a": 1 }\n' };
  const neu = { [daten]: '{ "a": 2 }\n' };
  await erwarteRot(
    context,
    { dateien, neu },
    `${daten}: keine Testdatei lädt oder nennt diese Datei`,
  );
});

const UNTERDRUECKUNGEN = "eslint-suppressions.json";
const EIGENER_TEST = DOPPELT;
const FREMDER_TEST = "test/post/eingang.test.js";
const ZAEHLER_VORHER = 3;
const ZAEHLER_NACHHER = 1;

const EINRUECKUNG = 2;
const MAGISCHE_ZAHLEN = 2;
const FREMDER_EINTRAG = { "id-length": { count: 1 } };

function alsJson(daten) {
  return `${JSON.stringify(daten, null, EINRUECKUNG)}\n`;
}

function unterdrueckungen(eigene) {
  if (eigene === undefined) return alsJson({ [FREMDER_TEST]: FREMDER_EINTRAG });
  return alsJson({ [EIGENER_TEST]: eigene, [FREMDER_TEST]: FREMDER_EINTRAG });
}

function planVon({ aus }) {
  return JSON.parse(readFileSync(join(aus, "plan.json"), "utf8"));
}

const MASTER_UNTERDRUECKUNGEN = unterdrueckungen({
  "id-length": { count: ZAEHLER_VORHER },
  "no-magic-numbers": { count: MAGISCHE_ZAHLEN },
});

function mitUnterdrueckungen(neu) {
  return {
    dateien: { [UNTERDRUECKUNGEN]: MASTER_UNTERDRUECKUNGEN },
    neu: { [UNTERDRUECKUNGEN]: neu },
  };
}

test("ausmisten-vorpruefung: eine gesenkte Unterdrückung des eigenen Tests geht in den Plan", async (context) => {
  const fall = mitUnterdrueckungen(unterdrueckungen({ "id-length": { count: ZAEHLER_NACHHER } }));
  const ergebnis = await miss(context, fall);
  assert.equal(ergebnis.status, 0, ergebnis.ausgabe);
  const plan = planVon(ergebnis);
  assert.deepEqual(plan.unterdrueckungen, [
    { datei: EIGENER_TEST, regel: "id-length", vorher: ZAEHLER_VORHER, nachher: ZAEHLER_NACHHER },
    { datei: EIGENER_TEST, regel: "no-magic-numbers", vorher: MAGISCHE_ZAHLEN, nachher: 0 },
  ]);
});

test("ausmisten-vorpruefung: ein ganz entfernter Eintrag des eigenen Tests gilt als Senkung auf null", async (context) => {
  const ergebnis = await miss(context, mitUnterdrueckungen(unterdrueckungen(undefined)));
  assert.equal(ergebnis.status, 0, ergebnis.ausgabe);
  const plan = planVon(ergebnis);
  assert.deepEqual(
    plan.unterdrueckungen.map(({ regel, nachher }) => [regel, nachher]),
    [
      ["id-length", 0],
      ["no-magic-numbers", 0],
    ],
  );
});

test("ausmisten-vorpruefung: eine erhöhte Unterdrückung stoppt die Planung, auch neben einer Senkung", async (context) => {
  const neu = unterdrueckungen({ "id-length": { count: 4 }, "no-magic-numbers": { count: 1 } });
  await erwarteRot(
    context,
    mitUnterdrueckungen(neu),
    `${UNTERDRUECKUNGEN}: ${EIGENER_TEST} id-length darf nur sinken.`,
  );
});

test("ausmisten-vorpruefung: eine gesenkte Unterdrückung eines fremden Tests stoppt die Planung", async (context) => {
  const daten = JSON.parse(MASTER_UNTERDRUECKUNGEN);
  delete daten[FREMDER_TEST];
  await erwarteRot(
    context,
    mitUnterdrueckungen(alsJson(daten)),
    `${UNTERDRUECKUNGEN}: ${FREMDER_TEST} ändert der Branch nicht; ihr Eintrag muss bleiben.`,
  );
});

test("ausmisten-vorpruefung: eine neue Regel in den Unterdrückungen stoppt die Planung", async (context) => {
  const neu = unterdrueckungen({
    "id-length": { count: ZAEHLER_VORHER },
    "no-magic-numbers": { count: MAGISCHE_ZAHLEN },
    complexity: { count: 1 },
  });
  await erwarteRot(
    context,
    mitUnterdrueckungen(neu),
    `${UNTERDRUECKUNGEN}: neue Regel complexity für ${EIGENER_TEST}.`,
  );
});

test("ausmisten-vorpruefung: ein neuer Eintrag in den Unterdrückungen stoppt die Planung", async (context) => {
  const daten = JSON.parse(MASTER_UNTERDRUECKUNGEN);
  daten[NEUER_TEST] = { "id-length": { count: 1 } };
  await erwarteRot(
    context,
    mitUnterdrueckungen(alsJson(daten)),
    `${UNTERDRUECKUNGEN}: neuer Eintrag für ${NEUER_TEST}.`,
  );
});
