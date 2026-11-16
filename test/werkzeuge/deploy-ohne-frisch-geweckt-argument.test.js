import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ausgabeAnlegen } from "../../tools/deploy-weg/ausgabe.mjs";
import { entscheiden } from "../../tools/deploy-weg/entscheiden.mjs";

const COMMIT = "a".repeat(40);
const PRODUKTION = "b".repeat(40);

function deployAufrufen(argumente) {
  const ergebnis = spawnSync("node", ["tools/deploy-weg.mjs", "deploy", ...argumente], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  return ergebnis.stdout + ergebnis.stderr;
}

test("Deploy-Kommando lehnt --frisch-geweckt als unbekanntes Argument ab", () => {
  const ausgabe = deployAufrufen([
    "--commit",
    COMMIT,
    "--produktion",
    PRODUKTION,
    "--frisch-geweckt",
    "ja",
  ]);
  assert.match(ausgabe, /^Aufruf: node tools\/deploy-weg\.mjs /m);
  assert.doesNotMatch(ausgabe, /frisch-geweckt/);
});

test("Deploy-Kommando nimmt commit und produktion ohne frisch-geweckt an", () => {
  const ausgabe = deployAufrufen(["--commit", COMMIT, "--produktion", PRODUKTION]);
  assert.doesNotMatch(ausgabe, /Aufruf:/);
});

test("Entscheiden schreibt keine Ausgabe frisch_geweckt in die Ausgabedatei", async () => {
  const server = createServer((anfrage, rueckgabe) => {
    rueckgabe.writeHead(anfrage.url === "/healthz" ? 200 : 500, {
      "content-type": "application/json",
    });
    rueckgabe.end(JSON.stringify({ commit: PRODUKTION }));
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  const adresse = `http://127.0.0.1:${server.address().port}`;
  const datei = join(mkdtempSync(join(tmpdir(), "entscheiden-")), "ausgabe");
  await entscheiden({
    einstellungen: {
      githubUrl: adresse,
      githubToken: "t",
      repository: "sundartha/hermes",
      akteure: [],
      inActions: false,
      ref: null,
      ausgabeDatei: datei,
      repoDir: ".",
      produktionUrl: adresse,
    },
    ereignis: { name: "workflow_dispatch", nutzlast: null },
    ausgabe: ausgabeAnlegen(() => {}),
    uhr: { jetzt: () => 0, warten: async () => {} },
  });
  server.close();
  const zeilen = readFileSync(datei, "utf8").trim().split("\n");
  assert.deepEqual(
    zeilen.map((zeile) => zeile.split("=")[0]),
    ["deploy", "hoertest", "commit", "produktion", "teile"],
  );
});
