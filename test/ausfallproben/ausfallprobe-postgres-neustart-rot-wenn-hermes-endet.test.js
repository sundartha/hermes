import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kindUmgebung } from "../gemeinsam/kind-umgebung.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OHNE_POSTGRES = `kein Postgres, uebersprungen (${POSTGRES_VARIABLE} fehlt)`;
const GEKAPPT_FRIST_MS = 10_000;
const PORT_AM_ENDE = /:(\d+)$/;
const ZIELPORT = /->.*:(\d+)$/;
const HOERER_BEI_STOERUNG = 3;

const abgeben = () => new Promise((fertig) => setImmediate(fertig));

function ausgabeVon(befehl, args) {
  return new Promise((resolve) => {
    execFile(befehl, args, (fehler, stdout) => resolve(fehler ? "" : stdout));
  });
}

async function kindPid(elternPid) {
  const zeilen = (await ausgabeVon("pgrep", ["-P", String(elternPid)])).trim().split("\n");
  return zeilen[0] ? Number(zeilen[0]) : null;
}

async function tcpZeilen(pid, zustand) {
  const text = await ausgabeVon("lsof", [
    "-a",
    "-p",
    String(pid),
    "-iTCP",
    `-sTCP:${zustand}`,
    "-Fn",
  ]);
  return text.split("\n").filter((zeile) => zeile.startsWith("n"));
}

async function hoererPorts(pid) {
  const zeilen = await tcpZeilen(pid, "LISTEN");
  return zeilen.map((zeile) => Number(PORT_AM_ENDE.exec(zeile)[1]));
}

async function verbundenMit(pid, ports) {
  const zeilen = await tcpZeilen(pid, "ESTABLISHED");
  const ziele = zeilen.map((zeile) => Number(ZIELPORT.exec(zeile)?.[1]));
  return ziele.filter((ziel) => ports.includes(ziel));
}

async function wartePassiv(bedingung, frist) {
  const grenze = AbortSignal.timeout(frist);
  while (!(await bedingung())) {
    assert.ok(!grenze.aborted, "Bedingung nicht innerhalb der Frist erreicht");
    await abgeben();
  }
}

async function beendeKindSobaldStoerungLaeuft(elternPid, laeuft) {
  while (laeuft()) {
    const kind = await kindPid(elternPid);
    const hoerer = kind ? await hoererPorts(elternPid) : [];
    if (kind && hoerer.length >= HOERER_BEI_STOERUNG) {
      const zurDatenbank = await verbundenMit(kind, hoerer);
      await wartePassiv(
        async () => (await verbundenMit(kind, zurDatenbank)).length === 0,
        GEKAPPT_FRIST_MS,
      );
      process.kill(kind, "SIGTERM");
      return;
    }
    await abgeben();
  }
}

function letzteZeile(text) {
  const zeilen = text.trim().split("\n");
  return JSON.parse(zeilen.pop());
}

function starteProbe() {
  const prozess = spawn(process.execPath, ["scripts/ausfallproben.mjs", "postgres-neustart"], {
    cwd: ROOT,
    env: kindUmgebung({ [POSTGRES_VARIABLE]: process.env[POSTGRES_VARIABLE] }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ausgabe = { stdout: "", stderr: "" };
  prozess.stdout.on("data", (stueck) => (ausgabe.stdout += stueck));
  prozess.stderr.on("data", (stueck) => (ausgabe.stderr += stueck));
  const ende = new Promise((resolve) => prozess.once("close", resolve));
  return { prozess, ausgabe, ende };
}

test("postgres-neustart: endet Hermes waehrend der Stoerung, ist die Probe rot mit Grund, Exit 1", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  const { prozess, ausgabe, ende } = starteProbe();
  let fertig = false;
  const beender = beendeKindSobaldStoerungLaeuft(prozess.pid, () => !fertig);
  const code = await ende;
  fertig = true;
  await beender;
  const zeile = letzteZeile(ausgabe.stdout);
  assert.equal(code, 1, ausgabe.stdout + ausgabe.stderr);
  assert.equal(zeile.probe, "postgres-neustart");
  assert.equal(zeile.ergebnis, "rot");
  assert.equal(zeile.grund, "Hermes beendete sich");
  assert.equal(zeile.gemessen, null);
  assert.ok(zeile.beleg.gekappt >= 1);
});
