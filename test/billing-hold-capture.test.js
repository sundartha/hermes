// Payment-Pfad (P6b1): provisionNumber mit injiziertem Fake-Provisioner UND
// Fake-Billing (DIP) - kein Netz, kein Server, kein pglite (eigene Datei gegen
// Worker-Stall, Lehre P6a). Prueft die Geld-Sicherheits-Invarianten der
// Hold/Capture-Mechanik: Hold VOR Order; Capture NACH Order, VOR active;
// kein active ohne Capture; Rollback (releaseNumber + cancelHold) in allen
// Fehlerkanten inkl. Orphan-Log bei fehlgeschlagenem Release (AM5/GAP-2);
// payment-off (kein billing) byte-identisch ohne capturing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { provisionNumber } from "../src/onboarding.js";
import { fakeBilling, fakeProvisioner } from "./helpers.js";
import {
  makeDefaultState,
  registerTenant,
  requestNumber,
  findNumber,
  setTenantStripe,
} from "../src/store/state-ops.js";
import { NUMBER_STATUS } from "../src/store/defaults.js";

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
const ARGS = { countryCode: "DE", connectionId: "conn_1", holdAmountCents: 500, currency: "eur" };

// seedet einen aktiven Tenant MIT hinterlegter Karte (Pay2: ohne Karte ist der
// billing-Pfad fail-closed). cardless=true laesst die Karte bewusst weg (Fail-closed-Test).
function seedRequested({ cardless = false } = {}) {
  const s = makeDefaultState();
  registerTenant(s, "t_user1");
  if (!cardless) setTenantStripe(s, "t_user1", { customerId: "cus_1", paymentMethodId: "pm_1" });
  const { number } = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  return { s, numberId: number.id };
}

// Hilfsnamen fuer die billing.log-Eintraege (kein Magic-String verstreut).
const methodsOf = (billing) => billing.log.map((entry) => entry[0]);

test("happy path: Hold vor Order, Capture nach Configure, active mit paymentIntentId", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner();
  const billing = fakeBilling();
  const result = await provisionNumber(s, { provisioner: prov, billing }, { numberId, ...ARGS });

  assert.equal(result.status, NUMBER_STATUS.ACTIVE);
  assert.equal(result.e164, "+4915799990001");
  assert.equal(result.providerNumberId, "num_ext_1");
  assert.equal(result.paymentIntentId, "pi_fake_1", "PI auf der Nummer hinterlegt");
  // Hold zuerst, dann der Provider-Kauf, dann Capture (Reihenfolge ueber beide Logs).
  assert.deepEqual(prov.log, ["search:DE", `order:+4915799990001:order_${numberId}`]);
  assert.deepEqual(methodsOf(billing), ["placeHold", "captureHold"]);
  // placeHold-Args: idempotencyKey number-id-basiert + Betrag/Currency.
  const [, holdArgs] = billing.log[0];
  assert.equal(holdArgs.idempotencyKey, `hold_${numberId}`);
  assert.equal(holdArgs.amountCents, 500);
  assert.equal(holdArgs.currency, "eur");
  // captureHold-Args: PI + Betrag.
  assert.deepEqual(billing.log[1], ["captureHold", "pi_fake_1", 500]);
});

test("Hold vor Order: placeHold wirft -> failed, KEIN Provider-Call, KEIN cancelHold", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner();
  const billing = fakeBilling({
    async placeHold() {
      throw new Error("Stripe placeHold fehlgeschlagen: HTTP 402");
    },
  });
  await assert.rejects(
    () => provisionNumber(s, { provisioner: prov, billing }, { numberId, ...ARGS }),
    /HTTP 402/,
  );

  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.FAILED);
  assert.deepEqual(prov.log, [], "kein Provider-Call ohne reserviertes Geld");
  assert.ok(!methodsOf(billing).includes("cancelHold"), "nichts gehalten -> kein cancelHold");
});

test("kein active ohne Capture: captureHold wirft -> failed/released, releaseNumber + cancelHold, NIE active", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner();
  const billing = fakeBilling({
    async captureHold() {
      throw new Error("Stripe captureHold fehlgeschlagen: HTTP 500");
    },
  });
  await assert.rejects(
    () => provisionNumber(s, { provisioner: prov, billing }, { numberId, ...ARGS }),
    /HTTP 500/,
  );

  // Provider-Release sauber -> terminal released, NIE active.
  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.RELEASED);
  assert.ok(prov.log.includes("release:num_ext_1"), "gekaufte Nummer wird freigegeben");
  assert.ok(methodsOf(billing).includes("cancelHold"), "Hold wird freigegeben");
});

test("Rollback order/search-Fehler: failed, cancelHold, KEIN releaseNumber (nichts gekauft)", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner({
    async orderNumber() {
      throw new Error("HTTP 402");
    },
  });
  const billing = fakeBilling();
  await assert.rejects(
    () => provisionNumber(s, { provisioner: prov, billing }, { numberId, ...ARGS }),
    /HTTP 402/,
  );

  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.FAILED);
  assert.ok(!prov.log.some((l) => l.startsWith("release")), "kein Release, da nichts gekauft");
  assert.deepEqual(
    methodsOf(billing),
    ["placeHold", "cancelHold"],
    "Hold gehalten + wieder freigegeben",
  );
});

test("AM5/GAP-2 Orphan-Log: captureHold + releaseNumber werfen -> failed, logger.warn 'Orphan', kein Secret-Leak", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner({
    async releaseNumber() {
      throw new Error("Telnyx releaseNumber fehlgeschlagen: HTTP 500");
    },
  });
  const billing = fakeBilling({
    async captureHold() {
      throw new Error("Stripe captureHold fehlgeschlagen: HTTP 500");
    },
  });
  const logs = [];
  const logger = { warn: (m) => logs.push(m) };
  await assert.rejects(
    () => provisionNumber(s, { provisioner: prov, billing, logger }, { numberId, ...ARGS }),
    /Stripe captureHold/,
  );

  // Provider-Release fehlgeschlagen -> bezahlter Orphan -> Zustand bleibt failed (NICHT released).
  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.FAILED);
  // GAP-2: der Orphan wird geloggt (sichtbar fuers Reconcile-Runbook), nicht still geschluckt.
  assert.ok(
    logs.some((m) => m.includes("Orphan")),
    "Orphan-Warnung geloggt",
  );
  // Regel 4: die Meldung traegt NIE Stripe-Ids oder einen API-Key.
  const joined = logs.join(" ");
  assert.ok(!joined.includes("cus_") && !joined.includes("pm_"), "kein Stripe-Id-Leak");
});

test("Rollback verschluckt cancelHold-Fehler: Aufrufer-Fehler bleibt, Zustand released", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner();
  // captureHold wirft (Geld-Einzug scheitert) UND cancelHold wirft -> der cancelHold-Fehler
  // darf den captureHold-Fehler NICHT maskieren (Best-Effort-Rollback). Provider-Release ok.
  const billing = fakeBilling({
    async captureHold() {
      throw new Error("capture kaputt");
    },
    async cancelHold() {
      throw new Error("cancel auch kaputt");
    },
  });
  await assert.rejects(
    () => provisionNumber(s, { provisioner: prov, billing }, { numberId, ...ARGS }),
    /capture kaputt/,
  );
  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.RELEASED);
});

test("payment-off-Parity: ohne billing -> kein Hold/Capture, requested->provisioning->active", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner();
  // deps ohne billing: byte-identisch zum Bestand (kein capturing, kein PI).
  const result = await provisionNumber(s, { provisioner: prov }, { numberId, ...ARGS });

  assert.equal(result.status, NUMBER_STATUS.ACTIVE);
  assert.equal(result.paymentIntentId, null, "kein PI ohne billing");
  assert.deepEqual(prov.log, ["search:DE", `order:+4915799990001:order_${numberId}`]);
});

test("Pay2 fail-closed: billing + Tenant OHNE Karte -> failed, KEIN placeHold, KEIN Provider-Call", async () => {
  const { s, numberId } = seedRequested({ cardless: true });
  const prov = fakeProvisioner();
  const billing = fakeBilling();
  await assert.rejects(
    () => provisionNumber(s, { provisioner: prov, billing }, { numberId, ...ARGS }),
    /kein hinterlegtes Zahlungsmittel/,
  );
  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.FAILED);
  assert.deepEqual(methodsOf(billing), [], "kein placeHold ohne Karte");
  assert.deepEqual(prov.log, [], "kein Provider-Call ohne reserviertes Geld");
});

test("Pay2 durchreichen: billing + Tenant MIT Karte -> placeHold bekommt customerId + paymentMethodId, aktiv", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner();
  const billing = fakeBilling();
  const result = await provisionNumber(s, { provisioner: prov, billing }, { numberId, ...ARGS });
  assert.equal(result.status, NUMBER_STATUS.ACTIVE);
  const [, holdArgs] = billing.log[0]; // ["placeHold", args]
  assert.equal(holdArgs.customerId, "cus_1");
  assert.equal(holdArgs.paymentMethodId, "pm_1");
});
