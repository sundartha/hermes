import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BASE_ENV, tempDataDir, startIdp, startServer, mcpPost, toolCall, readToolResult } from "../helpers.js";
import { kindUmgebung } from "./kind-umgebung.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ALT = "+17067101188";
const NEU = "+12025550143";
const OWNER_SUB = "owner-sub-1";
const FREMD = "+12025550177";

function skript(dataDir, ...argumente) {
  return spawnSync(process.execPath, ["scripts/seed-owner-number.js", ...argumente], {
    cwd: ROOT,
    env: kindUmgebung({ ...BASE_ENV, DATA_DIR: dataDir }),
    encoding: "utf8",
    timeout: 20000,
  });
}

async function gewaehlteNummer(dataDir) {
  const idp = await startIdp();
  const srv = await startServer({
    dataDir,
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, MULTI_TENANT: "true", OWNER_IDP_SUBJECT: OWNER_SUB },
  });
  try {
    const token = await idp.sign({ sub: OWNER_SUB, email: "owner@team.test" });
    const res = await mcpPost(`${srv.localUrl}/mcp`, token, toolCall("get_agent_number"));
    return (await readToolResult(res)).structuredContent.number;
  } finally {
    await srv.stop();
    await idp.close();
  }
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

test("ersatz: der Agent nutzt die Nummer mit Ersatz-Spur trotz Platz hinten im Array", async () => {
  const dir = mitAlterNummer();
  const state = zustand(dir);
  const alt = state.numbers[0];
  state.numbers.push({ id: "num_neu", e164: NEU, tenantId: "owner", provider: "telnyx", status: "active" });
  state.provisioningJobs.push({ kind: "number_swap", numberId: "num_neu", idempotencyKey: `tausch_${alt.id}` });
  fs.writeFileSync(path.join(dir, "store.json"), JSON.stringify(state));
  assert.equal(await gewaehlteNummer(dir), NEU);
});

test("ersatz: --ersetzt traegt die neue Nummer ein, legt die Spur an und der Agent nutzt sie", async () => {
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
  assert.equal(await gewaehlteNummer(dir), NEU);
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

test("ersatz: ohne --ersetzt traegt das Skript nur die Nummer ein, ohne Spur", async () => {
  const dir = mitAlterNummer();
  const lauf = skript(dir, NEU, "telnyx");
  assert.equal(lauf.status, 0, lauf.stderr);
  const state = zustand(dir);
  assert.equal(state.numbers.length, 2);
  assert.equal(tauschSpuren(state).length, 0);
  assert.equal(await gewaehlteNummer(dir), ALT);
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

function zustandSchreiben(dir, state) {
  fs.writeFileSync(path.join(dir, "store.json"), JSON.stringify(state));
}

test("ersatz: eine nicht aktive alte Nummer des Mandanten owner zaehlt nicht, Abbruch mit Grund", () => {
  const dir = mitAlterNummer();
  const state = zustand(dir);
  state.numbers[0].status = "released";
  zustandSchreiben(dir, state);
  const lauf = skript(dir, NEU, "telnyx", "--ersetzt", ALT);
  assert.equal(lauf.status, 1);
  assert.match(lauf.stderr, /alte_nummer_nicht_aktiv/);
  assert.equal(tauschSpuren(zustand(dir)).length, 0);
});

test("ersatz: ein Auftrag anderer Art mit gleichem Schluessel blockiert die Spur nicht", () => {
  const dir = mitAlterNummer();
  const state = zustand(dir);
  state.provisioningJobs.push({ id: "job_x", kind: "purchase", numberId: "num_x", idempotencyKey: `tausch_${state.numbers[0].id}` });
  zustandSchreiben(dir, state);
  const lauf = skript(dir, NEU, "telnyx", "--ersetzt", ALT);
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.equal(tauschSpuren(zustand(dir)).length, 1);
});

test("ersatz: eine Spur zu einer anderen alten Nummer blockiert die Spur nicht", () => {
  const dir = mitAlterNummer();
  const state = zustand(dir);
  state.provisioningJobs.push({ id: "job_y", kind: "number_swap", numberId: "num_y", idempotencyKey: "tausch_num_anders" });
  zustandSchreiben(dir, state);
  const lauf = skript(dir, NEU, "telnyx", "--ersetzt", ALT);
  assert.equal(lauf.status, 0, lauf.stderr);
  const spuren = tauschSpuren(zustand(dir));
  assert.equal(spuren.length, 2);
  const unserSchluessel = `tausch_${state.numbers[0].id}`;
  assert.equal(spuren.filter((job) => job.idempotencyKey === unserSchluessel).length, 1);
});

test("ersatz: die neue Spur bekommt eine Kennung mit Vorsatz job_", () => {
  const dir = mitAlterNummer();
  assert.equal(skript(dir, NEU, "telnyx", "--ersetzt", ALT).status, 0);
  assert.match(tauschSpuren(zustand(dir))[0].id, /^job_/);
});

test("ersatz: ein Abbruch schreibt die Datei nicht neu", () => {
  const dir = mitAlterNummer();
  const datei = path.join(dir, "store.json");
  fs.utimesSync(datei, 1_000_000_000, 1_000_000_000);
  const davor = fs.statSync(datei).mtimeMs;
  const lauf = skript(dir, NEU, "telnyx", "--ersetzt", FREMD);
  assert.equal(lauf.status, 1);
  assert.equal(fs.statSync(datei).mtimeMs, davor);
});

function mitErsatz() {
  const dir = mitAlterNummer();
  assert.equal(skript(dir, NEU, "telnyx", "--ersetzt", ALT).status, 0);
  return dir;
}

test("rueckbau: entfernt die Spur, beide Nummern bleiben aktiv und der Agent nutzt wieder die alte", async () => {
  const dir = mitErsatz();
  const lauf = skript(dir, NEU, "telnyx", "--rueckbau", ALT);
  assert.equal(lauf.status, 0, lauf.stderr);
  const state = zustand(dir);
  assert.equal(tauschSpuren(state).length, 0);
  assert.equal(state.numbers.length, 2);
  assert.deepEqual(state.numbers.map((nummer) => nummer.status), ["active", "active"]);
  assert.equal(await gewaehlteNummer(dir), ALT);
  assert.equal(state.numbers.find((nummer) => nummer.e164 === NEU).tenantId, "owner");
});

test("rueckbau: zweiter Lauf meldet ok und aendert nichts", () => {
  const dir = mitErsatz();
  assert.equal(skript(dir, NEU, "telnyx", "--rueckbau", ALT).status, 0);
  const davor = fs.readFileSync(path.join(dir, "store.json"), "utf8");
  const lauf = skript(dir, NEU, "telnyx", "--rueckbau", ALT);
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.match(lauf.stdout, /Rueckbau ok/);
  assert.equal(fs.readFileSync(path.join(dir, "store.json"), "utf8"), davor);
});

test("rueckbau: keine Spur und neue Nummer unbekannt bricht mit Grund ab", () => {
  const dir = mitAlterNummer();
  const lauf = skript(dir, NEU, "telnyx", "--rueckbau", ALT);
  assert.equal(lauf.status, 1);
  assert.match(lauf.stderr, /keine_spur/);
  assert.equal(zustand(dir).numbers.length, 1);
});

test("rueckbau: Spur gehoert zu einer anderen Nummer, Abbruch ohne Schreiben", () => {
  const dir = mitErsatz();
  const davor = fs.readFileSync(path.join(dir, "store.json"), "utf8");
  assert.equal(skript(dir, FREMD, "telnyx").status, 0);
  const mitFremd = fs.readFileSync(path.join(dir, "store.json"), "utf8");
  const lauf = skript(dir, FREMD, "telnyx", "--rueckbau", ALT);
  assert.equal(lauf.status, 1);
  assert.match(lauf.stderr, /andere_ersatz_spur/);
  assert.equal(fs.readFileSync(path.join(dir, "store.json"), "utf8"), mitFremd);
  assert.equal(tauschSpuren(JSON.parse(davor)).length, 1);
  assert.equal(tauschSpuren(zustand(dir)).length, 1);
});

test("rueckbau: alte Nummer nicht aktiv bricht mit Grund ab und laesst die Spur stehen", () => {
  const dir = mitErsatz();
  const state = zustand(dir);
  state.numbers.find((nummer) => nummer.e164 === ALT).status = "released";
  zustandSchreiben(dir, state);
  const lauf = skript(dir, NEU, "telnyx", "--rueckbau", ALT);
  assert.equal(lauf.status, 1);
  assert.match(lauf.stderr, /alte_nummer_nicht_aktiv/);
  assert.equal(tauschSpuren(zustand(dir)).length, 1);
});

test("rueckbau: andere Spuren und Auftraege bleiben stehen", () => {
  const dir = mitErsatz();
  const state = zustand(dir);
  state.provisioningJobs.unshift({ id: "job_y", kind: "number_swap", numberId: "num_y", idempotencyKey: "tausch_num_anders" });
  state.provisioningJobs.unshift({ id: "job_x", kind: "purchase", numberId: "num_x", idempotencyKey: `tausch_${state.numbers[0].id}` });
  zustandSchreiben(dir, state);
  assert.equal(skript(dir, NEU, "telnyx", "--rueckbau", ALT).status, 0);
  assert.deepEqual(zustand(dir).provisioningJobs.map((job) => job.id).sort(), ["job_x", "job_y"]);
  assert.deepEqual(tauschSpuren(zustand(dir)).map((job) => job.id), ["job_y"]);
});

test("rueckbau: --rueckbau ohne Wert ist ein Aufruffehler mit Exit 1", () => {
  const dir = mitErsatz();
  const lauf = skript(dir, NEU, "telnyx", "--rueckbau");
  assert.equal(lauf.status, 1);
  assert.match(lauf.stderr, /Aufruf/);
  assert.equal(tauschSpuren(zustand(dir)).length, 1);
});

test("rueckbau: zweiter Lauf schreibt die Datei nicht neu", () => {
  const dir = mitErsatz();
  assert.equal(skript(dir, NEU, "telnyx", "--rueckbau", ALT).status, 0);
  const datei = path.join(dir, "store.json");
  fs.utimesSync(datei, 1_000_000_000, 1_000_000_000);
  const davor = fs.statSync(datei).mtimeMs;
  assert.equal(skript(dir, NEU, "telnyx", "--rueckbau", ALT).status, 0);
  assert.equal(fs.statSync(datei).mtimeMs, davor);
});
