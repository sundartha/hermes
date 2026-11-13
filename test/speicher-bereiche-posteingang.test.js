import assert from "node:assert/strict";
import http from "node:http";
import { test, before, after } from "node:test";
import express from "express";

import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/begriffe/mandant.js";

const TRANSCRIPT = [
  { role: "agent", text: "Wann passt es Ihnen?" },
  { role: "caller", text: "Rufen Sie mich bitte morgen an." },
];
const MOCK = {
  summary: "Rueckruf gewuenscht.",
  actionItems: ["Morgen zurueckrufen", "Angebot per Mail senden"],
  objective_achieved: "unclear",
};

let server;
let store, claude, speicherBereiche, makeInboxRoutes;

before(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "msg_zusammenfassung_mock",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          content: [{ type: "text", text: JSON.stringify(MOCK) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 20, output_tokens: 30 },
        }),
      );
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-zusammenfassung-key";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }],
      calls: [seedCall({ id: "call_zusammenfassung_1", transcript: TRANSCRIPT })],
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  claude = await import("../src/claude.js");
  ({ speicherBereiche } = store);
  ({ makeInboxRoutes } = await import("../src/routes/api-inbox.ts"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});


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

test("summarizeCall legt jeden Aktionspunkt der Zusammenfassung als todo am Anruf an, in Reihenfolge", async () => {
  const call = store.getCall("call_zusammenfassung_1");
  const ergebnis = await claude.summarizeCall(call);
  assert.deepEqual(ergebnis.actionItems, MOCK.actionItems);
  const items = store.callActionItems(call.id);
  assert.deepEqual(
    items.map((item) => [item.text, item.type, item.done]),
    MOCK.actionItems.map((text) => [text, "todo", false]),
  );
});
