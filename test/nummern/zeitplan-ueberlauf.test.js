import { test } from "node:test";
import assert from "node:assert/strict";
import { neueUhr, pgBossUmgebung } from "../gemeinsam/pgboss-umgebung.js";

const NAME = "plane";
const MINUTE_MS = 60_000;
const STUNDE_MS = 60 * MINUTE_MS;

async function springe(clock, ms) {
  await clock.setTime(clock.now() + ms);
  await clock.tick(MINUTE_MS);
}

async function laufeStundenlang(clock, stunden) {
  for (let schritt = 0; schritt < stunden * 6; schritt++) await clock.tick(10 * MINUTE_MS);
}

async function blockierterLauf(t) {
  const clock = neueUhr();
  const { queue, weitereQueue } = await pgBossUmgebung(t, { clock });
  const zustand = { gestartet: 0 };
  let freigeben;
  const blockiert = new Promise((fertig) => {
    freigeben = fertig;
  });
  const lauf = async () => {
    zustand.gestartet++;
    await blockiert;
  };
  await queue.plane(NAME, STUNDE_MS, lauf);
  await weitereQueue().plane(NAME, STUNDE_MS, lauf);
  t.after(() => freigeben());
  await springe(clock, STUNDE_MS - MINUTE_MS);
  await clock.tick(2 * MINUTE_MS);
  return { clock, zustand, freigeben };
}

test("Lauf länger als Takt, zwei Instanzen, gestartet = 1", async (t) => {
  const { clock, zustand, freigeben } = await blockierterLauf(t);
  assert.equal(zustand.gestartet, 1);
  await laufeStundenlang(clock, 2);
  assert.equal(zustand.gestartet, 1);
  freigeben();
  await clock.tick(2 * MINUTE_MS);
  assert.equal(zustand.gestartet, 1);
});

test("ein Lauf unter 24 Stunden wird nie von einem zweiten überholt", async (t) => {
  const { clock, zustand } = await blockierterLauf(t);
  await springe(clock, 23 * STUNDE_MS);
  assert.equal(zustand.gestartet, 1);
});

test("ein Lauf über 24 Stunden gilt als überfällig, ein neuer Takt darf starten", async (t) => {
  const { clock, zustand } = await blockierterLauf(t);
  await springe(clock, 25 * STUNDE_MS);
  await laufeStundenlang(clock, 1);
  assert.equal(zustand.gestartet, 2);
});

test("die Queue des Zeitplans hat Frist 24 Stunden und Herzschlagfenster 30 Sekunden, unabhängig vom Takt", async (t) => {
  const { db, queue } = await pgBossUmgebung(t, { clock: neueUhr() });
  await queue.plane(NAME, 15 * MINUTE_MS, async () => undefined);
  const { rows } = await db.abfragen("SELECT expire_seconds, heartbeat_seconds FROM pgboss.queue WHERE name = $1", ["zeitplan_plane"]);
  assert.equal(Number(rows[0].expire_seconds), 86400);
  assert.equal(Number(rows[0].heartbeat_seconds), 30);
});
