import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";

const SPRECHEN = "Ja, Donnerstag passt gut";
const ALT = new Date(Date.now() - 3600000).toISOString();
const BUDGET_ACHSE = "budget_tenant";

let server;
let modellAufrufe = 0;
let store;
let claude;

before(async () => {
  server = http.createServer((req, res) => {
    modellAufrufe += 1;
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "msg_lesefrist",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          content: [{ type: "text", text: "Antwort" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      );
    });
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-lesefrist-key";
  process.env.PAYMENT_ENABLED = "true";
  const calls = ["a", "b", "c"].map((nr) =>
    seedCall({ id: `call_lesefrist_${nr}`, direction: "outbound", language: "de", answeredAt: ALT }),
  );
  process.env.DATA_DIR = tempDataDir(
    seedState({ tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }], calls }),
  );
  await import("../../src/config.js");
  store = await import("../../src/store.js");
  claude = await import("../../src/claude.js");
});

after(async () => {
  await new Promise((fertig) => server.close(fertig));
});

function speicherMit(sql, call, spiegelCalls = [call]) {
  const spiegel = Object.create(store);
  spiegel.activeCallsForSql = sql;
  spiegel.activeCallsFor = () => spiegelCalls;
  spiegel.liveBudgetExceeded = (_tenantId, liveCents) => liveCents > 0;
  return spiegel;
}

async function turnMit(nr, sql, spiegelCalls) {
  const call = store.getCall(`call_lesefrist_${nr}`);
  modellAufrufe = 0;
  const fehler = mock.method(console, "error", () => {});
  const turn = await claude.agentTurn(call, SPRECHEN, { speicher: speicherMit(sql, call, spiegelCalls) });
  const meldungen = fehler.mock.calls.map((aufruf) => aufruf.arguments[0]);
  fehler.mock.restore();
  return { turn, meldungen };
}

test("Turn-Kostendecke: Lesefehler der Datenbank prueft mit dem Spiegel des Prozesses", async () => {
  const { turn, meldungen } = await turnMit("a", async () => {
    throw new Error("db weg");
  });
  assert.equal(turn.stopReason, BUDGET_ACHSE);
  assert.equal(modellAufrufe, 0);
  assert.deepEqual(
    meldungen.filter((zeile) => String(zeile).startsWith("[budget]")),
    ["[budget] laufende Anrufe nicht binnen der Frist gelesen, Pruefung mit dem Stand des Prozesses"],
  );
});

test("Turn-Kostendecke: haengender Lesevorgang endet nach der Frist mit dem Spiegel", async () => {
  const { turn, meldungen } = await turnMit("b", () => new Promise(() => {}));
  assert.equal(turn.stopReason, BUDGET_ACHSE);
  assert.equal(modellAufrufe, 0);
  assert.equal(meldungen.filter((zeile) => String(zeile).startsWith("[budget]")).length, 1);
});

test("Turn-Kostendecke: rechtzeitige Antwort der Datenbank gilt, ohne Meldung", async () => {
  const call = store.getCall("call_lesefrist_c");
  const { turn, meldungen } = await turnMit("c", async () => [call], []);
  assert.equal(turn.stopReason, BUDGET_ACHSE);
  assert.equal(meldungen.filter((zeile) => String(zeile).startsWith("[budget]")).length, 0);
});
