// OUTBOUND-E4 Review-Blocker (BLOCKER 1 / G9/C2): makeAniOwnershipRecheck ist die LIVE-
// Nachmessung, die server.js in den ANI-Riegel injiziert (s. test/ausfall-server-wiring.test.js
// fuer den Quelltext-Wiring-Beleg). Der Gate-Vertrag selbst (fail-open, Fristen) ist in
// test/outbound-ani-gate.test.js gepinnt - dieser Test deckt NUR die Nachmessung selbst.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAniOwnershipRecheck } from "../src/telephony/ani-ownership-recheck.js";

const ANI = "+15739090177";

test("ANI-Nachmessung: R-1 Konto besitzt die Nummer (aktiver Treffer) -> false", async () => {
  const recheck = makeAniOwnershipRecheck({ telnyxRead: { findPhoneNumber: async () => ({ treffer: [{ e164: ANI, status: "active" }] }) } });
  assert.equal(await recheck(ANI), false);
});

test("ANI-Nachmessung: R-2 Konto besitzt die Nummer NICHT (leere Treffer) -> true (Verlust bestaetigt)", async () => {
  const recheck = makeAniOwnershipRecheck({ telnyxRead: { findPhoneNumber: async () => ({ treffer: [] }) } });
  assert.equal(await recheck(ANI), true);
});

test("ANI-Nachmessung: R-3 leere e164 -> null (kein Anbieter-Zugriff)", async () => {
  let aufrufe = 0;
  const recheck = makeAniOwnershipRecheck({ telnyxRead: { findPhoneNumber: async () => { aufrufe += 1; return { treffer: [] }; } } });
  assert.equal(await recheck(""), null);
  assert.equal(aufrufe, 0, "eine leere e164 darf NIE einen GET ausloesen");
});

test("ANI-Nachmessung: R-4 der Anbieter wirft -> die Nachmessung wirft weiter (Fail-open ist Sache des Gates, nicht dieses Moduls)", async () => {
  const recheck = makeAniOwnershipRecheck({
    telnyxRead: { findPhoneNumber: async () => { throw new Error("netz"); } },
  });
  await assert.rejects(() => recheck(ANI));
});

test("ANI-Nachmessung: R-5 ueberschreitet den Timeout -> wirft (TimeoutError), loest NICHT auf null von selbst", async () => {
  const KURZER_TIMEOUT_MS = 5;
  const LANGSAME_ANTWORT_MS = 200;
  const recheck = makeAniOwnershipRecheck({
    telnyxRead: { findPhoneNumber: () => new Promise((resolve) => setTimeout(() => resolve({ treffer: [] }), LANGSAME_ANTWORT_MS)) },
    timeoutMs: KURZER_TIMEOUT_MS,
  });
  await assert.rejects(() => recheck(ANI), /Timeout/);
});
