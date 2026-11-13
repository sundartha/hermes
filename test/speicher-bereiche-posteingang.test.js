import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";
import { speicherBereiche } from "../src/store.js";
import { makeInboxRoutes } from "../src/routes/api-inbox.ts";

const ANRUF = "call_posteingang_1";

const POSTEINGANG = [
  ["callActionItems", [ANRUF], [{ text: "Rueckruf" }]],
  ["addActionItem", [ANRUF, "Rueckruf", "todo"], { duplicate: false }],
  ["markInboxEntry", [ANRUF, true], { id: ANRUF }],
  ["takeInboxEntries", ["owner", { limit: 20, includeSeen: false }], { entries: [], remaining: 0, marked: 0 }],
];

function attrappe(tabelle) {
  const aufrufe = [];
  const speicher = {};
  for (const [name, , ergebnis] of tabelle) {
    speicher[name] = (...args) => {
      aufrufe.push([name, ...args]);
      return ergebnis;
    };
  }
  return { speicher, aufrufe };
}

test("posteingang: jede Bereichsfunktion liefert ein Promise mit Argumenten und Ergebnis der Speicherfunktion", async () => {
  const { speicher, aufrufe } = attrappe(POSTEINGANG);
  const funktionen = speicherBereiche(speicher).posteingang;
  assert.deepEqual(Object.keys(funktionen), POSTEINGANG.map(([name]) => name));
  for (const [name, args, ergebnis] of POSTEINGANG) {
    const antwort = funktionen[name](...args);
    assert.ok(antwort instanceof Promise, name);
    assert.deepEqual(await antwort, ergebnis, name);
  }
  assert.deepEqual(aufrufe, POSTEINGANG.map(([name, args]) => [name, ...args]));
});

test("posteingang: Speicherfunktionen werden erst beim Aufruf gelesen", async () => {
  const { speicher } = attrappe(POSTEINGANG);
  const funktionen = speicherBereiche(speicher).posteingang;
  speicher.callActionItems = () => "spaet";
  assert.equal(await funktionen.callActionItems(ANRUF), "spaet");
});

test("posteingang: ein Wurf der Speicherfunktion wird zur Ablehnung", async () => {
  const { speicher } = attrappe(POSTEINGANG);
  const funktionen = speicherBereiche(speicher).posteingang;
  speicher.markInboxEntry = () => {
    throw new Error("kaputt");
  };
  await assert.rejects(funktionen.markInboxEntry(ANRUF, true), /kaputt/);
});

async function postePoll(store) {
  const app = express();
  app.use(express.json());
  app.use(makeInboxRoutes({ store, audit: () => {}, tenant: { requireTenant: () => "owner" } }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const antwort = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/inbox/poll`, { method: "POST" });
    return { status: antwort.status, text: await antwort.text() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("Posteingang-Route: ein Wurf des Speichers landet im Fehlerhandler der Anwendung", async () => {
  const store = {
    takeInboxEntries: () => {
      throw new Error("speicher kaputt");
    },
  };
  const antwort = await postePoll(store);
  assert.equal(antwort.status, 500);
  assert.match(antwort.text, /speicher kaputt/);
});

test("Posteingang-Route: liefert die Eintraege der Speicherfunktion erst nach deren Ergebnis", async () => {
  const store = { takeInboxEntries: () => ({ entries: [{ call_id: "a" }], remaining: 3, marked: 1 }) };
  const antwort = await postePoll(store);
  assert.equal(antwort.status, 200);
  assert.deepEqual(JSON.parse(antwort.text), { entries: [{ call_id: "a" }], remaining: 3 });
});
