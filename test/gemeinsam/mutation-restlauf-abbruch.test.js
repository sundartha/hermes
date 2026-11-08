import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { setTimeout as warten } from "node:timers/promises";

import { beendeRestlaeufe, starteLauf } from "../../tools/mutation-laeufe.mjs";

const TESTGRUPPE = "test/gemeinsam/testgruppe.mjs";
const SCHLAEFER = "require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); setInterval(() => {}, 1000);";
const ABFRAGE_MS = 50;
const SUCHFRIST_MS = 10_000;
const ZOMBIE = "Z";

function prozesse() {
  const liste = spawnSync("ps", ["-A", "-o", "pid=,ppid=,pgid=,stat="], { encoding: "utf8" }).stdout;
  return liste.split("\n").flatMap((zeile) => {
    const [pid, ppid, pgid, zustand] = zeile.trim().split(/\s+/);
    return pid ? [{ pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), zustand }] : [];
  });
}

function lebendeMitglieder(gruppe) {
  return prozesse().filter(({ pgid, zustand }) => pgid === gruppe && !zustand.startsWith(ZOMBIE));
}

async function innereGruppe(aussen) {
  const ende = Date.now() + SUCHFRIST_MS;
  while (Date.now() < ende) {
    const kinder = prozesse().filter(({ ppid }) => ppid === aussen);
    const innen = kinder.find(({ pgid }) => pgid !== aussen);
    if (innen && lebendeMitglieder(innen.pgid).length > 1) return innen.pgid;
    await warten(ABFRAGE_MS);
  }
  throw new Error(`keine innere Testgruppe unter ${aussen}`);
}

test("Abbruch eines Restlaufs beendet auch die innere Testgruppe mit ihren Kindern", async () => {
  const laeufe = new Set();
  const ergebnis = starteLauf([TESTGRUPPE, "-e", SCHLAEFER], { stdio: "ignore" }, laeufe);
  const [aussen] = laeufe;
  const gruppe = await innereGruppe(aussen.pid);

  beendeRestlaeufe(laeufe);

  assert.equal(await ergebnis, false);
  assert.equal(laeufe.size, 0);
  assert.deepEqual(lebendeMitglieder(gruppe), []);
});
