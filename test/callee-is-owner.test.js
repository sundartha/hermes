// OC (PLAN-OWNER-CALL, PLAN-SECURITY.md Launch-Blocker geloest, Owner-Entscheidung
// 2026-08-21): das Praedikat "Ziel == eigene Nummer des anrufenden Tenants, Besitz
// verifiziert". Drei Bloecke, alle offline und ohne Spawn:
//   A  - calleeIsOwner: der nackte Vergleich, inkl. jedes naheliegenden Beinahe-Treffers
//   A2 - ownerSelfCallGranted: die vollstaendige Bedingung (Schalter + Besitz-Verifikation + Ziel)
//   B  - dieselben drei Konjunktionen bis auf den ANRUF-DATENSATZ (state-ops.createCall)
//
// BLOCK A IST EIN RIEGEL, KEINE Fleissarbeit. Er existiert gegen genau einen kuenftigen
// Umbau: "mach den Vergleich robuster". Praefix-Match, Vergleich der letzten n Ziffern,
// Gross-/Kleinschreibungs-Toleranz und Trim wuerden bewirken, dass FREMDE Nummern als
// eigene durchgehen - und dann heisst das: ein Fremder bekommt einen Anruf OHNE den
// gesetzlich vorgeschriebenen Offenlegungssatz (Absolute Regel 2). Wer eine dieser Zeilen
// gruen bekommen will, indem er den Vergleich lockert, hat den Zweck des Tests verfehlt.
//
// BLOCK A2 "verified false/undefined/truthy-aber-nicht-true" ist der Riegel gegen die
// haeufigste Fehlinterpretation eines Verifikations-Flags: NUR strikt true zaehlt, jeder
// andere Wert (fehlend, "true" als String, 1) heisst NICHT verifiziert - dieselbe Fail-
// closed-Haerte, die vorher die Tenant-Allowlist (OWNER_SELF_CALL_TENANT_IDS, seit
// 2026-08-21 wirkungslos) hatte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calleeIsOwner, ownerSelfCallGranted } from "../src/callee-is-owner.js";
import { createCall } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { seedState } from "./helpers.js";

const OWN = "+491737252163";
const FOREIGN = "+491729999001";
const TENANT = BOOTSTRAP_TENANT_ID; // "owner"

// ---- Block A: calleeIsOwner (nackter Nummern-Vergleich) ----

test("OC-P1-01: to === ownNumber, identische E.164 -> true", () => {
  assert.strictEqual(calleeIsOwner({ to: OWN, ownNumber: OWN }), true);
});

test("OC-P1-02: ownNumber null -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: OWN, ownNumber: null }), false);
});

test("OC-P1-03: ownNumber undefined -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: OWN, ownNumber: undefined }), false);
});

test("OC-P1-04: ownNumber leerer String -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: OWN, ownNumber: "" }), false);
});

test("OC-P1-05: to fehlt (null/undefined/leer), ownNumber gesetzt -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: null, ownNumber: OWN }), false);
  assert.strictEqual(calleeIsOwner({ to: undefined, ownNumber: OWN }), false);
  assert.strictEqual(calleeIsOwner({ to: "", ownNumber: OWN }), false);
});

test("OC-P1-06: beide fehlen (null) -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: null, ownNumber: null }), false);
});

test("OC-P1-07: gleiche Ziffern ohne '+' -> false (kein Praefix-Match)", () => {
  assert.strictEqual(calleeIsOwner({ to: "491737252163", ownNumber: OWN }), false);
});

test("OC-P1-08: nationale Schreibweise gegen E.164 -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: "01737252163", ownNumber: OWN }), false);
});

test("OC-P1-09: gleiche letzten acht Ziffern, anderer Laendercode -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: "+441737252163", ownNumber: OWN }), false);
});

test("OC-P1-10: ein Zeichen Unterschied -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: "+491737252164", ownNumber: OWN }), false);
});

test("OC-P1-11: Leerzeichen am Rand -> false (kein Trim im Praedikat)", () => {
  assert.strictEqual(calleeIsOwner({ to: ` ${OWN}`, ownNumber: OWN }), false);
  assert.strictEqual(calleeIsOwner({ to: `${OWN} `, ownNumber: OWN }), false);
});

test("OC-P1-12: to ist kein String (Zahl/Objekt) -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: 491737252163, ownNumber: OWN }), false);
  assert.strictEqual(calleeIsOwner({ to: {}, ownNumber: OWN }), false);
});

test("OC-P1-13: ownNumber ist kein String (Zahl) -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: OWN, ownNumber: 491737252163 }), false);
});

// ---- Block A2: ownerSelfCallGranted (vollstaendige Bedingung) ----

test("OC-P1-20: enabled true, verified true, Ziel eigene Nummer -> true (strikt Boolean)", () => {
  const result = ownerSelfCallGranted({ to: OWN, ownNumber: OWN, enabled: true, verified: true });
  assert.strictEqual(result, true);
});

test("OC-P1-21: enabled false, sonst wie B1 -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, enabled: false, verified: true }),
    false,
  );
});

test("OC-P1-22: enabled fehlt (undefined) -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, enabled: undefined, verified: true }),
    false,
  );
});

test('OC-P1-23: enabled als String "true" -> false (kein Truthiness-Vergleich)', () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, enabled: "true", verified: true }),
    false,
  );
});

test("OC-P1-24: enabled als truthy Zahl 1 -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, enabled: 1, verified: true }),
    false,
  );
});

test("OC-P1-25: verified fehlt (undefined) -> false (Besitz-Verifikations-Riegel, Nachfolger der Allowlist-Leer-Regel)", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, enabled: true, verified: undefined }),
    false,
  );
});

test("OC-P1-26: verified false -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, enabled: true, verified: false }),
    false,
  );
});

test('OC-P1-27: verified als String "true" -> false (kein Truthiness-Vergleich)', () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, enabled: true, verified: "true" }),
    false,
  );
});

test("OC-P1-28: verified als truthy Zahl 1 -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, enabled: true, verified: 1 }),
    false,
  );
});

test("OC-P1-29: verified null -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, enabled: true, verified: null }),
    false,
  );
});

test("OC-P1-33: enabled true, verified true, Ziel FREMD -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: FOREIGN, ownNumber: OWN, enabled: true, verified: true }),
    false,
  );
});

test("OC-P1-34: Ziel leer/null -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: "", ownNumber: OWN, enabled: true, verified: true }),
    false,
  );
  assert.strictEqual(
    ownerSelfCallGranted({ to: null, ownNumber: OWN, enabled: true, verified: true }),
    false,
  );
});

test("OC-P1-35: ownNumber im Store nicht gesetzt (null) -> false, kein Wurf", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: null, enabled: true, verified: true }),
    false,
  );
});

// ---- Block B: dieselben drei Konjunktionen am Anruf-Datensatz ----

// Ein voller Durchstich fuer EINE Konfiguration: Praedikat auswerten wie in
// routes/api-calls.js, Ergebnis an createCall geben, Feld am Datensatz lesen. EINE
// Stelle fuer den Durchstich (G5), von allen vier Faellen genutzt.
function calleeIsOwnerAmDatensatz({ enabled, verified, to }) {
  const state = seedState({ tenants: [{ id: TENANT, status: "active", privateNumber: OWN }] });
  const call = createCall(state, {
    direction: "outbound",
    from: "+4930111222333",
    to,
    tenantId: TENANT,
    calleeIsOwner: ownerSelfCallGranted({ to, ownNumber: OWN, enabled, verified }),
  });
  return call.calleeIsOwner;
}

test("OC-P1-40: Schalter AUS + Ziel ist die eigene Nummer -> false am Datensatz", () => {
  const wert = calleeIsOwnerAmDatensatz({ enabled: false, verified: true, to: OWN });
  assert.strictEqual(wert, false);
  assert.equal(typeof wert, "boolean", "nie undefined/null - false heisst Offenlegung");
});

test("OC-P1-41: Schalter AN + Ziel ist NICHT die eigene Nummer -> false am Datensatz", () => {
  const wert = calleeIsOwnerAmDatensatz({ enabled: true, verified: true, to: FOREIGN });
  assert.strictEqual(wert, false);
  assert.equal(typeof wert, "boolean");
});

test("OC-P1-42: Schalter AN + NICHT verifiziert + Ziel eigene Nummer -> false am Datensatz", () => {
  const wert = calleeIsOwnerAmDatensatz({ enabled: true, verified: false, to: OWN });
  assert.strictEqual(wert, false);
  assert.equal(typeof wert, "boolean");
});

test("OC-P1-43: Schalter AN + verifiziert + Ziel eigene Nummer -> true am Datensatz", () => {
  const wert = calleeIsOwnerAmDatensatz({ enabled: true, verified: true, to: OWN });
  assert.strictEqual(wert, true);
  assert.equal(typeof wert, "boolean");
});
