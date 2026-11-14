import { test } from "node:test";
import assert from "node:assert/strict";
import { neueUhr, pgBossUmgebung } from "../gemeinsam/pgboss-umgebung.js";
import { config } from "../../src/config.js";
import { createQueue } from "../../src/queue/registry.js";
import { starteAufbewahrung } from "../../src/boot.js";
import { makeConfigOverrides } from "../helpers.js";

const { withConfigOverrides } = makeConfigOverrides(config);

const NAME = "aufbewahrung";
const MINUTE_MS = 60_000;
const STUNDE_MS = 60 * MINUTE_MS;
const SECHS_STUNDEN_MS = 6 * STUNDE_MS;

async function zweiInstanzen(t) {
  const clock = neueUhr();
  const { queue, weitereQueue } = await pgBossUmgebung(t, { clock });
  const zaehler = { a: 0, b: 0 };
  await queue.plane(NAME, SECHS_STUNDEN_MS, async () => {
    zaehler.a++;
  });
  await weitereQueue().plane(NAME, SECHS_STUNDEN_MS, async () => {
    zaehler.b++;
  });
  return { clock, zaehler };
}

async function springe(clock, ms) {
  await clock.setTime(clock.now() + ms);
  await clock.tick(MINUTE_MS);
}

const gesamt = (zaehler) => zaehler.a + zaehler.b;

test("Zeitplan-1: bei zwei Instanzen läuft der Takt genau einmal, nicht einmal je Instanz", async (t) => {
  const { clock, zaehler } = await zweiInstanzen(t);
  await springe(clock, 4 * STUNDE_MS - 2 * MINUTE_MS);
  assert.equal(gesamt(zaehler), 0);
  await clock.tick(2 * MINUTE_MS);
  assert.equal(gesamt(zaehler), 1);
});

test("Zeitplan-2: der nächste Takt kommt sechs Stunden später, wieder genau einmal", async (t) => {
  const { clock, zaehler } = await zweiInstanzen(t);
  await springe(clock, 4 * STUNDE_MS - MINUTE_MS);
  await clock.tick(2 * MINUTE_MS);
  await springe(clock, SECHS_STUNDEN_MS - 2 * MINUTE_MS);
  await clock.tick(2 * MINUTE_MS);
  assert.equal(gesamt(zaehler), 2);
});

test("Zeitplan-3: läuft ein Lauf noch, wenn der nächste Takt fällig wird, startet kein zweiter", async (t) => {
  const clock = neueUhr();
  const { queue, weitereQueue } = await pgBossUmgebung(t, { clock });
  let gestartet = 0;
  let freigeben;
  const blockiert = new Promise((fertig) => {
    freigeben = fertig;
  });
  const lauf = async () => {
    gestartet++;
    await blockiert;
  };
  await queue.plane(NAME, SECHS_STUNDEN_MS, lauf);
  await weitereQueue().plane(NAME, SECHS_STUNDEN_MS, lauf);
  await springe(clock, 4 * STUNDE_MS - MINUTE_MS);
  await clock.tick(2 * MINUTE_MS);
  await springe(clock, SECHS_STUNDEN_MS - 2 * MINUTE_MS);
  await clock.tick(2 * MINUTE_MS);
  assert.equal(gestartet, 1);
  freigeben();
});

test("Zeitplan-4: ein Takt, der sich nicht als Cron ausdrücken lässt, wird abgelehnt und läuft nie", async (t) => {
  const { queue } = await pgBossUmgebung(t, { clock: neueUhr() });
  await assert.rejects(queue.plane(NAME, 7 * STUNDE_MS + MINUTE_MS, async () => assert.fail("kein Lauf")), /Takt/);
});

test("Zeitplan-5: mit memory läuft der Lauf im Prozess, sofort einmal und dann je Takt", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const queue = withConfigOverrides({ queueBackend: "memory" }, () => createQueue());
  let laeufe = 0;
  void starteAufbewahrung(() => laeufe++, queue);
  assert.equal(laeufe, 1);
  t.mock.timers.tick(SECHS_STUNDEN_MS - 1);
  assert.equal(laeufe, 1);
  t.mock.timers.tick(1);
  assert.equal(laeufe, 2);
  t.mock.timers.tick(SECHS_STUNDEN_MS);
  assert.equal(laeufe, 3);
});

test("Zeitplan-6: mit pgboss läuft die Aufbewahrung beim Start einmal und danach im Zeitplan", async (t) => {
  const clock = neueUhr();
  const { queue } = await pgBossUmgebung(t, { clock });
  let laeufe = 0;
  await starteAufbewahrung(() => laeufe++, queue);
  assert.equal(laeufe, 1);
  await springe(clock, 4 * STUNDE_MS - MINUTE_MS);
  await clock.tick(2 * MINUTE_MS);
  assert.equal(laeufe, 2);
});

test("Zeitplan-7: schlägt ein Lauf fehl, wird er im selben Takt nicht wiederholt", async (t) => {
  const clock = neueUhr();
  const { queue } = await pgBossUmgebung(t, { clock });
  let versuche = 0;
  await queue.plane(NAME, SECHS_STUNDEN_MS, async () => {
    versuche++;
    throw new Error("Lauf gescheitert");
  });
  await springe(clock, 4 * STUNDE_MS - MINUTE_MS);
  await clock.tick(2 * MINUTE_MS);
  await clock.tick(30 * MINUTE_MS);
  assert.equal(versuche, 1);
});

test("Zeitplan-8: ein Takt in Minuten läuft bei zwei Instanzen je Takt genau einmal", async (t) => {
  const clock = neueUhr();
  const { queue, weitereQueue } = await pgBossUmgebung(t, { clock });
  let laeufe = 0;
  const lauf = async () => {
    laeufe++;
  };
  await clock.setTime(Date.UTC(2026, 10, 1, 8, 5));
  await queue.plane(NAME, 15 * MINUTE_MS, lauf);
  await weitereQueue().plane(NAME, 15 * MINUTE_MS, lauf);
  await clock.tick(9 * MINUTE_MS);
  assert.equal(laeufe, 0);
  await clock.tick(2 * MINUTE_MS);
  assert.equal(laeufe, 1);
});

test("Zeitplan-9: Takte, die der Zeitplan nicht abbilden kann, werden abgelehnt", async (t) => {
  const { queue } = await pgBossUmgebung(t, { clock: neueUhr() });
  for (const takt of [0, 5 * STUNDE_MS, 7 * MINUTE_MS, 90_000])
    await assert.rejects(queue.plane(NAME, takt, async () => assert.fail("kein Lauf")), /Takt/, String(takt));
});

test("Zeitplan-10: der Zeitplan-Lauf zählt nicht als Provisioning-Auftrag", async (t) => {
  const clock = neueUhr();
  const { queue } = await pgBossUmgebung(t, { clock });
  await queue.plane(NAME, SECHS_STUNDEN_MS, async () => undefined);
  await springe(clock, 4 * STUNDE_MS - MINUTE_MS);
  await clock.tick(2 * MINUTE_MS);
  assert.equal(await queue.drain(async () => assert.fail("fremder Auftrag")), 0);
  assert.deepEqual(await queue.warteschlangeZustand(), []);
});
