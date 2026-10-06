import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, startServerExpectExit, seedCall, seedState } from "./helpers.js";
import { healBootstrapStore } from "../src/boot.js";
import { BOOTSTRAP_HEAL } from "../src/boot-guard.js";

const BOOTSTRAP_ENV = Object.freeze({
  BOOTSTRAP_E164: "+15005550006",
  BOOTSTRAP_PROVIDER: "telnyx",
});

const E164_LOG_LEAK = /\+1500/;

const JSON_SEED_E164 = "+491701234567";

test("leerer Store + gesetzte Deploy-Parameter: der Boot heilt sich selbst (kein preDeploy noetig)", async () => {
  const srv = await startServer({ ownerNumber: null, env: BOOTSTRAP_ENV });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200, "nach der Heilung muss der Dienst normal laufen");
    assert.match(srv.stdout, /\[bootstrap-heal\] Leerer Store .* geheilt/);
    assert.match(srv.stdout, /\[audit\] bootstrap_store_geheilt/);
    assert.doesNotMatch(srv.stdout, E164_LOG_LEAK, "die Bootstrap-Nummer darf nie im Log stehen");
  } finally {
    await srv.stop();
  }
});

test("die Heilung laeuft genau einmal: ein zweiter Boot auf derselben Ablage schweigt", async () => {
  const first = await startServer({ ownerNumber: null, env: BOOTSTRAP_ENV });
  const dataDir = first.dataDir;
  await first.stop();

  const second = await startServer({ dataDir, env: BOOTSTRAP_ENV });
  try {
    const res = await fetch(`${second.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(second.stdout, /\[bootstrap-heal\]/, "zweiter Boot darf nichts mehr tun");
  } finally {
    await second.stop();
  }
});

test("gelebter Store ohne aktive Nummer wird NICHT geheilt (Proliferations-Schutz)", async () => {
  const { code, output } = await startServerExpectExit({
    seed: seedState({ calls: [seedCall()] }),
    ownerNumber: null,
    env: BOOTSTRAP_ENV,
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /Proliferations-Schutz/);
  assert.match(output, /Keine aktive Nummer im Store/, "der Bestands-Refusal bleibt die Exit-Stelle");
  assert.doesNotMatch(output, /geheilt/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("nicht ladbarer Store wird nie geheilt (Bestandspfad bleibt fail-closed)", async () => {
  const { code, output } = await startServerExpectExit({ rawStore: "{ this is not json" });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.doesNotMatch(output, /geheilt/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("healBootstrapStore reicht einen Store-Ladefehler hoch und schreibt nichts", async () => {
  let bootstrapCalls = 0;
  const store = {
    load() {
      throw new Error("Store nicht ladbar");
    },
    bootstrapTenant() {
      bootstrapCalls += 1;
    },
  };
  const config = { provisioning: { bootstrapE164: "+15005550006", bootstrapProvider: "telnyx" } };
  await assert.rejects(
    () => healBootstrapStore({ config, store, messaging: () => ({}) }),
    /Store nicht ladbar/,
  );
  assert.equal(bootstrapCalls, 0, "ohne lesbaren Store darf NIE geschrieben werden");
});

test("OWNER_NUMBER_SEED gewinnt gegen die Heilung (kein Doppel-Seed)", async () => {
  const srv = await startServer({
    ownerNumber: null,
    env: { ...BOOTSTRAP_ENV, OWNER_NUMBER_SEED: JSON_SEED_E164, OWNER_NUMBER_PROVIDER: "telnyx" },
  });
  try {
    const state = await (await fetch(`${srv.localUrl}/api/state`)).json();
    assert.equal(state.agent.number, JSON_SEED_E164, "der json-Seed war schneller");
    assert.doesNotMatch(srv.stdout, /\[bootstrap-heal\]/, "die Heilung darf gar nicht erst laufen");
  } finally {
    await srv.stop();
  }
});

test("BOOTSTRAP_HEAL-Ausgaenge sind eine geschlossene, unveraenderliche Menge", () => {
  assert.deepEqual(Object.values(BOOTSTRAP_HEAL).sort(), [
    "blocked_params",
    "blocked_store_not_fresh",
    "heal",
    "not_needed",
  ]);
  assert.ok(Object.isFrozen(BOOTSTRAP_HEAL));
});
