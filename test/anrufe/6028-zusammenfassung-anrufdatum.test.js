import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { makeJsonMessage, makeWriteSse, text } from "../anthropic-sse-fixtures.js";

const jsonMessage = makeJsonMessage("msg_6028");
const writeSse = makeWriteSse(jsonMessage);
const TRANSCRIPT = [
  { role: "agent", text: "Guten Tag.", at: "2026-03-10T08:30:00Z" },
  { role: "caller", text: "Rufen Sie mich morgen um 10 Uhr zurueck.", at: "2026-03-10T08:31:00Z" },
];

let server;
let userMessages = [];
let claude;

function ended(id, overrides) {
  return seedCall({ id, status: "ended", language: "de", transcript: TRANSCRIPT, ...overrides });
}

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      userMessages.push(JSON.parse(raw).messages[0].content);
      const blocks = [text('{"summary":"ok","actionItems":[]}')];
      if (JSON.parse(raw).stream === true) return writeSse(res, blocks);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(jsonMessage(blocks)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-6028-key";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel", timezone: "Europe/Berlin" }],
      calls: [
        ended("c_start", { startedAt: "2026-03-10T08:30:00Z" }),
        ended("c_create", { startedAt: null, createdAt: "2026-03-10T08:30:00Z" }),
        ended("c_none", { startedAt: null, createdAt: null }),
        ended("c_nacht", { startedAt: "2026-03-10T23:30:00Z" }),
        ended("c_en", { startedAt: "2026-03-10T08:30:00Z", language: "en" }),
        ended("c_fr", { startedAt: "2026-03-10T08:30:00Z", language: "fr" }),
      ],
    }),
  );
  await import("../../src/config.ts");
  const store = await import("../../src/store.js");
  claude = await import("../../src/claude.js");
});

after(async () => {
  await new Promise((r) => server.close(r));
});

async function eingabe(id) {
  userMessages = [];
  const store = await import("../../src/store.js");
  await claude.summarizeCall(store.getCall(id));
  assert.equal(userMessages.length, 1);
  return userMessages[0];
}

test("6028-1: startedAt wird als Datum mit Zeitzone des Mandanten mitgegeben (de)", async () => {
  const msg = await eingabe("c_start");
  assert.ok(msg.includes("\nAnrufdatum: 2026-03-10 (Europe/Berlin)\n"), msg);
});

test("6028-1b: Beschriftung je Sprache en und fr", async () => {
  assert.ok((await eingabe("c_en")).includes("\nCall date: 2026-03-10 (Europe/Berlin)\n"));
  assert.ok((await eingabe("c_fr")).includes("\nDate de l'appel : 2026-03-10 (Europe/Berlin)\n"));
});

test("6028-2: ohne startedAt gilt createdAt", async () => {
  assert.ok((await eingabe("c_create")).includes("Anrufdatum: 2026-03-10 (Europe/Berlin)"));
});

test("6028-2b: ohne beides entfaellt die Zeile, Rest bleibt", async () => {
  const msg = await eingabe("c_none");
  assert.ok(!msg.includes("Anrufdatum"));
  assert.ok(msg.startsWith("Richtung: outbound\nAuftrag: Testziel\n\nTRANSKRIPT:\n"));
});

test("6028-3: Datum wird in der Zeitzone des Mandanten berechnet", async () => {
  assert.ok((await eingabe("c_nacht")).includes("Anrufdatum: 2026-03-11 (Europe/Berlin)"));
});

test("6028-4: Zeile steht zwischen Auftrag und Transkript", async () => {
  assert.equal(
    await eingabe("c_start"),
    "Richtung: outbound\nAuftrag: Testziel\nAnrufdatum: 2026-03-10 (Europe/Berlin)\n\nTRANSKRIPT:\nAGENT: Guten Tag.\nANRUFER: Rufen Sie mich morgen um 10 Uhr zurueck.",
  );
});
