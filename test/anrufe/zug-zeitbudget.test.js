import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  MAX_TOOL_ROUNDS_PER_TURN,
  PROVIDER_WEBHOOK_HARDCUT_MS,
  TURN_NETWORK_RESERVE_MS,
  llmTurnBudgetMs,
  roundFitsDeadline,
  turnBudgetMs,
  turnBudgetOverrun,
  turnLoopDeadlineMs,
} from "../../src/turn-budget.js";
import { startServer } from "../helpers.js";
import { gebauteKonfiguration } from "../gemeinsam/gebaute-konfiguration.js";

const DEFAULT_ZUGBUDGET_MS = 14750;
const DREI_RETRIES_BUDGET_MS = 4700;
const EIN_RETRY_BUDGET_MS = 2100;
const SCHLEIFENFRIST_MS = 11500;
const SPRECHPFAD_TIMEOUT_MS = 3500;
const SYNTHESE_MS = 2000;
const UEBERLANGE_SYNTHESE_MS = 9000;
const WERKZEUGRUNDEN_JE_ZUG = 4;
const ZU_LANGE_SYNTHESE_MS = 20000;
const ZWEI_RETRIES_BUDGET_MS = 11250;

test("llmTurnBudgetMs: Backoff-Summe ist base*(2^r-1), NICHT 2*base", () => {
  assert.equal(
    llmTurnBudgetMs({ requestTimeoutMs: 1000, maxRetries: 1, backoffMs: 100 }),
    EIN_RETRY_BUDGET_MS,
  );
  assert.equal(
    llmTurnBudgetMs({ requestTimeoutMs: 3500, maxRetries: 2, backoffMs: 250 }),
    ZWEI_RETRIES_BUDGET_MS,
  );
  assert.equal(
    llmTurnBudgetMs({ requestTimeoutMs: 1000, maxRetries: 3, backoffMs: 100 }),
    DREI_RETRIES_BUDGET_MS,
  );
});

test("llmTurnBudgetMs: Rand maxRetries=0 -> genau 1 Versuch, kein Backoff", () => {
  assert.equal(
    llmTurnBudgetMs({ requestTimeoutMs: 3500, maxRetries: 0, backoffMs: 250 }),
    SPRECHPFAD_TIMEOUT_MS,
  );
});

test("turnBudgetMs: addiert Synthese + Netzreserve auf das LLM-Budget", () => {
  const llm = llmTurnBudgetMs({ requestTimeoutMs: 3500, maxRetries: 2, backoffMs: 250 });
  assert.equal(
    turnBudgetMs({ requestTimeoutMs: 3500, maxRetries: 2, backoffMs: 250, synthTimeoutMs: 2000 }),
    llm + SYNTHESE_MS + TURN_NETWORK_RESERVE_MS,
  );
});

test("turnBudgetOverrun: null wenn das Budget haelt", () => {
  assert.equal(
    turnBudgetOverrun({
      requestTimeoutMs: 3500,
      maxRetries: 2,
      backoffMs: 250,
      synthTimeoutMs: 2000,
    }),
    null,
  );
});

test("turnBudgetOverrun: liefert budgetMs/hardcutMs/overrunMs bei Verletzung", () => {
  const finding = turnBudgetOverrun({
    requestTimeoutMs: 3500,
    maxRetries: 2,
    backoffMs: 250,
    synthTimeoutMs: 9000,
  });
  assert.ok(finding);
  assert.equal(finding.hardcutMs, PROVIDER_WEBHOOK_HARDCUT_MS);
  assert.equal(
    finding.budgetMs,
    ZWEI_RETRIES_BUDGET_MS + UEBERLANGE_SYNTHESE_MS + TURN_NETWORK_RESERVE_MS,
  );
  assert.equal(finding.overrunMs, finding.budgetMs - PROVIDER_WEBHOOK_HARDCUT_MS);
});

test("die ausgelieferten Defaults halten das Turn-Budget", () => {
  const budgetMs = turnBudgetMs({
    requestTimeoutMs: 3500,
    maxRetries: 2,
    backoffMs: 250,
    synthTimeoutMs: 2000,
  });
  assert.equal(budgetMs, DEFAULT_ZUGBUDGET_MS);
  assert.ok(budgetMs <= PROVIDER_WEBHOOK_HARDCUT_MS);
});

const SYNTHESE_FELD = "voice.elevenLabsPlayTts.synthTimeoutMs";

test("Doku-Parity: .env.example, render.yaml und config-Fallback nennen dieselben 2000 ms", () => {
  const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
  const renderYaml = readFileSync(new URL("../../render.yaml", import.meta.url), "utf8");

  assert.match(envExample, /ELEVENLABS_SYNTH_TIMEOUT_MS=2000\b/);
  assert.match(renderYaml, /key: ELEVENLABS_SYNTH_TIMEOUT_MS\s*\n\s*value: "2000"/);
  assert.deepEqual(
    gebauteKonfiguration({ ELEVENLABS_SYNTH_TIMEOUT_MS: undefined }, [SYNTHESE_FELD]),
    {
      [SYNTHESE_FELD]: SYNTHESE_MS,
    },
  );
});

test("MAX_TOOL_ROUNDS_PER_TURN pinnt die Rundenzahl, die claude.js UND der Boot-Waechter teilen", () => {
  assert.equal(MAX_TOOL_ROUNDS_PER_TURN, WERKZEUGRUNDEN_JE_ZUG);
});

test("turnLoopDeadlineMs: Hardcut minus Synthese minus Netzreserve, nie negativ", () => {
  assert.equal(turnLoopDeadlineMs(SYNTHESE_MS), SCHLEIFENFRIST_MS);
  assert.equal(turnLoopDeadlineMs(ZU_LANGE_SYNTHESE_MS), 0);
});

test("roundFitsDeadline: die Grenze ist inklusiv", () => {
  const deadlineMs = 11500;
  const requestTimeoutMs = 3500;
  assert.equal(roundFitsDeadline({ elapsedMs: 8000, deadlineMs, requestTimeoutMs }), true);
  assert.equal(roundFitsDeadline({ elapsedMs: 8001, deadlineMs, requestTimeoutMs }), false);
  assert.equal(roundFitsDeadline({ elapsedMs: 0, deadlineMs, requestTimeoutMs }), true);
});

test("Boot warnt bei gesprengtem Turn-Budget", async (kontext) => {
  await kontext.test("ausgelieferte Defaults: keine Turn-Budget-WARN", async () => {
    const srv = await startServer({});
    try {
      assert.doesNotMatch(srv.stdout, /Turn-Budget \d+ ms ueberschreitet/);
    } finally {
      await srv.stop();
    }
  });

  await kontext.test(
    "ELEVENLABS_SYNTH_TIMEOUT_MS=9000 sprengt das Budget -> genau eine WARN-Zeile",
    async () => {
      const srv = await startServer({ env: { ELEVENLABS_SYNTH_TIMEOUT_MS: "9000" } });
      try {
        const matches = srv.stdout.match(
          /\[boot\] Konfig-Warnung: Turn-Budget \d+ ms ueberschreitet den Provider-Hardcut 15000 ms/g,
        );
        assert.equal(
          matches ? matches.length : 0,
          1,
          `erwartet genau eine WARN-Zeile, Output:\n${srv.stdout}`,
        );
      } finally {
        await srv.stop();
      }
    },
  );
});
