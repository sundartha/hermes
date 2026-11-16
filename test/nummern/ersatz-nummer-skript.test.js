import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BASE_ENV, tempDataDir } from "../helpers.js";
import { kindUmgebung } from "../gemeinsam/kind-umgebung.mjs";
import { findActiveNumber } from "../../src/store/views.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ALT = "+17067101188";
const NEU = "+12025550143";
const FREMD = "+12025550177";

function skript(dataDir, ...argumente) {
  return spawnSync(process.execPath, ["scripts/seed-owner-number.js", ...argumente], {
    cwd: ROOT,
    env: kindUmgebung({ ...BASE_ENV, DATA_DIR: dataDir }),
    encoding: "utf8",
    timeout: 20000,
  });
}

function zustand(dataDir) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
}

function tauschSpuren(state) {
  return state.provisioningJobs.filter((job) => job.kind === "number_swap");
}

function mitAlterNummer() {
  const dir = tempDataDir();
  assert.equal(skript(dir, ALT, "telnyx").status, 0);
  return dir;
}

test("ersatz: findActiveNumber waehlt die Nummer mit Ersatz-Spur trotz Platz hinten im Array", () => {
  const state = {
    numbers: [
      { id: "num_alt", e164: ALT, tenantId: "owner", provider: "telnyx", status: "active" },
      { id: "num_neu", e164: NEU, tenantId: "owner", provider: "telnyx", status: "active" },
    ],
    provisioningJobs: [{ kind: "number_swap", numberId: "num_neu", idempotencyKey: "tausch_num_alt" }],
  };
  assert.equal(findActiveNumber(state, "owner").e164, NEU);
});

test("ersatz: --ersetzt traegt die neue Nummer ein, legt die Spur an und findActiveNumber waehlt sie", () => {
  const dir = mitAlterNummer();
  const lauf = skript(dir, NEU, "telnyx", "--ersetzt", ALT);
  assert.equal(lauf.status, 0, lauf.stderr);
  const state = zustand(dir);
  const alt = state.numbers.find((nummer) => nummer.e164 === ALT);
  const neu = state.numbers.find((nummer) => nummer.e164 === NEU);
  assert.equal(neu.status, "active");
  assert.equal(neu.tenantId, "owner");
  assert.equal(alt.status, "active");
  const spuren = tauschSpuren(state);
  assert.equal(spuren.length, 1);
  assert.equal(spuren[0].numberId, neu.id);
  assert.equal(spuren[0].idempotencyKey, `tausch_${alt.id}`);
  assert.equal(spuren[0].tenantId, "owner");
  assert.equal(spuren[0].status, "done");
  assert.equal(findActiveNumber(state, "owner").e164, NEU);
});

test("ersatz: zweiter Lauf mit gleichen Argumenten aendert nichts", () => {
  const dir = mitAlterNummer();
  assert.equal(skript(dir, NEU, "telnyx", "--ersetzt", ALT).status, 0);
  const davor = fs.readFileSync(path.join(dir, "store.json"), "utf8");
  const lauf = skript(dir, NEU, "telnyx", "--ersetzt", ALT);
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.equal(tauschSpuren(zustand(dir)).length, 1);
  assert.equal(zustand(dir).numbers.length, 2);
  assert.deepEqual(zustand(dir).provisioningJobs, JSON.parse(davor).provisioningJobs);
});

test("ersatz: alte Nummer nicht aktiv beim Mandanten owner bricht mit Exit 1 ab und schreibt nichts", () => {
  const dir = mitAlterNummer();
  const davor = zustand(dir);
  const lauf = skript(dir, NEU, "telnyx", "--ersetzt", FREMD);
  assert.equal(lauf.status, 1);
  assert.match(lauf.stderr, /\+12025550177/);
  assert.deepEqual(zustand(dir).numbers, davor.numbers);
  assert.equal(tauschSpuren(zustand(dir)).length, 0);
});

test("ersatz: Nummer eines anderen Mandanten gilt nicht als alte Nummer des Mandanten owner", () => {
  const dir = tempDataDir({ numbers: [{ id: "num_f", e164: FREMD, tenantId: "fremd-a", provider: "telnyx", status: "active" }] });
  const lauf = skript(dir, NEU, "telnyx", "--ersetzt", FREMD);
  assert.equal(lauf.status, 1);
  assert.equal(zustand(dir).numbers.some((nummer) => nummer.e164 === NEU), false);
});

test("ersatz: ohne --ersetzt traegt das Skript nur die Nummer ein, ohne Spur", () => {
  const dir = mitAlterNummer();
  const lauf = skript(dir, NEU, "telnyx");
  assert.equal(lauf.status, 0, lauf.stderr);
  const state = zustand(dir);
  assert.equal(state.numbers.length, 2);
  assert.equal(tauschSpuren(state).length, 0);
  assert.equal(findActiveNumber(state, "owner").e164, ALT);
});

test("ersatz: --ersetzt ohne Wert ist ein Aufruffehler mit Exit 1", () => {
  const dir = mitAlterNummer();
  const lauf = skript(dir, NEU, "telnyx", "--ersetzt");
  assert.equal(lauf.status, 1);
  assert.match(lauf.stderr, /Aufruf/);
  assert.equal(zustand(dir).numbers.length, 1);
});

test("ersatz: neue Nummer gehoert schon einem anderen Mandanten, Abbruch mit Grund und ohne Spur", () => {
  const dir = mitAlterNummer();
  const state = zustand(dir);
  state.numbers.push({ id: "num_f", e164: NEU, tenantId: "fremd-a", provider: "telnyx", status: "active" });
  fs.writeFileSync(path.join(dir, "store.json"), JSON.stringify(state));
  const lauf = skript(dir, NEU, "telnyx", "--ersetzt", ALT);
  assert.equal(lauf.status, 1);
  assert.match(lauf.stderr, /neue_nummer_nicht_aktiv/);
  assert.equal(tauschSpuren(zustand(dir)).length, 0);
});

test("ersatz: alte Nummer ist schon durch eine andere Nummer ersetzt, Abbruch mit Grund", () => {
  const dir = mitAlterNummer();
  assert.equal(skript(dir, NEU, "telnyx", "--ersetzt", ALT).status, 0);
  const lauf = skript(dir, FREMD, "telnyx", "--ersetzt", ALT);
  assert.equal(lauf.status, 1);
  assert.match(lauf.stderr, /andere_ersatz_spur/);
  assert.equal(tauschSpuren(zustand(dir)).length, 1);
});

test("ersatz: nicht aktive alte Nummer nennt den Grund im Abbruch", () => {
  const dir = tempDataDir();
  const lauf = skript(dir, NEU, "telnyx", "--ersetzt", ALT);
  assert.equal(lauf.status, 1);
  assert.match(lauf.stderr, /alte_nummer_nicht_aktiv/);
});
