import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";

import { startServer } from "../helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { echteDatenbank } from "./echtes-postgres.js";
import { haengendeAnfrage } from "./haengende-anfrage.mjs";
import { gemeinsameUmgebung } from "./zwei-prozesse.js";

const GESAMTFRIST_MS = 2000;
const ZEITGRENZE_MS = 60_000;
const EXIT_BEI_GESAMTFRIST = 1;
const GESAMTFRIST_ZEILE = "[shutdown] Gesamtfrist abgelaufen - Exit 1";
const LANGE_GESAMTFRIST_MS = 4000;
const TEILFRIST_ZEILE = "[shutdown] Teilfrist abgelaufen - 1 offene Anfragen abgebrochen";
const FLUSH_ZEILE = "[shutdown] Finaler Store-Flush abgeschlossen";

async function starteMitGesperrterTabelle(t, gesamtfristMs) {
  const db = await echteDatenbank(t);
  if (!db) return null;
  const prozess = await startServer({
    env: gemeinsameUmgebung(db.adresse, { SHUTDOWN_DRAIN_TIMEOUT_MS: String(gesamtfristMs) }),
  });
  t.after(() => prozess.stop());
  const sperre = await db.verbinden();
  await sperre.query("BEGIN");
  await sperre.query("LOCK TABLE tenant IN SHARE MODE");
  t.after(() => sperre.query("ROLLBACK").catch(() => {}));
  return { prozess, sperre };
}

test(
  "S4: haengender finaler Flush endet nach der Gesamtfrist mit Exit 1 und Logzeile",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const aufbau = await starteMitGesperrterTabelle(t, GESAMTFRIST_MS);
    if (!aufbau) return;
    const { prozess } = aufbau;

    const beginn = performance.now();
    const beendet = once(prozess.child, "exit");
    prozess.child.kill("SIGTERM");
    const [exitCode] = await beendet;
    const dauerMs = performance.now() - beginn;

    assert.ok(
      prozess.stdout.includes(GESAMTFRIST_ZEILE),
      `${GESAMTFRIST_ZEILE} fehlt in der Ausgabe:\n${prozess.stdout}`,
    );
    assert.equal(exitCode, EXIT_BEI_GESAMTFRIST, `${GESAMTFRIST_ZEILE}: Exit ${exitCode}`);
    assert.ok(dauerMs >= GESAMTFRIST_MS * 0.9, `Prozess endete schon nach ${dauerMs} ms`);
  },
);

test(
  "S3: nach der Teilfrist ist die haengende Verbindung zu, bevor der haengende Flush endet",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const aufbau = await starteMitGesperrterTabelle(t, LANGE_GESAMTFRIST_MS);
    if (!aufbau) return;
    const { prozess, sperre } = aufbau;

    const anfrage = haengendeAnfrage(prozess);
    await abrufMitFrist(`${prozess.localUrl}/healthz`);
    const beendet = once(prozess.child, "exit");
    prozess.child.kill("SIGTERM");

    assert.equal(await anfrage.ausgang, "abgebrochen", "die haengende Anfrage wird abgebrochen");
    await sperre.query("ROLLBACK");
    const [exitCode] = await beendet;

    assert.ok(prozess.stdout.includes(TEILFRIST_ZEILE), `${TEILFRIST_ZEILE} fehlt:\n${prozess.stdout}`);
    assert.ok(prozess.stdout.includes(FLUSH_ZEILE), `${FLUSH_ZEILE} fehlt:\n${prozess.stdout}`);
    assert.equal(exitCode, 0, `Verbindung wurde erst mit dem Prozessende zu:\n${prozess.stdout}`);
  },
);
