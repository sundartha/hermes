import assert from "node:assert/strict";
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { kostenDerSitzung, transkriptVerzeichnis } from "../../tools/auftrag/kosten.mjs";
import { probeDirectory, runIn } from "./probe-repo.js";

const SITZUNG = "11111111-2222-3333-4444-555555555555";

function uebernimmWerte(werte) {
  for (const [name, wert] of Object.entries(werte)) {
    if (wert === undefined) delete process.env[name];
    else process.env[name] = wert;
  }
}

function sichereUmgebung(context, namen) {
  const vorher = Object.fromEntries(namen.map((name) => [name, process.env[name]]));
  context.after(() => uebernimmWerte(vorher));
}

function setzeUmgebung(context, werte) {
  sichereUmgebung(context, Object.keys(werte));
  uebernimmWerte(werte);
}

function probeMitVerweis(context) {
  const ort = probeDirectory(context, { "projekt/README.md": "Probe\n" });
  const verweis = join(ort, "verweis");
  symlinkSync(join(ort, "projekt"), verweis);
  return { ort, verweis, ordnerName: realpathSync(join(ort, "projekt")).replace(/[^A-Za-z0-9]/g, "-") };
}

test("kosten: transkriptVerzeichnis folgt CLAUDE_CONFIG_DIR und dem echten Pfad", (context) => {
  const { ort, verweis, ordnerName } = probeMitVerweis(context);
  const heimat = join(ort, "heimat");
  const absolut = join(ort, "konfig");
  const faelle = [
    [undefined, join(heimat, ".claude")],
    ["", join(heimat, ".claude")],
    ["   ", join(heimat, ".claude")],
    [absolut, absolut],
    [` ${absolut} `, absolut],
    ["~", heimat],
    ["~/konto-zwei", join(heimat, "konto-zwei")],
    ["relativ/konfig", resolve("relativ/konfig")],
  ];
  sichereUmgebung(context, ["HOME", "CLAUDE_CONFIG_DIR"]);
  for (const [angabe, basis] of faelle) {
    uebernimmWerte({ HOME: heimat, CLAUDE_CONFIG_DIR: angabe });
    assert.equal(transkriptVerzeichnis(verweis), join(basis, "projects", ordnerName), `CLAUDE_CONFIG_DIR=${angabe}`);
  }
});

test("kosten: transkriptVerzeichnis nimmt einen Ordner, den es nicht gibt, wie angegeben", (context) => {
  const { ort } = probeMitVerweis(context);
  setzeUmgebung(context, { CLAUDE_CONFIG_DIR: join(ort, "konfig") });
  assert.equal(transkriptVerzeichnis("/gibt/es-nicht"), join(ort, "konfig", "projects", "-gibt-es-nicht"));
});

test("kosten: kostenDerSitzung misst ein Transkript unter CLAUDE_CONFIG_DIR", (context) => {
  const { ort, verweis, ordnerName } = probeMitVerweis(context);
  const konfig = join(ort, "konfig");
  const projekt = join(konfig, "projects", ordnerName);
  mkdirSync(projekt, { recursive: true });
  const zeilen = [
    { type: "assistant", message: { id: "m1", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 } } },
    { type: "assistant", message: { id: "m2", usage: { input_tokens: 1, output_tokens: 2 } } },
  ];
  writeFileSync(join(projekt, `${SITZUNG}.jsonl`), `${zeilen.map((zeile) => JSON.stringify(zeile)).join("\n")}\n`);
  setzeUmgebung(context, { HOME: join(ort, "heimat"), CLAUDE_CONFIG_DIR: konfig });
  const kosten = kostenDerSitzung(verweis, { rolle: "planer", sitzung: SITZUNG });
  assert.equal(kosten.gemessen, true);
  assert.equal(kosten.turns, 2);
  assert.equal(kosten.gesamt, 138);
});

test("kosten: isolatedEnvironment gibt CLAUDE_CONFIG_DIR nicht weiter", (context) => {
  const ort = probeDirectory(context, {});
  setzeUmgebung(context, { CLAUDE_CONFIG_DIR: join(ort, "konfig"), PROBE_WEITERGEGEBEN: "ja" });
  const lauf = runIn(ort, process.execPath, ["-e", 'process.stdout.write(`${process.env.CLAUDE_CONFIG_DIR ?? "fehlt"} ${process.env.PROBE_WEITERGEGEBEN}`)']);
  assert.equal(lauf.stdout, "fehlt ja");
});
