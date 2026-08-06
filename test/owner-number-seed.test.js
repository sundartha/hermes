// render-owner-autoseed: Boot-Integrationsbeweis fuer den Owner-/Betriebsnummer-Autoseed
// aus der Env (OWNER_NUMBER_SEED + OWNER_NUMBER_PROVIDER). Render (free plan) hat ein
// fluechtiges Dateisystem -> ohne diesen Seed braeche der Boot-Guard (server.js) nach jedem
// Deploy fail-closed mit exit(1) ab. Deckt AC1-AC8 des Strategie-Dokuments
// (docs/strategy/render-owner-autoseed.md) ab: gueltiger Env-Seed -> Boot OK; leere/
// ungueltige Env -> fail-closed Boot-Refusal; Store gewinnt; kein PII-Leak.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, startServerExpectExit, OWNER_TEST_NUMBER } from "./helpers.js";
import { PROVIDER, DEFAULT_PROVIDER, resolveSeedProvider } from "../src/store/defaults.js";

// Gueltige E.164-Owner-Nummer fuer den Env-Seed, BEWUSST verschieden von OWNER_TEST_NUMBER
// (+15005550006): so beweist der AC6-Test, dass die Store-Nummer gewinnt, nicht der Seed.
const SEED_E164 = "+491701234567";

// ---- AC4 / Pre-Mortem R1 (stiller Falsch-Carrier): Provider-Aufloesung, pure Unit ----
// resolveSeedProvider entscheidet leer->Default / gueltig->Wert / Muell->null. Direkt
// getestet (nicht nur ueber Boot-Erfolg), damit ein Mapping-Bug telnyx->twilio NICHT still
// durchrutscht (waere ein gruener Boot mit falschem Carrier).
test("resolveSeedProvider: leer -> DEFAULT_PROVIDER (Telnyx, Zero-Config)", () => {
  assert.equal(resolveSeedProvider(""), DEFAULT_PROVIDER);
  assert.equal(resolveSeedProvider(""), PROVIDER.TELNYX);
});

test("resolveSeedProvider: 'twilio' -> twilio", () => {
  assert.equal(resolveSeedProvider("twilio"), PROVIDER.TWILIO);
});

test("resolveSeedProvider: 'telnyx' -> telnyx (R1: NICHT still twilio)", () => {
  assert.equal(resolveSeedProvider("telnyx"), PROVIDER.TELNYX);
});

test("resolveSeedProvider: Tippfehler 'twillio' -> null (fail-closed)", () => {
  assert.equal(resolveSeedProvider("twillio"), null);
});

test("resolveSeedProvider: Muell -> null (fail-closed)", () => {
  assert.equal(resolveSeedProvider("garbage"), null);
});

// ---- AC1: Render-Boot-Beweis (leerer Store + gueltige Env -> Boot OK) ----
test("AC1: kein Store-Seed + gueltige OWNER_NUMBER_SEED -> Boot OK, /healthz 200, Owner-Nummer aktiv", async () => {
  // ownerNumber:null -> Spawn-Store OHNE aktive Nummer (Render-Situation: fluechtiges FS,
  // data/store.json weg). Ohne den Env-Seed griffe der Boot-Guard (exit 1). Kein
  // OWNER_NUMBER_PROVIDER -> Default Telnyx (resolveSeedProvider).
  const srv = await startServer({ ownerNumber: null, env: { OWNER_NUMBER_SEED: SEED_E164 } });
  try {
    const health = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(health.status, 200, "gueltiger Env-Seed -> Dienst bootet (kein Boot-Refusal)");
    // activeNumberFor(owner) -> die geseedete Nummer ist die aktive Owner-Nummer
    // (status active, tenantId "owner"): Gleichheit beweist alle drei Eigenschaften.
    const state = await (await fetch(`${srv.localUrl}/api/state`)).json();
    assert.equal(state.agent.number, SEED_E164, "geseedete Owner-Nummer ist die aktive Nummer");
    // AC7: die Nummer (PII) darf NIE im Boot-Log stehen - nur Var-Namen/Erwartung.
    assert.ok(!srv.stdout.includes(SEED_E164), "AC7: Owner-Nummer nie im Boot-Log (kein PII-Leak)");
  } finally {
    await srv.stop();
  }
});

// ---- AC4: gueltiger expliziter Provider (telnyx) -> Boot OK ----
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

// ---- AC4: ungueltiger Provider (Tippfehler) -> Boot-Refusal, nennt Var (kein stiller Seed) ----
test("AC4: ungueltiger OWNER_NUMBER_PROVIDER ('twillio') -> Boot-Refusal (exit 1), nennt Var", async () => {
  const { code, output } = await startServerExpectExit({
    ownerNumber: null,
    env: { OWNER_NUMBER_SEED: SEED_E164, OWNER_NUMBER_PROVIDER: "twillio" },
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /OWNER_NUMBER_PROVIDER/, "Diagnose nennt die ungueltige Provider-Var");
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein (kein Falsch-Carrier-Seed)");
});

// ---- AC3: Garbage-Nummer hebelt den Fail-closed-Guard NICHT aus ----
test("AC3: OWNER_NUMBER_SEED ohne gueltiges E.164 ('hallo') -> Boot-Refusal (exit 1), nennt Var", async () => {
  const { code, output } = await startServerExpectExit({
    ownerNumber: null,
    env: { OWNER_NUMBER_SEED: "hallo" },
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /OWNER_NUMBER_SEED/, "Diagnose nennt die ungueltige Seed-Var");
  assert.doesNotMatch(output, /Gateway laeuft/, "kein gruener Boot mit totem Routing");
});

// ---- AC2: leere Env -> fail-closed bleibt (Regression zu boot-failclosed.test.js) ----
test("AC2: leere OWNER_NUMBER_SEED + kein Store-Seed -> Boot-Refusal (fail-closed unveraendert)", async () => {
  const { code, output } = await startServerExpectExit({
    ownerNumber: null,
    env: { OWNER_NUMBER_SEED: "" },
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /Keine aktive Nummer im Store/, "leere Var = kein Seed -> Boot-Guard greift");
  assert.doesNotMatch(output, /Gateway laeuft/);
});

// ---- AC6/AC8: Store gewinnt / kein Doppel-Seed (Idempotenz subsumiert) ----
test("AC6: aktive Store-Owner-Nummer gewinnt -> Env-Seed ist No-Op (kein Doppel-Seed)", async () => {
  // Default ownerNumber (OWNER_TEST_NUMBER) -> Store hat bereits eine aktive Owner-Nummer.
  // Der Env-Seed nennt eine ANDERE Nummer; der Gate (findActiveNumber) macht ihn zum No-Op.
  // Das subsumiert AC8 (Idempotenz): ein zweiter Boot mit demselben Store seedet nie neu.
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
