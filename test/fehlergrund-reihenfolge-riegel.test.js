// OUTBOUND-E3a (Befund C1, REIHENFOLGE-RIEGEL): der Nutzertext ab dieser Etappe HAENGT an
// der Invariante "der Grund wird geschrieben, BEVOR der Anruf beendet/abgerechnet wird".
// Der Bestandstest (test/anrufstart-ablehnung-grund.test.js) baute die Produktionsreihenfolge
// im TEST selbst nach - ein Test, der die echte Reihenfolge im Produktionscode nicht pruefte
// (Clean-Code-Befund E2-B, Safety-Befund C1: bei vertauschter Reihenfolge im echten Code
// blieb er GRUEN).
//
// Dieser Test prueft stattdessen die Invariante als STRUKTUR: der Grund wird INNERHALB des
// persistEnd-Thunks geschrieben (endFailedCallWithReason, src/routes/api-calls.js), und
// persistEnd laeuft in terminateAndBillCall garantiert VOR bill() (src/telephony/
// call-termination.js). Drei Faelle, deterministisch, kein Spawn, kein Netz:
//   1. Mechanismus-Pin (Positiv-Kontrolle): persistEnd laeuft vor bill().
//   2. Der Produktions-Thunk schreibt den Grund VOR dem Endstatus (Laufzeit).
//   3. SABOTAGE-FANG: der Schreibweg ist als persistEnd verdrahtet, nicht als freie
//      Anweisung im catch (Quelltext-Assertion - HTTP kann diese Frage nicht entscheiden,
//      s. Plan-Abschnitt 2.4).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { terminateAndBillCall } from "../src/telephony/call-termination.js";
import { endFailedCallWithReason } from "../src/routes/api-calls.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_CALLS_SRC = fs.readFileSync(path.join(ROOT, "src/routes/api-calls.js"), "utf8");
const PROVIDER_STATUS_403 = 403;

test("persistEnd laeuft vor bill (Mechanismus-Pin, Positiv-Kontrolle)", async () => {
  const order = [];
  await terminateAndBillCall({
    persistEnd: () => order.push("persist"),
    hangUp: null,
    bill: () => order.push("bill"),
  });
  assert.deepEqual(order, ["persist", "bill"]);
});

test("der Produktions-Thunk schreibt den Grund VOR dem Endstatus", () => {
  const seen = [];
  const store = {
    recordFailureReason: (id, reason) => seen.push(`reason:${reason}`),
    endCallRecord: (id, status) => seen.push(`end:${status}`),
  };
  endFailedCallWithReason(store, "call_x", PROVIDER_STATUS_403)();
  assert.deepEqual(seen, ["reason:not-placed:start-403", "end:failed"]);
});

test("SABOTAGE-FANG: der Schreibweg ist als persistEnd verdrahtet, nicht als freie Anweisung im catch", () => {
  // Positiv-Kontrolle zuerst (Lehre pruefkommando-ohne-positiv-kontrolle): das Muster
  // muss ueberhaupt vorkommen, sonst beweist ein spaeteres "0 Treffer" nichts.
  assert.match(API_CALLS_SRC, /function endFailedCallWithReason\(/);
  // (a) der Schreibweg ist als persistEnd verdrahtet - nicht als freie Anweisung im catch.
  assert.match(
    API_CALLS_SRC,
    /persistEnd: endFailedCallWithReason\(store, call\.id, providerStatus\)/,
  );
  // (b) recordFailureReason kommt in dieser Datei GENAU EINMAL vor: im Thunk. Ein zweites
  // Vorkommen ausserhalb des Thunks waere genau die verschiebbare Anweisung, die C1 belegt.
  const recordCalls = API_CALLS_SRC.match(/store\.recordFailureReason\(/g) || [];
  assert.equal(recordCalls.length, 1);
});
