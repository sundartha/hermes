import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { makeJsonMessage, makeWriteSse, text, toolUse } from "./anthropic-sse-fixtures.js";

const RECORD = process.env.B3_WIRE_RECORD === "1";
const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const FIXTURE_PATH = path.join(FIXTURE_DIR, "b3-wire-master.json");

const FIXED_NOW = Date.UTC(2026, 7, 8, 9, 30, 0);
const SEEDED_AT = new Date(FIXED_NOW).toISOString();

const OWNER = "Jonas Beispiel";
const RAUSCH_BLIP = ".";
const SUBSTANZIELL = "Ja, Donnerstag passt gut";
const UNWANTED_EXTRA_ROUNDTRIP_MARKER = "UNGEWOLLTER-ZUSATZ-ROUNDTRIP";

const jsonMessage = makeJsonMessage("msg_b3a");
const writeSse = makeWriteSse(jsonMessage);

const toolUseAs = (id, name, input) => ({ ...toolUse(name, input), id });

let server;
let queue = [];
let scenario = null;
const recorded = {};

let store, claude, briefing;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      (recorded[scenario] ||= []).push(raw);
      const blocks = queue.shift() || [text(UNWANTED_EXTRA_ROUNDTRIP_MARKER)];
      if (JSON.parse(raw).stream === true) return writeSse(res, blocks);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(jsonMessage(blocks)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-b3a-key";
  process.env.ASSISTANT_CONTEXT_ENABLED = "true";
  process.env.PRECALL_BRIEFING_ENABLED = "true";
  process.env.RESEARCH_ENABLED = "true";
  const seed = (id, overrides = {}) =>
    seedCall({
      id,
      direction: "outbound",
      language: "de",
      startedAt: SEEDED_AT,
      answeredAt: SEEDED_AT,
      ...overrides,
    });
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls: [
        seed("call_b3a_g1"),
        seed("call_b3a_g2"),
        seed("call_b3a_g3"),
        seed("call_b3a_g4"),
        seed("call_b3a_g5"),
        seed("call_b3a_g6", {
          status: "ended",
          endedAt: SEEDED_AT,
          transcript: [
            { role: "agent", text: "Guten Tag, hier ist Hermes.", at: SEEDED_AT },
            { role: "caller", text: "Donnerstag um neun passt.", at: SEEDED_AT },
          ],
        }),
      ],
    }),
  );
  mock.timers.enable({ apis: ["Date"], now: FIXED_NOW });
  await import("../src/config.js");
  store = await import("../src/store.js");
  claude = await import("../src/claude.js");
  briefing = await import("../src/precall-briefing.js");
});

after(async () => {
  mock.timers.reset();
  if (RECORD) {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    fs.writeFileSync(FIXTURE_PATH, `${JSON.stringify(recorded, null, 2)}\n`);
  }
  await new Promise((r) => server.close(r));
});

async function wire(name, blocksQueue, run) {
  scenario = name;
  recorded[name] = [];
  queue = blocksQueue;
  await run();
  if (RECORD) return;
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  assert.deepEqual(recorded[name], fixture[name]);
}

const turnOf = (callId, callerText, options) =>
  claude.agentTurn(store.getCall(callId), callerText, options);

test("B3-WIRE-1 (G1): agentTurn, eine Runde, nur Text", async () => {
  await wire("G1", [[text("Guten Tag, hier ist Hermes.")]], () =>
    turnOf("call_b3a_g1", SUBSTANZIELL),
  );
});

test("B3-WIRE-2 (G2): agentTurn, zwei Runden - Ruecktrage + Werkzeug-Ergebnis", async () => {
  await wire(
    "G2",
    [[toolUse("take_message", { message: "Rueckruf erbeten" })], [text("Mache ich.")]],
    () => turnOf("call_b3a_g2", SUBSTANZIELL),
  );
});

test("B3-WIRE-3 (G3): agentTurn, zwei Werkzeuge in EINER Runde", async () => {
  await wire(
    "G3",
    [
      [
        toolUseAs("tu_a", "take_message", { message: "Erste Notiz" }),
        toolUseAs("tu_b", "take_message", { message: "Zweite Notiz" }),
      ],
      [text("Beides notiert.")],
    ],
    () => turnOf("call_b3a_g3", SUBSTANZIELL),
  );
});

test("B3-WIRE-4 (G4): agentTurn, unterdruecktes end_call", async () => {
  await wire("G4", [[toolUse("end_call", { reason: "fertig" })], [text("Ich warte.")]], () =>
    turnOf("call_b3a_g4", RAUSCH_BLIP),
  );
});

test("B3-WIRE-5 (G5): agentTurn gestreamt (Live-Sprechpfad)", async () => {
  await wire("G5", [[text("Guten Tag. Wie kann ich helfen?")]], () =>
    turnOf("call_b3a_g5", SUBSTANZIELL, { onSpeechChunk: () => {} }),
  );
});

test("B3-WIRE-6 (G6): summarizeCall", async () => {
  await wire("G6", [[text('{"summary":"Termin bestaetigt","actionItems":[]}')]], () =>
    claude.summarizeCall(store.getCall("call_b3a_g6")),
  );
});

test("B3-WIRE-7 (G7): fetchPrecallBriefing ohne Recherche-Anbieter", async () => {
  store.updateSettings(BOOTSTRAP_TENANT_ID, { allowResearch: false });
  await wire("G7", [[toolUse("hintergrund", { summary: "Terminanfrage" })]], () =>
    briefing.fetchPrecallBriefing({
      objective: "Termin beim Friseur vereinbaren",
      ownerNotes: "Am liebsten Donnerstag",
      constraints: "Nicht vor 10 Uhr",
      to: "+4915112345678",
      tenantId: BOOTSTRAP_TENANT_ID,
    }),
  );
});

test("B3-WIRE-8 (G8): fetchPrecallBriefing mit Recherche-Anbieter", async () => {
  store.updateSettings(BOOTSTRAP_TENANT_ID, { allowResearch: true });
  await wire("G8", [[toolUse("hintergrund", { summary: "Terminanfrage" })]], () =>
    briefing.fetchPrecallBriefing({
      objective: "Termin beim Friseur vereinbaren",
      ownerNotes: "Am liebsten Donnerstag",
      constraints: "Nicht vor 10 Uhr",
      to: "+4915112345678",
      tenantId: BOOTSTRAP_TENANT_ID,
    }),
  );
});
