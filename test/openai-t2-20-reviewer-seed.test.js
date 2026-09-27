// Reviewer-Beispieldaten: scripts/seed-reviewer-demo.mjs am echten Kindprozess (json-Store in
// einem Temp-DATA_DIR, nie data/store.json) und der Draht-Beleg ueber HTTP /mcp im OAuth-Modus.
// KEIN pglite in dieser Datei (Lehre: nie mit Server-Spawn mischen) - der pg-Pfad liegt in
// test/openai-t2-20-reviewer-seed-pg.test.js.
//
// Belegt:
// - Trockenlauf-Default: ohne --apply wird nichts geschrieben und der Store nie geladen
//   (Import-Spion mit Positiv-Kontrolle).
// - Abbrueche ohne Schreiben: --apply ohne --tenant, unbekannter Mandant, Betreiber-Mandant,
//   pg ohne --dienst-gestoppt (vor jedem Store-Import, also ohne Verbindungsversuch).
// - --apply aendert NUR calls und actionItems; jeder andere Top-Level-Schluessel (Mandanten,
//   Abo, KYC, Profile, Nummern, Budget, Nutzung, Einstellungen) bleibt deep-equal.
// - Idempotenz, und dass ein OAuth-Login ueber /mcp die Daten zeigt, ohne einen Mandanten
//   anzulegen oder eine Nummer zu kaufen.
// - Kosten-Ueberwachung: nach dem Seed liefert kostenBuchBericht (die Quelle der Buch-Befunde
//   des Kosten-Sweeps, voll gemeldet per Mail+SMS) zu keinem Zeitpunkt einen Befund, und die
//   Kosten-Nachtrags-Quote bleibt unveraendert. Positiv-Kontrolle: dieselben Anrufe mit
//   endedAt=jetzt loesen die Befunde aus.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import {
  BASE_ENV,
  ROOT,
  OWNER_TEST_NUMBER,
  externalIp,
  mcpPost,
  readToolResult,
  startIdp,
  startServer,
  tempDataDir,
  toolCall,
  assertReauthChallenge,
} from "./helpers.js";
import { SPION_MARKE } from "./_import-spion-store.mjs";
import * as ops from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import {
  REVIEWER_SEED_CALLS,
  applyReviewerSeed,
  reviewerSeedEndedAtIso,
} from "../scripts/lib/reviewer-demo-seed.mjs";
import { config } from "../src/config.js";
import { kostenBuchBericht } from "../src/billing/kosten-deckung.js";
import {
  PROVIDER_COST_RECORD_WINDOW_MS,
  costTruingCoveragePercent,
} from "../src/billing/cost-truing.js";
import { MS_PER_HOUR, MS_PER_MINUTE } from "../src/utils/timer.js";

const SCRIPT = "scripts/seed-reviewer-demo.mjs";
const SPION = "./test/_import-spion-store.mjs";
const REVIEWER_TENANT = "tenant_reviewer_test";
const REVIEWER_SUB = "reviewer-sub-test";
const REVIEWER_DID = "+12025550111";
const EXIT_OK = 0;
const EXIT_ABORT = 1;
const SEED_CALL_COUNT = REVIEWER_SEED_CALLS.length;
const SEED_ITEM_TEXTS = REVIEWER_SEED_CALLS.flatMap((entry) => entry.actionItems);
const SEED_SUMMARIES = new Set(REVIEWER_SEED_CALLS.map((entry) => entry.summary));
const CHANGEABLE_KEYS = new Set(["calls", "actionItems"]);

// Vollstaendiger Store mit Betreiber (aktive Nummer, Boot-Guard) und einem regulaeren
// Kunden-Mandanten samt Login-Subjekt, KYC und eigener Nummer - so, wie ihn Web-Login und Abo
// hinterlassen haetten.
function reviewerStoreState() {
  const state = ops.makeDefaultState();
  ops.registerTenant(state, BOOTSTRAP_TENANT_ID, { firstName: "Owner" });
  ops.seedBootstrapNumber(
    state,
    OWNER_TEST_NUMBER.e164,
    BOOTSTRAP_TENANT_ID,
    OWNER_TEST_NUMBER.provider,
  );
  ops.registerTenant(state, REVIEWER_TENANT, { firstName: "Reviewer", idpSubject: REVIEWER_SUB });
  ops.setKycLevel(state, REVIEWER_TENANT, "card");
  ops.seedBootstrapNumber(state, REVIEWER_DID, REVIEWER_TENANT, OWNER_TEST_NUMBER.provider);
  ops.usageFor(state, REVIEWER_TENANT); // Nutzungs-Bucket wie bei einem Kunden, der schon telefoniert hat
  return state;
}

const storeFile = (dataDir) => path.join(dataDir, "store.json");
const readRaw = (dataDir) => fs.readFileSync(storeFile(dataDir), "utf8");
const readState = (dataDir) => JSON.parse(readRaw(dataDir));

function runSeed(dataDir, args, env = {}) {
  const res = spawnSync(process.execPath, ["--import", SPION, SCRIPT, ...args], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, ...BASE_ENV, ...env, DATA_DIR: dataDir },
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

// Baseline so, wie der Store selbst sie schreibt (load + save), damit der Diff nach --apply
// keine Normalisierung beim Laden als Aenderung des Skripts missdeutet.
function normalizedDataDir() {
  const dataDir = tempDataDir(reviewerStoreState());
  const res = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const s = await import('./src/store.js'); s.load(); await s.save();",
    ],
    {
      cwd: ROOT,
      env: { PATH: process.env.PATH, ...BASE_ENV, DATA_DIR: dataDir },
      encoding: "utf8",
    },
  );
  assert.equal(res.status, EXIT_OK, res.stderr);
  return dataDir;
}

// Top-Level-Schluessel ausser calls/actionItems, deren Wert sich unterscheidet.
function changedProtectedKeys(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(
    (key) => !CHANGEABLE_KEYS.has(key) && !isDeepStrictEqual(before[key], after[key]),
  );
}

// createCall zaehlt jeden angelegten Anruf im Lebenszeit-Zaehler usage[tenant].calls mit
// (state-ops createCall, reine Anzeige in get_agent_status). Das ist die einzige erwartete
// usage-Aenderung: der Zaehler des Reviewer-Mandanten waechst um genau die Zahl der
// Seed-Anrufe, jedes andere usage-Feld (Tokens, Kosten, Budget-Achsen) bleibt gleich.
function withoutSeedCallCounter(before, after) {
  const bucketBefore = before.usage[REVIEWER_TENANT];
  const bucketAfter = after.usage[REVIEWER_TENANT];
  assert.equal(
    bucketAfter.calls,
    bucketBefore.calls + SEED_CALL_COUNT,
    "Anruf-Zaehler + Seed-Anrufe",
  );
  return {
    ...after,
    usage: { ...after.usage, [REVIEWER_TENANT]: { ...bucketAfter, calls: bucketBefore.calls } },
  };
}

function assertUntouched(dataDir, run, rawBefore) {
  assert.equal(readRaw(dataDir), rawBefore, "store.json byte-gleich");
  assert.ok(!run.stderr.includes(SPION_MARKE), "Store nie geladen");
}

test("Reviewer-Seed: ohne Argumente Trockenlauf, nichts geschrieben, Store nie geladen", () => {
  const dataDir = normalizedDataDir();
  const rawBefore = readRaw(dataDir);
  const run = runSeed(dataDir, []);
  assert.equal(run.code, EXIT_OK, run.stderr);
  assert.match(run.stdout, /Trockenlauf/);
  assertUntouched(dataDir, run, rawBefore);
  // Positiv-Kontrolle des Spions: der Apply-Zweig laedt den Store und zeigt die Marke.
  const control = runSeed(normalizedDataDir(), ["--apply", "--tenant", REVIEWER_TENANT]);
  assert.equal(control.code, EXIT_OK, control.stderr);
  assert.ok(control.stderr.includes(SPION_MARKE), "Spion erkennt einen Store-Import");
});

test("Reviewer-Seed: --tenant ohne --apply bleibt Trockenlauf", () => {
  const dataDir = normalizedDataDir();
  const rawBefore = readRaw(dataDir);
  const run = runSeed(dataDir, ["--tenant", REVIEWER_TENANT]);
  assert.equal(run.code, EXIT_OK, run.stderr);
  assert.match(run.stdout, /Trockenlauf/);
  assertUntouched(dataDir, run, rawBefore);
});

test("Reviewer-Seed: --apply ohne --tenant bricht ab, ohne Store-Import", () => {
  const dataDir = normalizedDataDir();
  const rawBefore = readRaw(dataDir);
  const run = runSeed(dataDir, ["--apply"]);
  assert.equal(run.code, EXIT_ABORT);
  assertUntouched(dataDir, run, rawBefore);
});

test("Reviewer-Seed: unbekannter Mandant und Betreiber-Mandant brechen ab, nichts geschrieben", () => {
  for (const tenant of ["tenant_gibt_es_nicht", BOOTSTRAP_TENANT_ID]) {
    const dataDir = normalizedDataDir();
    const rawBefore = readRaw(dataDir);
    const run = runSeed(dataDir, ["--apply", "--tenant", tenant]);
    assert.equal(run.code, EXIT_ABORT, `${tenant}: Abbruch erwartet`);
    assert.equal(readRaw(dataDir), rawBefore, `${tenant}: store.json byte-gleich`);
    assert.match(run.stderr, /Abbruch/);
  }
});

test("Reviewer-Seed: pg ohne --dienst-gestoppt bricht vor jedem Store-Import ab", () => {
  const dataDir = normalizedDataDir();
  const rawBefore = readRaw(dataDir);
  const run = runSeed(dataDir, ["--apply", "--tenant", REVIEWER_TENANT], {
    STORE_BACKEND: "pg",
    DATABASE_URL: "postgres://127.0.0.1:1/unerreichbar",
  });
  assert.equal(run.code, EXIT_ABORT);
  assert.match(run.stderr, /--dienst-gestoppt/);
  assertUntouched(dataDir, run, rawBefore);
});

test("Reviewer-Seed: Diff-Pruefer meldet eine Aenderung an einem geschuetzten Schluessel", () => {
  // Positiv-Kontrolle: ohne sie saehe "keine Abweichung" aus wie "prueft nichts".
  const before = reviewerStoreState();
  const after = structuredClone(before);
  after.profiles = { ...after.profiles, "x@example.test": { unrestricted: true } };
  after.calls = [{ id: "egal" }];
  assert.deepEqual(changedProtectedKeys(before, after), ["profiles"]);
});

function assertSeedCalls(calls) {
  assert.equal(calls.length, SEED_CALL_COUNT, "genau die Seed-Anrufe");
  for (const call of calls) {
    assert.equal(call.tenantId, REVIEWER_TENANT);
    assert.equal(call.direction, "inbound");
    assert.equal(call.status, "completed");
    assert.equal(call.answeredAt ?? null, null, "answeredAt nie gesetzt");
    assert.ok(
      Date.parse(call.endedAt) < Date.now() - PROVIDER_COST_RECORD_WINDOW_MS,
      "endedAt liegt vor dem Beleg-Fenster der Kosten-Ueberwachung",
    );
    assert.ok(SEED_SUMMARIES.has(call.summary), "summary = Seed-Text");
    assert.equal(call.costProfile ?? null, null, "kein costProfile");
  }
}

function assertSeedItems(items, seedCallIds) {
  assert.deepEqual(items.map((item) => item.text).sort(), [...SEED_ITEM_TEXTS].sort());
  for (const item of items) {
    assert.equal(item.done, false);
    assert.ok(seedCallIds.has(item.callId), "Item haengt an einem Seed-Anruf");
  }
}

async function callTool(url, token, name) {
  const res = await mcpPost(`${url}/mcp`, token, toolCall(name));
  return readToolResult(res);
}

async function assertWireShowsSeed(url, token) {
  const calls = (await callTool(url, token, "list_calls")).structuredContent.calls;
  for (const summary of SEED_SUMMARIES) {
    const entry = calls.find((call) => call.summary === summary);
    assert.ok(entry, `list_calls zeigt: ${summary}`);
    assert.equal(entry.direction, "inbound");
    assert.equal(entry.status, "completed");
  }
  const itemsText = (await callTool(url, token, "list_action_items")).content[0].text;
  for (const text of SEED_ITEM_TEXTS)
    assert.ok(itemsText.includes(text), `list_action_items zeigt: ${text}`);
}

const newEntries = (beforeList, afterList) => {
  const known = new Set(beforeList.map((entry) => entry.id));
  return afterList.filter((entry) => !known.has(entry.id));
};

const countOf = (state) => ({ tenants: state.tenants.length, numbers: state.numbers.length });

test("Reviewer-Seed: --apply schreibt nur Anrufe/Items, ist idempotent und erscheint ueber /mcp", async (ctx) => {
  const dataDir = normalizedDataDir();
  const before = readState(dataDir);

  await ctx.test("erster Lauf: nur calls/actionItems geaendert", () => {
    const run = runSeed(dataDir, ["--apply", "--tenant", REVIEWER_TENANT]);
    assert.equal(run.code, EXIT_OK, run.stderr);
    assert.match(run.stdout, /angelegt: 3 Anrufe, 4 Action Items/);
    assert.ok(!run.stdout.includes(REVIEWER_TENANT), "stdout nennt keine Mandanten-Kennung");
    const after = readState(dataDir);
    assert.deepEqual(changedProtectedKeys(before, withoutSeedCallCounter(before, after)), []);
    const newCalls = newEntries(before.calls, after.calls);
    assertSeedCalls(newCalls);
    assertSeedItems(
      newEntries(before.actionItems, after.actionItems),
      new Set(newCalls.map((call) => call.id)),
    );
  });

  await ctx.test("zweiter Lauf: nichts zu tun, Store unveraendert", () => {
    const afterFirst = readState(dataDir);
    const run = runSeed(dataDir, ["--apply", "--tenant", REVIEWER_TENANT]);
    assert.equal(run.code, EXIT_OK, run.stderr);
    assert.match(run.stdout, /nichts zu tun/);
    assert.deepEqual(readState(dataDir), afterFirst);
  });

  await ctx.test(
    "Draht HTTP /mcp (OAuth, Interface-IP): Daten sichtbar, kein Mandant, keine Nummer",
    { skip: externalIp() ? false : "keine Interface-IP" },
    async () => {
      const countsBefore = countOf(readState(dataDir));
      const idp = await startIdp();
      const srv = await startServer({
        env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, MULTI_TENANT: "true" },
        dataDir,
      });
      try {
        await assertWireShowsSeed(srv.externalUrl, await idp.sign({ sub: REVIEWER_SUB }));
        const fremd = await callTool(
          srv.externalUrl,
          await idp.sign({ sub: "unbekannt-sub" }),
          "list_calls",
        );
        assertReauthChallenge(fremd);
      } finally {
        await srv.stop();
        await idp.close();
      }
      assert.deepEqual(
        countOf(readState(dataDir)),
        countsBefore,
        "kein Mandant angelegt, keine Nummer gekauft",
      );
    },
  );
});

// ---- Kosten-Ueberwachung nach dem Seed -------------------------------------------------------

const HOURS_PER_DAY = 24;
// Pruefzeitpunkte aus dem Befund: nach 7 h (Herzschlag-Fenster vorbei) und nach 2 Tagen.
const PRUEFPUNKT_STUNDEN = 7;
const PRUEFPUNKT_TAGE = 2;
const SIEBEN_STUNDEN_MS = PRUEFPUNKT_STUNDEN * MS_PER_HOUR;
const ZWEI_TAGE_MS = PRUEFPUNKT_TAGE * HOURS_PER_DAY * MS_PER_HOUR;
// Herzschlag-Fenster laenger als das Beleg-Fenster: der Ende-Zeitpunkt muss dem groesseren folgen.
const HERZSCHLAG_TAGE = 10;
const HERZSCHLAG_ZEHN_TAGE_H = HERZSCHLAG_TAGE * HOURS_PER_DAY;

// Die Store-Fassade ueber einen In-Memory-Zustand: dieselben state-ops, die json- und
// pg-Fassade umhuellen, ohne Datei und ohne Spawn.
function opsFassade(state) {
  return {
    tenantExists: (tenantId) => ops.tenantExists(state, tenantId),
    exportTenantData: (tenantId) => ops.exportTenantData(state, tenantId),
    createCall: (input) => ops.createCall(state, input),
    recordProviderCallResult: (callId, result) =>
      ops.recordProviderCallResult(state, callId, result).call,
    setCallEndedAt: (callId, status, endedAtIso) =>
      ops.setCallEndedAt(state, callId, status, endedAtIso).call,
    addActionItem: (callId, text, type) => ops.addActionItem(state, callId, text, type),
  };
}

const karenzMs = (billing) =>
  billing.costTruingDelayMinutes * MS_PER_MINUTE + billing.costTruingSweepIntervalMs;

// Befund-Codes von kostenBuchBericht zu jedem Pruefzeitpunkt (Versatz ab dem Seed).
function befundeJeZeitpunkt({ state, billing, seedMs }) {
  const versaetze = [0, karenzMs(billing) + MS_PER_MINUTE, SIEBEN_STUNDEN_MS, ZWEI_TAGE_MS];
  return versaetze.map((versatzMs) => ({
    versatzMs,
    codes: kostenBuchBericht({
      state,
      billing,
      nowMs: seedMs + versatzMs,
      deckungFensterMs: PROVIDER_COST_RECORD_WINDOW_MS,
    }).befunde.map((befund) => befund.code),
  }));
}

function geseedeterZustand({ billing, seedMs, endedAtIso }) {
  const state = reviewerStoreState();
  const ende =
    endedAtIso ??
    reviewerSeedEndedAtIso({
      nowMs: seedMs,
      belegFensterMs: PROVIDER_COST_RECORD_WINDOW_MS,
      heartbeatFensterH: billing.kostenHeartbeatFensterH,
    });
  applyReviewerSeed(opsFassade(state), REVIEWER_TENANT, ende);
  return state;
}

const mitBefund = (befunde) => befunde.filter((eintrag) => eintrag.codes.length > 0);

test("Reviewer-Seed: Kosten-Ueberwachung meldet nach dem Seed nichts, Quote unveraendert", async (ctx) => {
  const seedMs = Date.now();

  await ctx.test("Positiv-Kontrolle: endedAt=jetzt loest Buch-Befunde aus", () => {
    const billing = config.billing;
    const state = geseedeterZustand({
      billing,
      seedMs,
      endedAtIso: new Date(seedMs).toISOString(),
    });
    assert.ok(
      mitBefund(befundeJeZeitpunkt({ state, billing, seedMs })).length > 0,
      "die Pruefung erkennt den Alarm-Fall",
    );
  });

  await ctx.test("Standard-Konfiguration: sofort, nach Karenz, nach 7 h, nach 2 Tagen", () => {
    const billing = config.billing;
    const state = geseedeterZustand({ billing, seedMs });
    assert.deepEqual(mitBefund(befundeJeZeitpunkt({ state, billing, seedMs })), []);
  });

  await ctx.test("Herzschlag-Fenster laenger als das Beleg-Fenster", () => {
    const billing = { ...config.billing, kostenHeartbeatFensterH: HERZSCHLAG_ZEHN_TAGE_H };
    const state = geseedeterZustand({ billing, seedMs });
    assert.deepEqual(mitBefund(befundeJeZeitpunkt({ state, billing, seedMs })), []);
  });

  await ctx.test("Kosten-Nachtrags-Quote: vor und nach dem Seed gleich", () => {
    const billing = config.billing;
    const vorher = costTruingCoveragePercent(reviewerStoreState(), seedMs);
    const nachher = costTruingCoveragePercent(geseedeterZustand({ billing, seedMs }), seedMs);
    assert.equal(nachher, vorher);
  });
});
