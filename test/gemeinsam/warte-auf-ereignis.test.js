import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import * as helfer from "../helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { starteBetterStackAttrappe } from "./better-stack-attrappe.mjs";

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

test("warte-auf-ereignis: eine Aenderung der Speicherdatei des Testservers meldet das Ereignis speicher", async () => {
  const srv = await helfer.startServer({});
  try {
    const arten = [];
    srv.ereignisse.on("aenderung", (art) => arten.push(art));
    const neu = path.join(srv.dataDir, "store.tmp-ereignis");
    fs.writeFileSync(neu, JSON.stringify({ ...srv.readStore(), ereignisMarke: "gesetzt" }));
    const warten = helfer.warteAufEreignis([srv.ereignisse], () => arten.includes("speicher"), {
      timeoutMs: FRIST_MS,
    });
    fs.renameSync(neu, path.join(srv.dataDir, "store.json"));
    await warten;
  } finally {
    await srv.stop();
  }
});

test("warte-auf-ereignis: eine Logzeile des Testservers meldet das Ereignis log", async () => {
  const srv = await helfer.startServer({});
  try {
    const arten = [];
    srv.ereignisse.on("aenderung", (art) => arten.push(art));
    srv.child.stdout.emit("data", "Zeile");
    assert.deepEqual(arten, ["log"]);
    assert.ok(srv.stdout.endsWith("Zeile"));
  } finally {
    await srv.stop();
  }
});

test("warte-auf-ereignis: die Better-Stack-Attrappe meldet jede eingegangene Meldung als Ereignis", async () => {
  const eingang = await starteBetterStackAttrappe();
  try {
    const gesehen = [];
    eingang.ereignisse.on("aenderung", () => gesehen.push(eingang.meldungen.length));
    const antwort = await abrufMitFrist(eingang.url, {
      method: "POST",
      body: JSON.stringify({ incident: { id: "a", status: "alert" }, text: "t" }),
    });
    assert.equal(antwort.status, 200);
    await helfer.warteAufEreignis([eingang.ereignisse], () => gesehen.length === 1, {
      timeoutMs: FRIST_MS,
    });
    assert.deepEqual(gesehen, [1]);
  } finally {
    await eingang.close();
  }
});
