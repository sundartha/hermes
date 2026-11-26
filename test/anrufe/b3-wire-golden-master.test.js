import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempDataDir, seedState, seedCall } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import { makeJsonMessage, makeWriteSse, text, toolUse } from "../anthropic-sse-fixtures.js";

const RECORD = process.env.B3_WIRE_RECORD === "1";
const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const FIXTURE_PATH = path.join(FIXTURE_DIR, "b3-wire-master.json");

const FIXED_NOW = Date.UTC(2026, 7, 8, 9, 30, 0);
const SEEDED_AT = new Date(FIXED_NOW).toISOString();

const OWNER = "Jonas Beispiel";
const UNWANTED_EXTRA_ROUNDTRIP_MARKER = "UNGEWOLLTER-ZUSATZ-ROUNDTRIP";

const jsonMessage = makeJsonMessage("msg_b3a");
const writeSse = makeWriteSse(jsonMessage);

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
  await import("../../src/config.ts");
  store = await import("../../src/store.js");
  claude = await import("../../src/claude.js");
  briefing = await import("../../src/precall-briefing.js");
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
