import { test } from "node:test";
import assert from "node:assert/strict";
import { neueUhr, pgBossUmgebung, wackeligeWarteschlange } from "../gemeinsam/pgboss-umgebung.js";
import { config } from "../../src/config.js";
import { createQueue } from "../../src/queue/registry.js";
import { makeConfigOverrides } from "../helpers.js";

const { withConfigOverrides } = makeConfigOverrides(config);

const NAME = "aufbewahrung";
const MINUTE_MS = 60_000;
const TAKT_MS = 15 * MINUTE_MS;
const FRIST_MS = TAKT_MS + 15 * MINUTE_MS;
const START_MS = Date.UTC(2026, 10, 1, 8, 5);
const ERSTER_LAUF_MS = Date.UTC(2026, 10, 1, 8, 15, 30);

async function ersterLauf(t, lauf) {
  const clock = neueUhr();
  const umgebung = await pgBossUmgebung(t, { clock });
  await clock.setTime(START_MS);
  await umgebung.queue.plane(NAME, TAKT_MS, lauf);
  await clock.tick(11 * MINUTE_MS);
  await clock.tick(MINUTE_MS);
  return { clock, ...umgebung };
}

test("Herzschlag-1: nach erfolgreichem Lauf ist der Takt bis Takt plus Reserve nach dem Lauf nicht überfällig, danach schon", async (t) => {
  const { clock, queue } = await ersterLauf(t, async () => undefined);
  await clock.setTime(ERSTER_LAUF_MS + FRIST_MS);
  assert.deepEqual(await queue.ueberfaellige(), []);
  await clock.setTime(ERSTER_LAUF_MS + FRIST_MS + 1);
  assert.deepEqual(await queue.ueberfaellige(), [NAME]);
});

test("Herzschlag-7: bei mehreren erfolgreichen Läufen zählt der letzte", async (t) => {
  const { clock, queue } = await ersterLauf(t, async () => undefined);
  await clock.tick(15 * MINUTE_MS);
  await clock.tick(15 * MINUTE_MS);
  const letzterLauf = ERSTER_LAUF_MS + 2 * TAKT_MS;
  await clock.setTime(letzterLauf + FRIST_MS);
  assert.deepEqual(await queue.ueberfaellige(), []);
  await clock.setTime(letzterLauf + FRIST_MS + 1);
  assert.deepEqual(await queue.ueberfaellige(), [NAME]);
});

test("Herzschlag-2: schlägt der Lauf fehl, setzt er keinen Herzschlag und der Takt wird nach der Frist ab Anmeldung überfällig", async (t) => {
  const { clock, queue } = await ersterLauf(t, async () => {
    throw new Error("Lauf gescheitert");
  });
  await clock.setTime(START_MS + FRIST_MS);
  assert.deepEqual(await queue.ueberfaellige(), []);
  await clock.setTime(START_MS + FRIST_MS + 1);
  assert.deepEqual(await queue.ueberfaellige(), [NAME]);
});

test("Herzschlag-3: ein Lauf, der auf der anderen Instanz erfolgreich war, zählt für beide Instanzen", async (t) => {
  const clock = neueUhr();
  const { queue, weitereQueue } = await pgBossUmgebung(t, { clock });
  const andere = weitereQueue();
  await clock.setTime(START_MS);
  await queue.plane(NAME, TAKT_MS, async () => undefined);
  await andere.plane(NAME, TAKT_MS, async () => undefined);
  await clock.tick(11 * MINUTE_MS);
  await clock.tick(MINUTE_MS);
  await clock.setTime(ERSTER_LAUF_MS + FRIST_MS);
  assert.deepEqual(await queue.ueberfaellige(), []);
  assert.deepEqual(await andere.ueberfaellige(), []);
});

test("Herzschlag-4: ohne Anmeldung gibt es nichts, das überfällig sein kann", async (t) => {
  const { queue } = await pgBossUmgebung(t, { clock: neueUhr() });
  assert.deepEqual(await queue.ueberfaellige(), []);
});

test("Herzschlag-5: ist pg-boss nicht erreichbar, läuft kein Ersatz im Prozess und der Takt gilt als überfällig", async (t) => {
  const { queue, zustand } = await wackeligeWarteschlange(t);
  let laeufe = 0;
  const lauf = () => laeufe++;
  await assert.rejects(queue.plane(NAME, TAKT_MS, lauf));
  zustand.ausfall = false;
  await queue.plane(NAME, TAKT_MS, lauf);
  zustand.ausfall = true;
  assert.deepEqual(await queue.ueberfaellige(), [NAME]);
  assert.equal(laeufe, 0);
});

test("Herzschlag-6: mit memory setzt nur ein erfolgreich beendeter Lauf den Herzschlag", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: START_MS });
  const queue = withConfigOverrides({ queueBackend: "memory" }, () => createQueue());
  let haengt = false;
  await queue.plane(NAME, TAKT_MS, () => (haengt ? new Promise(() => {}) : undefined));
  t.mock.timers.tick(TAKT_MS);
  await Promise.resolve();
  await Promise.resolve();
  haengt = true;
  t.mock.timers.tick(FRIST_MS);
  assert.deepEqual(await queue.ueberfaellige(), []);
  t.mock.timers.tick(1);
  assert.deepEqual(await queue.ueberfaellige(), [NAME]);
});
