// F10 Runde 2 (S1) - terminateAndBillCall: die Reihenfolge der Terminierungsschritte ist
// sicherheitskritisch (Absolute Regel Max-Dauer). Der Fehler in Runde 1 (terminateCappedCall
// buchte VOR dem Hangup) blieb von den Integrationstests unentdeckt, weil FAKE_ORIGINATE
// endCall zu einem sofort aufgeloesten No-op macht und die Verzoegerung dadurch unsichtbar
// bleibt. Dieser Test prueft die Reihenfolge daher direkt an der reinen Orchestrierungs-
// funktion (keine Server-Spawn, kein Netz, kein Store) mit injizierten Thunks, die ihre
// Aufrufe in ein Array protokollieren - deterministisch, offline, F.I.R.S.T.
import { test } from "node:test";
import assert from "node:assert/strict";
import { terminateAndBillCall } from "../src/telephony/call-termination.js";

test("hangUp wird VOLLSTAENDIG abgewartet, BEVOR bill (Buchung/Summary/SMS) angestossen wird", async () => {
  const order = [];
  await terminateAndBillCall({
    persistEnd: () => order.push("persistEnd"),
    hangUp: async () => {
      order.push("hangUp-start");
      await new Promise((resolve) => setTimeout(resolve, 10)); // simuliert Provider-Latenz
      order.push("hangUp-end");
    },
    bill: () => order.push("bill-start"),
  });
  assert.deepEqual(
    order,
    ["persistEnd", "hangUp-start", "hangUp-end", "bill-start"],
    "bill darf erst NACH dem vollstaendig abgewarteten hangUp starten - nie davor/parallel",
  );
});

test("bill wird NICHT awaited (fire-and-forget): terminateAndBillCall loest auf, ohne auf das Ende von bill zu warten", async () => {
  const order = [];
  let billResolved = false;
  await terminateAndBillCall({
    persistEnd: () => {},
    hangUp: async () => order.push("hangUp"),
    bill: async () => {
      order.push("bill-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      billResolved = true;
      order.push("bill-end");
    },
  });
  // terminateAndBillCall ist bereits fertig (await oben abgeschlossen), aber die
  // 20ms-Verzoegerung in bill kann noch nicht durchgelaufen sein.
  assert.equal(billResolved, false, "bill laeuft nach der Rueckkehr von terminateAndBillCall noch weiter");
  assert.deepEqual(order, ["hangUp", "bill-start"]);
});

test("hangUp-Fehler wird geschluckt (onHangUpError statt Exception) - bill laeuft trotzdem", async () => {
  const order = [];
  const errors = [];
  await terminateAndBillCall({
    persistEnd: () => order.push("persistEnd"),
    hangUp: async () => {
      throw new Error("provider-timeout");
    },
    bill: () => order.push("bill"),
    onHangUpError: (e) => errors.push(e.message),
  });
  assert.deepEqual(order, ["persistEnd", "bill"], "bill laeuft trotz gescheitertem Hangup (best-effort)");
  assert.deepEqual(errors, ["provider-timeout"]);
});

test("ohne hangUp-Thunk (z.B. fehlender providerCallSid) wird nur persistiert+gebucht, kein Crash", async () => {
  const order = [];
  await terminateAndBillCall({
    persistEnd: () => order.push("persistEnd"),
    hangUp: null,
    bill: () => order.push("bill"),
  });
  assert.deepEqual(order, ["persistEnd", "bill"]);
});
