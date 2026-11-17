import { test } from "node:test";
import assert from "node:assert/strict";
import { neueUhr, pgBossUmgebung } from "../gemeinsam/pgboss-umgebung.js";

const MINUTE_MS = 60_000;
const STUNDE_MS = 60 * MINUTE_MS;

test("eine bestehende Zeitplan-Queue mit Frist gleich Takt und ohne Herzschlag wird auf 24 Stunden und 30 Sekunden angeglichen", async (t) => {
  const { db, queue, weitereQueue } = await pgBossUmgebung(t, { clock: neueUhr() });
  await queue.plane("plane", STUNDE_MS, async () => undefined);
  await db.abfragen("UPDATE pgboss.queue SET expire_seconds = 3600, heartbeat_seconds = NULL WHERE name = $1", ["zeitplan_plane"]);
  const vorher = await db.abfragen("SELECT expire_seconds, heartbeat_seconds FROM pgboss.queue WHERE name = $1", ["zeitplan_plane"]);
  assert.equal(Number(vorher.rows[0].expire_seconds), 3600);
  assert.equal(vorher.rows[0].heartbeat_seconds, null);
  await weitereQueue().plane("plane", STUNDE_MS, async () => undefined);
  const { rows } = await db.abfragen("SELECT expire_seconds, heartbeat_seconds FROM pgboss.queue WHERE name = $1", ["zeitplan_plane"]);
  assert.equal(Number(rows[0].expire_seconds), 86400);
  assert.equal(Number(rows[0].heartbeat_seconds), 30);
});
