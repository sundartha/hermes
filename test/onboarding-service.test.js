// Onboarding-Orchestrierung (provisionNumber): reine State-Machine + injizierter
// Fake-Provisioner (DIP) - kein Netz, kein Server, kein pglite (eigene Datei).
// Prueft die Geld-Sicherheits-Invarianten: active NUR nach Order+Configure;
// Fehler vor dem Kauf -> failed (kein Release); Configure-Fehler nach dem Kauf ->
// Provider-Release + failed (kein bezahlter Orphan).
import { test } from "node:test";
import assert from "node:assert/strict";
import { provisionNumber } from "../src/onboarding.js";
import { makeDefaultState, registerTenant, requestNumber, findNumber } from "../src/store/state-ops.js";
import { NUMBER_STATUS } from "../src/store/defaults.js";
import { fakeProvisioner } from "./helpers.js";

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
const ARGS = { countryCode: "DE", connectionId: "conn_1" };

function seedRequested() {
  const s = makeDefaultState();
  registerTenant(s, "t_user1");
  const { number } = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  return { s, numberId: number.id };
}

test("happy path: search -> order -> configure -> active mit e164 + providerNumberId", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner();
  const result = await provisionNumber(s, { provisioner: prov }, { numberId, ...ARGS });
  assert.equal(result.status, NUMBER_STATUS.ACTIVE);
  assert.equal(result.e164, "+4915799990001");
  assert.equal(result.providerNumberId, "num_ext_1");
  assert.deepEqual(prov.log, ["search", `order:+4915799990001:order_${numberId}`, "configure:num_ext_1:conn_1"]);
  // Aktivierung legt die assignment-Zeile an.
  assert.ok(s.numberAssignments.find((a) => a.numberId === numberId && !a.releasedAt));
});

test("search liefert nichts -> failed, KEIN Order, KEIN Release (kein Geld)", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner({ async searchNumbers() { return []; } });
  await assert.rejects(() => provisionNumber(s, { provisioner: prov }, { numberId, ...ARGS }), /keine kaufbare Nummer/);
  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.FAILED);
  assert.ok(!prov.log.includes("release:num_ext_1"));
  assert.equal(s.numberAssignments.length, 0);
});

test("order wirft -> failed, KEIN Release (Kauf nicht zustande gekommen)", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner({ async orderNumber() { throw new Error("HTTP 402"); } });
  await assert.rejects(() => provisionNumber(s, { provisioner: prov }, { numberId, ...ARGS }), /HTTP 402/);
  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.FAILED);
  assert.ok(!prov.log.some((l) => l.startsWith("release")));
});

test("configure wirft nach dem Kauf -> Provider-Release + released (kein bezahlter Orphan)", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner({ async configureNumber() { throw new Error("HTTP 500"); } });
  await assert.rejects(() => provisionNumber(s, { provisioner: prov }, { numberId, ...ARGS }), /HTTP 500/);
  // Provider-Release sauber -> Datensatz terminal released, NIE active.
  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.RELEASED);
  assert.ok(prov.log.includes("release:num_ext_1"), "gekaufte Nummer wird beim Provider freigegeben");
});

test("Configure- UND Release-Fehler -> bleibt 'failed' (Orphan-Reconciliation), Configure-Fehler wird geworfen", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner({
    async configureNumber() { throw new Error("configure kaputt"); },
    async releaseNumber() { throw new Error("release auch kaputt"); },
  });
  await assert.rejects(() => provisionNumber(s, { provisioner: prov }, { numberId, ...ARGS }), /configure kaputt/);
  // Provider-Release fehlgeschlagen -> moeglicher Orphan -> Zustand bleibt failed.
  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.FAILED);
});
