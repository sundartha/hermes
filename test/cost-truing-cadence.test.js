// KE-P6B (Verzug und Kadenz an die Messung anpassen): EIGENE Datei, weil der Gegenstand
// die Faelligkeits-Schwelle und die Herkunft der Kadenz ist, nicht die Zuordnung. node
// --test gibt je DATEI einen Prozess - erst dadurch ist das Muster "Env loeschen, DANACH
// config.js frisch importieren" isoliert (Lehre test-base-env-drift). Netzfrei: der
// Pool-Fake beruehrt global.fetch nie.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_ENV } from "./helpers.js";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Die beiden Knoepfe werden VOR dem ersten config.js-Import aus der Prozess-Env entfernt:
// der Test prueft den CODE-Default, nicht die Umgebung, in der er zufaellig laeuft.
delete process.env.COST_TRUING_DELAY_MINUTES;
delete process.env.COST_TRUING_SWEEP_INTERVAL_MS;

const { config: defaults } = await import("../src/config.js?ke-p6b-defaults");
const costTruingModule = await import("../src/billing/cost-truing.js");
const { makeCostTruing, SWEEP_TRIGGER } = costTruingModule;
const { makeDefaultState } = await import("../src/store/state-ops.js");
const { makeStubStore, fakeConfig, makeDueOutboundCall, fakeVoiceControl } =
  await import("./cost-truing-harness.js");

// Gemessene Erwartung als LITERAL (nicht als zweite Ausfuehrung derselben Formel):
// 30 min Verzug (F3: Belege spaetestens nach 133 s vollstaendig UND wertrichtig),
// 1 h Kadenz. 31/29 setzen die Schwelle beidseitig eine Minute eng ein.
const EXPECTED_DELAY_MINUTES = 30;
const EXPECTED_INTERVAL_MS = 60 * 60 * 1000;
const DUE_MINUTES_AGO = 31;
const NOT_DUE_MINUTES_AGO = 29;
// Node-Grenze fuer setInterval-Verzoegerungen (32-Bit-signed-Millisekunden).
const MAX_TIMER_DELAY_MS = 2_147_483_647;

// Bewusst leerer Pool-Adapter: Pruefgegenstand dieser Datei ist WELCHE Calls der Sweep
// anfasst, nicht WAS er zuordnet (das pinnen cost-truing-pool/-since/-booking). Er geht
// nie ins Netz und liefert nie einen Beleg - jeder angefasste Kandidat endet damit bei
// 'incomplete' und hat genau einen verbrauchten Versuch.
const idlePoolAdapter = () => ({
  async fetchCostRecordPool() {
    return { ok: true, raw: [], complete: true };
  },
  assignCostRecords: () => ({ ok: true, records: [] }),
});

// ---- (P6B-1) die Faelligkeits-Schwelle des Kandidaten-Praedikats ----
// Der Test faehrt den ECHTEN Config-Default (nicht 30 als Literal in die Fixture
// geschrieben) - sonst waere er vor der Aenderung gruen und bewiese nichts.
test("(P6B-1) beim Config-Default ist ein 31 min alter Call Kandidat, ein 29 min alter nicht", async () => {
  const nowMs = Date.parse("2026-07-21T18:00:00.000Z"); // feste Uhr, keine Wanduhr
  const state = makeDefaultState();
  const faellig = makeDueOutboundCall(state, {
    nowMs, endedMinutesAgo: DUE_MINUTES_AGO, legRef: { callControlId: "cc_p6b_faellig" },
  });
  const zuJung = makeDueOutboundCall(state, {
    nowMs, endedMinutesAgo: NOT_DUE_MINUTES_AGO, legRef: { callControlId: "cc_p6b_jung" },
  });
  const store = makeStubStore(state);
  const config = fakeConfig({ costTruingDelayMinutes: defaults.billing.costTruingDelayMinutes });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: idlePoolAdapter() }),
    audit: () => {}, now: () => nowMs,
  });

  const res = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(res.candidates, 1, "genau der 31-min-Call ist Kandidat");
  assert.equal(faellig.costTruingAttempts, 1, "der faellige Call wurde angefasst");
  assert.equal(zuJung.costTruingAttempts, 0, "der 29-min-Call verbraucht keinen Versuch");
  assert.equal(zuJung.costTruedSource, null, "und bekommt keine Herkunft geschrieben");
});

// ---- (P6B-2) die Kadenz kommt aus der Config, Default 1 h ----
test("(P6B-2) Config-Default: Verzug 30 min, Kadenz 1 h", () => {
  assert.equal(defaults.billing.costTruingDelayMinutes, EXPECTED_DELAY_MINUTES);
  assert.equal(defaults.billing.costTruingSweepIntervalMs, EXPECTED_INTERVAL_MS);
});

// ---- (P6B-3) EINE Quelle: keine zweite, unabhaengig gepflegte Zahl ----
// Bliebe die Modul-Konstante zusaetzlich stehen, waere in einem Jahr unentscheidbar,
// welche der beiden Zahlen das Intervall tatsaechlich stellt.
test("(P6B-3) cost-truing.js exportiert keine eigene Sweep-Kadenz mehr", () => {
  assert.equal("COST_TRUING_SWEEP_INTERVAL_MS" in costTruingModule, false);
});

// ---- (P6B-4) die vier Stellen aus Spec A5 tragen denselben Wert ----
// Fehlt die BASE_ENV-Zeile, leckt eine lokale .env via dotenv in die Spawn-Suite
// (Lehre test-base-env-drift); fehlen .env.example/render.yaml, dokumentiert das Repo
// eine andere Konfiguration als die, die es faehrt.
test("(P6B-4) Verzug und Kadenz stehen in config.js, .env.example, render.yaml und BASE_ENV identisch", () => {
  const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
  const renderYaml = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");
  const fromEnvExample = (name) => envExample.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();
  const fromRenderYaml = (name) =>
    renderYaml.match(new RegExp(`key:\\s*${name}\\s*\\n\\s*value:\\s*"?([^"\\n]+)"?`))?.[1]?.trim();

  for (const [name, expected] of [
    ["COST_TRUING_DELAY_MINUTES", String(EXPECTED_DELAY_MINUTES)],
    ["COST_TRUING_SWEEP_INTERVAL_MS", String(EXPECTED_INTERVAL_MS)],
  ]) {
    assert.equal(fromEnvExample(name), expected, `${name} in .env.example`);
    assert.equal(fromRenderYaml(name), expected, `${name} in render.yaml`);
    assert.equal(BASE_ENV[name], expected, `${name} in BASE_ENV (test/helpers.js)`);
  }
  assert.equal(defaults.billing.costTruingDelayMinutes, EXPECTED_DELAY_MINUTES);
  assert.equal(defaults.billing.costTruingSweepIntervalMs, EXPECTED_INTERVAL_MS);
});

// ---- (P6B-5)/(P6B-6) Grenzen des neuen Knopfs (T5) ----
test("(P6B-5) Kadenz unter dem Minimum -> Fatal-Befund (Boot-Refusal) + Fallback statt Sweep-Sturm", async () => {
  process.env.COST_TRUING_SWEEP_INTERVAL_MS = "59999";
  try {
    const fresh = await import("../src/config.js?ke-p6b-min");
    assert.ok(
      fresh.configFatalErrors().some((e) => e.includes("COST_TRUING_SWEEP_INTERVAL_MS")),
      "eine zu kleine Kadenz muss den Boot verweigern, nicht still durchlaufen",
    );
    assert.equal(fresh.config.billing.costTruingSweepIntervalMs, EXPECTED_INTERVAL_MS);
  } finally {
    delete process.env.COST_TRUING_SWEEP_INTERVAL_MS;
  }
});

test("(P6B-6) Kadenz ueber der Node-Timer-Grenze wird geklemmt (sonst faellt der Timer auf 1 ms)", async () => {
  process.env.COST_TRUING_SWEEP_INTERVAL_MS = String(MAX_TIMER_DELAY_MS + 1);
  try {
    const fresh = await import("../src/config.js?ke-p6b-max");
    assert.equal(fresh.config.billing.costTruingSweepIntervalMs, MAX_TIMER_DELAY_MS);
    assert.ok(
      !fresh.configFatalErrors().some((e) => e.includes("COST_TRUING_SWEEP_INTERVAL_MS")),
      "der Clamp ist bewusst kein Fatal (numEnv-Konvention)",
    );
  } finally {
    delete process.env.COST_TRUING_SWEEP_INTERVAL_MS;
  }
});
