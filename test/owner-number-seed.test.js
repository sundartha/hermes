import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, startServerExpectExit, OWNER_TEST_NUMBER } from "./helpers.js";
import { PROVIDER, DEFAULT_PROVIDER, resolveSeedProvider } from "../src/store/defaults.js";

const SEED_E164 = "+491701234567";

test("resolveSeedProvider: leer -> DEFAULT_PROVIDER (Telnyx, Zero-Config)", () => {
  assert.equal(resolveSeedProvider(""), DEFAULT_PROVIDER);
  assert.equal(resolveSeedProvider(""), PROVIDER.TELNYX);
});

test("resolveSeedProvider: 'twilio' -> null (seit C-P4 kein Anbieter mehr, fail-closed)", () => {
  assert.equal(resolveSeedProvider("twilio"), null);
});

test("resolveSeedProvider: 'telnyx' -> telnyx", () => {
  assert.equal(resolveSeedProvider("telnyx"), PROVIDER.TELNYX);
});

test("resolveSeedProvider: Tippfehler 'telnix' -> null (fail-closed)", () => {
  assert.equal(resolveSeedProvider("telnix"), null);
});

test("resolveSeedProvider: Muell -> null (fail-closed)", () => {
  assert.equal(resolveSeedProvider("garbage"), null);
});

test("AC1: kein Store-Seed + gueltige OWNER_NUMBER_SEED -> Boot OK, /healthz 200, Owner-Nummer aktiv", async () => {
  const srv = await startServer({ ownerNumber: null, env: { OWNER_NUMBER_SEED: SEED_E164 } });
  try {
    const health = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(health.status, 200, "gueltiger Env-Seed -> Dienst bootet (kein Boot-Refusal)");
    const state = await (await fetch(`${srv.localUrl}/api/state`)).json();
    assert.equal(state.agent.number, SEED_E164, "geseedete Owner-Nummer ist die aktive Nummer");
    assert.ok(!srv.stdout.includes(SEED_E164), "AC7: Owner-Nummer nie im Boot-Log (kein PII-Leak)");
  } finally {
    await srv.stop();
  }
});

test("AC4: OWNER_NUMBER_PROVIDER=telnyx + gueltige Nummer -> Boot OK", async () => {
  const srv = await startServer({
    ownerNumber: null,
    env: { OWNER_NUMBER_SEED: SEED_E164, OWNER_NUMBER_PROVIDER: "telnyx" },
  });
  try {
    const state = await (await fetch(`${srv.localUrl}/api/state`)).json();
    assert.equal(state.agent.number, SEED_E164, "telnyx ist ein gueltiger Provider -> geseedet");
  } finally {
    await srv.stop();
  }
});

test("AC4: ungueltiger OWNER_NUMBER_PROVIDER ('twillio') -> Boot-Refusal (exit 1), nennt Var", async () => {
  const { code, output } = await startServerExpectExit({
    ownerNumber: null,
    env: { OWNER_NUMBER_SEED: SEED_E164, OWNER_NUMBER_PROVIDER: "twillio" },
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /OWNER_NUMBER_PROVIDER/, "Diagnose nennt die ungueltige Provider-Var");
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein (kein Falsch-Carrier-Seed)");
});

test("AC3: OWNER_NUMBER_SEED ohne gueltiges E.164 ('hallo') -> Boot-Refusal (exit 1), nennt Var", async () => {
  const { code, output } = await startServerExpectExit({
    ownerNumber: null,
    env: { OWNER_NUMBER_SEED: "hallo" },
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /OWNER_NUMBER_SEED/, "Diagnose nennt die ungueltige Seed-Var");
  assert.doesNotMatch(output, /Gateway laeuft/, "kein gruener Boot mit totem Routing");
});

test("AC2: leere OWNER_NUMBER_SEED + kein Store-Seed -> Boot-Refusal (fail-closed unveraendert)", async () => {
  const { code, output } = await startServerExpectExit({
    ownerNumber: null,
    env: { OWNER_NUMBER_SEED: "" },
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /Keine aktive Nummer im Store/, "leere Var = kein Seed -> Boot-Guard greift");
  assert.doesNotMatch(output, /Gateway laeuft/);
});

test("AC6: aktive Store-Owner-Nummer gewinnt -> Env-Seed ist No-Op (kein Doppel-Seed)", async () => {
  const srv = await startServer({ env: { OWNER_NUMBER_SEED: SEED_E164 } });
  try {
    const state = await (await fetch(`${srv.localUrl}/api/state`)).json();
    assert.equal(
      state.agent.number,
      OWNER_TEST_NUMBER.e164,
      "Bestands-/Store-Nummer gewinnt, NICHT der Env-Seed",
    );
    assert.notEqual(state.agent.number, SEED_E164, "der Env-Seed darf die Store-Nummer nicht ueberschreiben");
  } finally {
    await srv.stop();
  }
});
