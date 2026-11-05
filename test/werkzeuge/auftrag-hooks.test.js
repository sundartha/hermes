import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BLOCKING_EXIT_CODE, probeRepository, runHook } from "./probe-repo.js";

const ABNAHME = "test/abnahme.test.js";

function schreiben(repo, pfad, inhalt = "x\n") {
  return { tool_name: "Write", tool_input: { file_path: join(repo, pfad), content: inhalt }, cwd: repo };
}

function hook(name, { repo, eingabe, rolle, extra = {} }) {
  const environment = { ...extra, ...(rolle ? { HERMES_ROLLE: rolle } : {}) };
  return runHook(name, { cwd: repo, input: eingabe, environment });
}

function transkript(repo, befehl) {
  const pfad = join(repo, `.transkript-${befehl.length}.jsonl`);
  const aufruf = { type: "tool_use", id: "lauf-1", name: "Bash", input: { command: befehl } };
  const antwort = { type: "tool_result", tool_use_id: "lauf-1", content: "1 bestanden" };
  const zeilen = [{ message: { content: [aufruf] } }, { message: { content: [antwort] } }];
  writeFileSync(pfad, zeilen.map((zeile) => JSON.stringify(zeile)).join("\n"));
  return pfad;
}

test("abnahme-zuerst blockiert src/, bis der Abnahmetest in der Sitzung gelaufen ist", (context) => {
  const repo = probeRepository(context, { "src/a.js": "x\n" });
  const extra = { HERMES_ABNAHME: ABNAHME };
  const ohneLauf = { ...schreiben(repo, "src/a.js"), transcript_path: transkript(repo, `cat ${ABNAHME}`) };
  const gesperrt = hook("abnahme-zuerst.mjs", { repo, eingabe: ohneLauf, rolle: "bau", extra });
  assert.equal(gesperrt.status, BLOCKING_EXIT_CODE);
  assert.match(gesperrt.stderr, /npm --silent test -- test\/abnahme\.test\.js/);

  const befehl = `npm --silent test -- ${ABNAHME}`;
  const mitLauf = { ...schreiben(repo, "src/a.js"), transcript_path: transkript(repo, befehl) };
  assert.equal(hook("abnahme-zuerst.mjs", { repo, eingabe: mitLauf, rolle: "bau", extra }).status, 0);
  const ausserhalb = { ...schreiben(repo, "docs/a.md"), transcript_path: ohneLauf.transcript_path };
  assert.equal(hook("abnahme-zuerst.mjs", { repo, eingabe: ausserhalb, rolle: "bau", extra }).status, 0);
});

test("belege-schuetzen blockiert jeden Schreibzugriff unter .fortschritt/", (context) => {
  const repo = probeRepository(context, { "src/a.js": "x\n" });
  const eingabe = schreiben(repo, ".fortschritt/probe/A1.json", "{}\n");
  const ergebnis = hook("belege-schuetzen.mjs", { repo, eingabe, rolle: "bau" });
  assert.equal(ergebnis.status, BLOCKING_EXIT_CODE);
  assert.match(ergebnis.stderr, /tools\/auftrag\.mjs/);
  assert.equal(hook("belege-schuetzen.mjs", { repo, eingabe: schreiben(repo, "src/a.js"), rolle: "bau" }).status, 0);
});
