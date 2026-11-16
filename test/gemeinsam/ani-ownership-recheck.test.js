import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAniOwnershipRecheck } from "../../src/telephony/ani-ownership-recheck.js";

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

const ANI_TREFFER = { e164: ANI, status: "active" };
const BESITZ_TABELLE = [
  [null, true],
  [undefined, true],
  [0, true],
  [{}, true],
  [{ treffer: null }, true],
  [{ treffer: 0 }, true],
  [{ treffer: "" }, true],
  [{ treffer: [] }, true],
  [{ treffer: [{ e164: "+49222", status: "active" }] }, true],
  [{ treffer: [{ e164: ANI, status: "released" }] }, true],
  [{ treffer: [ANI_TREFFER] }, false],
  [{ treffer: [{ e164: "+49222", status: "active" }, ANI_TREFFER] }, false],
];

for (const [antwort, verloren] of BESITZ_TABELLE) {
  test(`ANI-Nachmessung: Anbieterantwort ${JSON.stringify(antwort)} ergibt Verlust=${verloren}`, async () => {
    const recheck = makeAniOwnershipRecheck({ telnyxRead: { findPhoneNumber: async () => antwort } });
    assert.equal(await recheck(ANI), verloren);
  });
}
