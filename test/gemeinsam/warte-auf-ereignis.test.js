import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import * as helfer from "../helpers.js";

const FRIST_MS = 30_000;
const FEHLER_FRIST = "Bedingung nicht innerhalb der Testfrist erreicht";

test("warte-auf-ereignis: eine schon erfuellte Bedingung kehrt ohne Ereignis zurueck", async () => {
  assert.equal(typeof helfer.warteAufEreignis, "function");
  await helfer.warteAufEreignis([new EventEmitter()], () => true, { timeoutMs: FRIST_MS });
});

test("warte-auf-ereignis: die Bedingung wird erst nach dem Ereignis erneut geprueft, das sie erfuellt", async () => {
  const quelle = new EventEmitter();
  let zustand = 0;
  let geprueft = 0;
  let fertig = false;
  const warten = helfer
    .warteAufEreignis([quelle], () => (geprueft += 1) > 0 && zustand === 2, { timeoutMs: FRIST_MS })
    .then(() => (fertig = true));
  zustand = 1;
  quelle.emit("aenderung");
  await Promise.resolve();
  assert.equal(fertig, false, "Zustand 1 reicht nicht");
  zustand = 2;
  quelle.emit("aenderung");
  await warten;
  assert.equal(geprueft, 3, "einmal am Anfang, einmal je Ereignis");
  assert.equal(quelle.listenerCount("aenderung"), 0, "Zuhoerer sind abgemeldet");
});

test("warte-auf-ereignis: jede der Quellen weckt die Pruefung", async () => {
  const erste = new EventEmitter();
  const zweite = new EventEmitter();
  let bereit = false;
  const warten = helfer.warteAufEreignis([erste, zweite], () => bereit, { timeoutMs: FRIST_MS });
  bereit = true;
  zweite.emit("aenderung");
  await warten;
  assert.equal(erste.listenerCount("aenderung"), 0);
  assert.equal(zweite.listenerCount("aenderung"), 0);
});

test("warte-auf-ereignis: ohne Ereignis endet die Gesamtfrist mit derselben Meldung wie waitUntil", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const quelle = new EventEmitter();
  const warten = helfer.warteAufEreignis([quelle], () => false, { timeoutMs: FRIST_MS });
  t.mock.timers.tick(FRIST_MS - 1);
  quelle.emit("aenderung");
  t.mock.timers.tick(1);
  await assert.rejects(warten, { message: FEHLER_FRIST });
  assert.equal(quelle.listenerCount("aenderung"), 0);
});

test("warte-auf-ereignis: eine Aenderung der Speicherdatei des Testservers meldet das Ereignis", async () => {
  const srv = await helfer.startServer({});
  try {
    const neu = path.join(srv.dataDir, "store.tmp-ereignis");
    fs.writeFileSync(neu, JSON.stringify({ ...srv.readStore(), ereignisMarke: "gesetzt" }));
    const warten = helfer.warteAufEreignis([srv.ereignisse], () => srv.readStore().ereignisMarke === "gesetzt", { timeoutMs: FRIST_MS });
    fs.renameSync(neu, path.join(srv.dataDir, "store.json"));
    await warten;
  } finally {
    await srv.stop();
  }
});
