// OUTBOUND-E1, Review-Blocker Runde 3: rollbackAfterOrder (src/onboarding.js) ist der
// ZWEITE Aufrufer des irreversiblen Provider-DELETE (provisioner.releaseNumber), neben
// release-reconcile.js/performNumberRelease. Diese Datei prueft den davor gesetzten
// numberBusyReason-Recheck (EINE Regel-Quelle mit Ebene A/B, G5): trifft der Capture-
// Fehlerpfad zufaellig eine e164, die eine offene Plattform-Bindung traegt, darf der
// Provider-DELETE nicht starten - Positiv-Kontrolle (Repo-Lehre "Pruefkommando ohne
// Positiv-Kontrolle") zeigt zusaetzlich, dass eine NICHT gebundene e164 weiterhin normal
// freigegeben wird.
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
  bindPlatformNumber,
} from "../src/store/state-ops.js";
import { NUMBER_STATUS } from "../src/store/defaults.js";

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
const ARGS = { countryCode: "DE", connectionId: "conn_1", holdAmountCents: 500, currency: "eur" };
// Fiktive E.164 im Bestandsstil (PII-Regel Runde 3) - fakeProvisioner.orderNumber liefert
// per Default IMMER "+4915799990001"; hier zusaetzlich per Override eine zweite,
// erkennbar fiktive Nummer, damit die gebundene und die ungebundene e164 klar auseinander
// gehalten werden.
const BOUND_E164 = "+4915799990002";

function seedRequested() {
  const state = makeDefaultState();
  registerTenant(state, "t_user1");
  setTenantStripe(state, "t_user1", { customerId: "cus_1", paymentMethodId: "pm_1" });
  const { number } = requestNumber(state, { tenantId: "t_user1", ...CAPS });
  return { state, numberId: number.id };
}

test("Capture wirft + gekaufte e164 ist plattform-gebunden -> KEIN Provider-DELETE, KEIN releaseNumber, Status bleibt failed", async () => {
  const { state, numberId } = seedRequested();
  // die Plattform-Bindung liegt VOR dem Kauf schon auf der e164, die der Fake-Provisioner
  // gleich als "neu gekauft" zurueckliefern wird - das ist der Fall, den der Recheck faengt.
  bindPlatformNumber(state, { e164: BOUND_E164, purpose: "outbound_ani", provider: "telnyx" });
  const prov = fakeProvisioner({
    async orderNumber() {
      return { e164: BOUND_E164, providerNumberId: "num_ext_bound" };
    },
  });
  const billing = fakeBilling({
    async captureHold() {
      throw new Error("Stripe captureHold fehlgeschlagen: HTTP 500");
    },
  });
  const logs = [];
  const logger = { warn: (msg) => logs.push(msg) };
  await assert.rejects(
    () => provisionNumber(state, { provisioner: prov, billing, logger }, { numberId, ...ARGS }),
    /HTTP 500/,
  );

  // Kein Provider-DELETE: der irreversible Schritt startet gar nicht.
  assert.ok(
    !prov.log.some((line) => line.startsWith("release")),
    "kein Provider-Release bei Plattform-Bindung",
  );
  // Kein Store-Release: die Nummer bleibt failed statt released (Orphan, kein Datenverlust).
  assert.equal(findNumber(state, numberId).status, NUMBER_STATUS.FAILED);
  // Hold wird trotzdem freigegeben - Geld-Sicherheit bleibt unberuehrt vom Bindungs-Riegel.
  assert.ok(billing.log.some((entry) => entry[0] === "cancelHold"), "Hold wird freigegeben");
  assert.ok(
    logs.some((msg) => msg.includes("uebersprungen") && msg.includes("Plattform-Bindung")),
    "HOLD wird sichtbar geloggt statt still zu verschwinden",
  );
});

test("Positiv-Kontrolle: Capture wirft + gekaufte e164 ist NICHT gebunden -> Provider-Release + releaseNumber laufen normal", async () => {
  const { state, numberId } = seedRequested();
  const prov = fakeProvisioner();
  const billing = fakeBilling({
    async captureHold() {
      throw new Error("Stripe captureHold fehlgeschlagen: HTTP 500");
    },
  });
  await assert.rejects(
    () => provisionNumber(state, { provisioner: prov, billing }, { numberId, ...ARGS }),
    /HTTP 500/,
  );

  assert.ok(prov.log.includes("release:num_ext_1"), "ungebundene Nummer wird normal freigegeben");
  assert.equal(findNumber(state, numberId).status, NUMBER_STATUS.RELEASED);
});
