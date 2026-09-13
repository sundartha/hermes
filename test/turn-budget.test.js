// GAP-22: src/turn-budget.js ist ein reines Rechenmodul, KEIN config-Import - unit-testbar
// ohne Env-Bastelei. Die Formel-Tests beweisen die Rechnung unabhaengig von config;
// "die ausgelieferten Defaults halten" beweist den eigentlichen Fix gegen die real
// dokumentierten Default-Werte.
import { test } from "node:test";
import assert from "node:assert/strict";
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
} from "../src/turn-budget.js";
import { startServer } from "./helpers.js";

test("llmTurnBudgetMs: Backoff-Summe ist base*(2^r-1), NICHT 2*base", () => {
  // 1 Retry: attempts=2, backoffSum = base*(2^1-1) = base.
  assert.equal(llmTurnBudgetMs({ requestTimeoutMs: 1000, maxRetries: 1, backoffMs: 100 }), 2100);
  // 2 Retries: attempts=3, backoffSum = base*(2^2-1) = 3*base.
  assert.equal(llmTurnBudgetMs({ requestTimeoutMs: 3500, maxRetries: 2, backoffMs: 250 }), 11250);
  // 3 Retries: attempts=4, backoffSum = base*(2^3-1) = 7*base.
  assert.equal(llmTurnBudgetMs({ requestTimeoutMs: 1000, maxRetries: 3, backoffMs: 100 }), 4700);
});

test("llmTurnBudgetMs: Rand maxRetries=0 -> genau 1 Versuch, kein Backoff", () => {
  assert.equal(llmTurnBudgetMs({ requestTimeoutMs: 3500, maxRetries: 0, backoffMs: 250 }), 3500);
});

test("turnBudgetMs: addiert Synthese + Netzreserve auf das LLM-Budget", () => {
  const llm = llmTurnBudgetMs({ requestTimeoutMs: 3500, maxRetries: 2, backoffMs: 250 });
  assert.equal(
    turnBudgetMs({ requestTimeoutMs: 3500, maxRetries: 2, backoffMs: 250, synthTimeoutMs: 2000 }),
    llm + 2000 + TURN_NETWORK_RESERVE_MS,
  );
});

test("turnBudgetOverrun: null wenn das Budget haelt", () => {
  assert.equal(
    turnBudgetOverrun({ requestTimeoutMs: 3500, maxRetries: 2, backoffMs: 250, synthTimeoutMs: 2000 }),
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
  assert.equal(finding.budgetMs, 11250 + 9000 + TURN_NETWORK_RESERVE_MS);
  assert.equal(finding.overrunMs, finding.budgetMs - PROVIDER_WEBHOOK_HARDCUT_MS);
});

// Der eigentliche GAP-22-Fix: die ausgelieferten Defaults (config.js-Fallbacks) halten
// das Turn-Budget unter dem Provider-Hardcut. 11250 (LLM) + 2000 (Synthese) + 1500
// (Netzreserve) = 14750 <= 15000.
test("die ausgelieferten Defaults halten das Turn-Budget", () => {
  const budgetMs = turnBudgetMs({
    requestTimeoutMs: 3500,
    maxRetries: 2,
    backoffMs: 250,
    synthTimeoutMs: 2000,
  });
  assert.equal(budgetMs, 14750);
  assert.ok(budgetMs <= PROVIDER_WEBHOOK_HARDCUT_MS);
});

// Doku-Parity (Muster cost-truing-cadence.test.js): .env.example, render.yaml und der
// config-Fallback nennen dieselben 2000 ms - ein Blueprint kann den Fix nicht lautlos
// zurueckdrehen, ohne diesen Test rot zu machen.
test("Doku-Parity: .env.example, render.yaml und config-Fallback nennen dieselben 2000 ms", () => {
  const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  const renderYaml = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");
  const configSrc = readFileSync(new URL("../src/config.js", import.meta.url), "utf8");

  assert.match(envExample, /ELEVENLABS_SYNTH_TIMEOUT_MS=2000\b/);
  assert.match(renderYaml, /key: ELEVENLABS_SYNTH_TIMEOUT_MS\s*\n\s*value: "2000"/);
  assert.match(configSrc, /ELEVENLABS_SYNTH_TIMEOUT_MS[\s\S]{0,120}fallback:\s*2000/);
});

// ---- AL-P6: die reale Mehr-Runden-Rechnung (Frist + Worst-Case gegen Dead-Air) ----

test("MAX_TOOL_ROUNDS_PER_TURN pinnt die Rundenzahl, die claude.js UND der Boot-Waechter teilen", () => {
  assert.equal(MAX_TOOL_ROUNDS_PER_TURN, 4);
});

test("turnLoopDeadlineMs: Hardcut minus Synthese minus Netzreserve, nie negativ", () => {
  assert.equal(turnLoopDeadlineMs(2000), 11500);
  assert.equal(turnLoopDeadlineMs(20000), 0);
});

test("roundFitsDeadline: die Grenze ist inklusiv", () => {
  const deadlineMs = 11500;
  const requestTimeoutMs = 3500;
  assert.equal(roundFitsDeadline({ elapsedMs: 8000, deadlineMs, requestTimeoutMs }), true);
  assert.equal(roundFitsDeadline({ elapsedMs: 8001, deadlineMs, requestTimeoutMs }), false);
  assert.equal(roundFitsDeadline({ elapsedMs: 0, deadlineMs, requestTimeoutMs }), true);
});

// Boot-Beweis (Muster test/cost-drift-boot.test.js): echter Kindprozess-Spawn, kein
// injizierter Logger noetig - warnTurnBudgetOverrun ruft console.warn direkt wie alle
// uebrigen Boot-Guards in src/boot.js.
test("Boot warnt bei gesprengtem Turn-Budget", async (t) => {
  await t.test("ausgelieferte Defaults: keine Turn-Budget-WARN", async () => {
    const srv = await startServer({});
    try {
      assert.doesNotMatch(srv.stdout, /Turn-Budget \d+ ms ueberschreitet/);
    } finally {
      await srv.stop();
    }
  });

  await t.test("ELEVENLABS_SYNTH_TIMEOUT_MS=9000 sprengt das Budget -> genau eine WARN-Zeile", async () => {
    const srv = await startServer({ env: { ELEVENLABS_SYNTH_TIMEOUT_MS: "9000" } });
    try {
      const matches = srv.stdout.match(/\[boot\] Konfig-Warnung: Turn-Budget \d+ ms ueberschreitet den Provider-Hardcut 15000 ms/g);
      assert.equal(matches ? matches.length : 0, 1, `erwartet genau eine WARN-Zeile, Output:\n${srv.stdout}`);
    } finally {
      await srv.stop();
    }
  });
});

