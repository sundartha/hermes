import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { fuehreLastlaufAus } from "../../scripts/last/lauf.mjs";
import { postgresVorhanden } from "../anrufe/hermes-mit-postgres.js";

const ZEITGRENZE_MS = 300_000;
const PROZESS_FRIST_MS = 30_000;
const WURZEL = fileURLToPath(new URL("../..", import.meta.url));
const CI = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const K6_ACTION = "grafana/setup-k6-action@c47136d33d365efbeb9ae7266908b5dcf98cdece";
const LAUF = fileURLToPath(new URL("../../scripts/last/lauf.mjs", import.meta.url));

function jobText(name) {
  const treffer = CI.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z]+:\\n|(?![\\s\\S]))`, "m"));
  assert.ok(treffer, `Job ${name} fehlt in ci.yml`);
  return treffer[1];
}

function ausloeser() {
  return CI.slice(CI.indexOf("\non:"), CI.indexOf("\npermissions:"));
}

test("H2b CI: Lastlauf-Job laeuft bei push auf master und in der Merge-Queue, nicht am Pull Request", () => {
  assert.match(ausloeser(), /^ {2}push:\n {4}branches: \[master\]$/m);
  assert.match(ausloeser(), /^ {2}merge_group:$/m);
  assert.match(jobText("lastlauf"), /^ {4}if: github\.event_name != 'pull_request'$/m);
});

test("H2b CI: k6 kommt aus einer per SHA gepinnten Action in fester Fassung", () => {
  const job = jobText("lastlauf");
  assert.ok(job.includes(`uses: ${K6_ACTION}`));
  assert.match(job, /k6-version: "1\.8\.2"/);
});

test("H2b CI: Lastlauf startet Postgres, nutzt keine Geheimnisse und laeuft gegen den lokalen Prüfstand", () => {
  const job = jobText("lastlauf");
  assert.ok(job.includes("uses: ./.github/actions/postgres"));
  assert.ok(!/secrets\./.test(job));
  assert.match(job, /node scripts\/last\/lauf\.mjs k6/);
  assert.ok(!/https?:\/\//.test(job));
});

test("H2b CI: Rotprobe-Schritte verlangen ein rotes Urteil mit dem erwarteten Grund, nicht irgendeinen Abbruch", () => {
  const job = jobText("lastlauf");
  assert.ok(job.includes("fehler:fehlerquote"));
  assert.ok(job.includes("verwerfen:verlorene_anrufe"));
  assert.ok(job.includes('node scripts/last/lauf.mjs "--rotprobe=$art" k6'));
  assert.match(job, /\.urteil\.gruen == false and \(\.urteil\.gruende \| index\(\$grund\) != null\)/);
});

test("H2b CI: Push auf master startet nur den Lastlauf, die Pflicht-Jobs der Pull Requests bleiben aus", () => {
  for (const name of ["pruefungen", "semgrep", "tests", "webtests"]) {
    assert.match(jobText(name), /^ {4}if: github\.event_name != 'push'$/m, name);
  }
  assert.match(jobText("ci"), /^ {4}if: always\(\) && github\.event_name != 'push'$/m);
  assert.match(jobText("ci"), /needs: \[[^\]]*\blastlauf\b[^\]]*\]/);
});

test("H2b CI: Sammel-Job nimmt den Lastlauf in der Merge-Queue mit, am Pull Request darf er uebersprungen sein", () => {
  const job = jobText("ci");
  assert.match(job, /\.key != "lastlauf"/);
});

test("H2b Treiber: unbekannte Rotprobe-Art bricht ab, bevor eine Umgebung startet", async () => {
  let gestartet = 0;
  const starte = async () => void (gestartet += 1);
  await assert.rejects(fuehreLastlaufAus({ rotprobe: "unsinn", starte }), /Lastlauf abgebrochen: rotprobe/);
  assert.equal(gestartet, 0);
});

test("H2b Treiber: --rotprobe mit unbekanntem Wert beendet den Aufruf mit Exit 1 und nennt den Grund", () => {
  const lauf = spawnSync(process.execPath, [LAUF, "--rotprobe=unsinn", process.execPath], {
    cwd: WURZEL,
    encoding: "utf8",
    timeout: PROZESS_FRIST_MS,
  });
  assert.equal(lauf.status, 1);
  assert.match(lauf.stderr, /Lastlauf abgebrochen: rotprobe/);
  assert.equal(lauf.stdout, "");
});

test("H2b Treiber: die Rotprobe-Art kommt in der Umgebung an", async () => {
  const gesehen = [];
  const starte = async (optionen) => {
    gesehen.push(optionen);
    throw new Error("stopp");
  };
  await assert.rejects(fuehreLastlaufAus({ rotprobe: "fehler", starte }), /stopp/);
  await assert.rejects(fuehreLastlaufAus({ starte }), /stopp/);
  assert.deepEqual(gesehen, [{ rotprobe: "fehler" }, { rotprobe: undefined }]);
});

const ROTPROBEN = [
  ["H2b Lauf: erzwungene Fehlerquote macht den Lauf rot", "fehler", "fehlerquote"],
  ["H2b Lauf: ein verworfener Anruf macht den Lauf rot", "verwerfen", "verlorene_anrufe"],
];

for (const [name, rotprobe, grund] of ROTPROBEN) {
  test(name, { timeout: ZEITGRENZE_MS }, async (t) => {
    if (!process.env.K6_BEFEHL) return t.skip("kein k6 (K6_BEFEHL fehlt)");
    if (!postgresVorhanden()) return;
    const lauf = await fuehreLastlaufAus({ k6Befehl: process.env.K6_BEFEHL.split(" "), rotprobe });
    assert.equal(lauf.urteil.gruen, false);
    assert.ok(lauf.urteil.gruende.includes(grund));
  });
}
