// Onboarding-Orchestrierung (provisionNumber): reine State-Machine + injizierter
// Fake-Provisioner (DIP) - kein Netz, kein Server, kein pglite (eigene Datei).
// Prueft die Geld-Sicherheits-Invarianten: active NUR nach erfolgreichem Order
// (Voice-Routing reist im Order-Body, kein separater configure-Schritt mehr);
// Fehler vor dem Kauf -> failed (kein Release). Die Release-/Orphan-Abdeckung NACH
// dem Kauf liegt im Payment-Pfad (billing-hold-capture.test.js, capture-Fehler).
import { test } from "node:test";
import assert from "node:assert/strict";
import { provisionNumber } from "../src/onboarding.js";
import {
  makeDefaultState,
  registerTenant,
  requestNumber,
  findNumber,
} from "../src/store/state-ops.js";
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

test("happy path: search -> order -> active mit e164 + providerNumberId (kein configure)", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner();
  const result = await provisionNumber(s, { provisioner: prov }, { numberId, ...ARGS });
  assert.equal(result.status, NUMBER_STATUS.ACTIVE);
  assert.equal(result.e164, "+4915799990001");
  assert.equal(result.providerNumberId, "num_ext_1");
  assert.deepEqual(prov.log, ["search:DE", `order:+4915799990001:order_${numberId}`]);
  // AM5: kein separater configure-Aufruf mehr (Spy zaehlt 0) - das Voice-Routing reist
  // im Order-Body (connectionId).
  assert.ok(!prov.log.some((l) => l.startsWith("configure")), "kein configure-Aufruf");
  assert.equal(prov.orderCalls.at(-1).connectionId, "conn_1");
  // Aktivierung legt die assignment-Zeile an.
  assert.ok(s.numberAssignments.find((a) => a.numberId === numberId && !a.releasedAt));
});

test("search liefert nichts -> failed, KEIN Order, KEIN Release (kein Geld)", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner({
    async searchNumbers() {
      return [];
    },
  });
  await assert.rejects(
    () => provisionNumber(s, { provisioner: prov }, { numberId, ...ARGS }),
    /keine kaufbare Nummer/,
  );
  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.FAILED);
  assert.ok(!prov.log.includes("release:num_ext_1"));
  assert.equal(s.numberAssignments.length, 0);
});

test("order wirft -> failed, KEIN Release (Kauf nicht zustande gekommen)", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner({
    async orderNumber() {
      throw new Error("HTTP 402");
    },
  });
  await assert.rejects(
    () => provisionNumber(s, { provisioner: prov }, { numberId, ...ARGS }),
    /HTTP 402/,
  );
  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.FAILED);
  assert.ok(!prov.log.some((l) => l.startsWith("release")));
});

// Die Release-/Orphan-Abdeckung NACH dem Kauf wandert in den Payment-Pfad
// (billing-hold-capture.test.js, capture-Fehler -> rollbackAfterOrder): es gibt
// nach AM5 keinen separaten configure-Schritt mehr, an dem es scheitern koennte.
