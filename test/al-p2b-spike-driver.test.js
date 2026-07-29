// AL-P2b (WEGWERF, nie nach master): Offline-Unit-Test der reinen Funktionen aus
// scripts/al-p2-spike-driver.mjs. Kein Netz, kein process.exit - der isMain-Guard im
// Skript verhindert main() beim Import (Muster test/telnyx-call-latency.test.js).
// Geprueft werden genau die Eigenschaften, an denen im Pre-Mortem der Schaden haengt:
// die Refusal-Riegel, der Dry-Run-Default, die fail-closed Argumentform, das gemessene
// (nicht behauptete) Rueckbau-Urteil und die Secret-Freiheit des Snapshots.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  forbiddenTokenIn,
  parseDriverArgs,
  spikeSnapshot,
  connectionMismatches,
  LIVE_DID,
  LIVE_ASSISTANT_PREFIX,
  HERMES_TEXML_APP_ID,
} from "../scripts/al-p2-spike-driver.mjs";

const SERVICE = "https://spike.example";
const BLANK_ASSISTANT = "assistant-11111111-2222-3333-4444-555555555555";
const SPIKE_TEXML_APP = "9999999999999999999";
// process.argv-Form: [node, script, ...args] - parseDriverArgs sliced die ersten zwei weg.
const argv = (...args) => ["node", "scripts/al-p2-spike-driver.mjs", ...args];
const armArgs = (...extra) =>
  argv(
    "--arm",
    "--service",
    SERVICE,
    "--assistant",
    BLANK_ASSISTANT,
    "--texml-app",
    SPIKE_TEXML_APP,
    ...extra,
  );

// === Refusal-Riegel ==================================================================

test("AL-P2b-6: die Live-DID in IRGENDEINEM Argument verweigert den Dienst", () => {
  assert.equal(forbiddenTokenIn(argv("--measure", "--service", SERVICE, LIVE_DID)), LIVE_DID);
  assert.equal(forbiddenTokenIn(argv("--restore", "--apply")), null);
});

test("AL-P2b-7: der Live-Assistant ist tabu", () => {
  const liveAssistantId = `${LIVE_ASSISTANT_PREFIX}-abcd`;
  assert.equal(
    forbiddenTokenIn(argv("--arm", "--service", SERVICE, "--assistant", liveAssistantId)),
    LIVE_ASSISTANT_PREFIX,
  );
  assert.equal(forbiddenTokenIn(armArgs()), null);
});

// === Argumentform ====================================================================

test("AL-P2b-8: --dry-run ist der Default", () => {
  assert.equal(parseDriverArgs(armArgs()).apply, false);
  assert.equal(parseDriverArgs(armArgs("--apply")).apply, true);
});

test("AL-P2b-9: fail-closed Argumentform", () => {
  const cases = [
    argv(), // kein Kommando
    argv("--arm", "--restore", "--service", SERVICE), // zwei Kommandos
    argv(
      "--arm",
      "--service",
      SERVICE,
      "--assistant",
      BLANK_ASSISTANT,
      "--texml-app",
      SPIKE_TEXML_APP,
      "--woher",
    ), // unbekanntes Token
    argv("--measure", "--service", SERVICE), // --spike-delay-ms fehlt
    argv("--measure", "--service", SERVICE, "--spike-delay-ms", "0"), // keine positive Ganzzahl
  ];
  for (const args of cases) {
    const parsed = parseDriverArgs(args);
    assert.equal(typeof parsed.error, "string", `Fehler erwartet fuer: ${args.slice(2).join(" ")}`);
    assert.ok(
      parsed.error.length > 0,
      `nicht-leerer Grund erwartet fuer: ${args.slice(2).join(" ")}`,
    );
  }
  // Gegenprobe: die gueltige Messform parst durch (sonst pruefte der Test nur Ablehnung).
  const ok = parseDriverArgs(argv("--measure", "--service", SERVICE, "--spike-delay-ms", "8000"));
  assert.equal(ok.error, undefined);
  assert.equal(ok.spikeDelayMs, 8000);
});

// === Rueckbau-Urteil =================================================================

test("AL-P2b-10: Rueckbau-Urteil wird geprueft, nicht behauptet", () => {
  const numbers = [
    { e164: "+18643028341", connectionId: HERMES_TEXML_APP_ID },
    { e164: "+15739090177", connectionId: "999" },
  ];
  assert.deepEqual(connectionMismatches(numbers, HERMES_TEXML_APP_ID), ["+15739090177"]);
  const bothCorrect = numbers.map((n) => ({ ...n, connectionId: HERMES_TEXML_APP_ID }));
  assert.deepEqual(connectionMismatches(bothCorrect, HERMES_TEXML_APP_ID), []);
});

// === Snapshot ========================================================================

test("AL-P2b-11: der Snapshot traegt kein Secret", () => {
  const numbers = [
    { e164: "+18643028341", id: "num-1", connectionId: HERMES_TEXML_APP_ID, unused: "egal" },
    { e164: "+15739090177", id: "num-2", connectionId: "3000979485014098987" },
  ];
  const assistant = {
    id: BLANK_ASSISTANT,
    // ROHER Telnyx-Block, wie ihn der GET liefert - die Projektion muss alles bis auf
    // base_url fallen lassen.
    externalLlm: {
      base_url: "https://app.sundartha.com/v1",
      model: "claude-haiku-4-5",
      llm_api_key_ref: "hermes_shim_secret_ref",
      api_key: "sk-darf-nie-im-snapshot-stehen",
      forward_metadata: true,
    },
  };

  const json = JSON.stringify(spikeSnapshot({ numbers, assistant }));

  assert.ok(!json.includes("Bearer"), json);
  assert.ok(!/api[_-]?[Kk]ey/i.test(json), json);
  assert.ok(!json.includes("sk-darf-nie-im-snapshot-stehen"), json);
  assert.ok(json.includes(HERMES_TEXML_APP_ID), json);
  assert.ok(json.includes("3000979485014098987"), json);
  assert.ok(json.includes("https://app.sundartha.com/v1"), json);
});
