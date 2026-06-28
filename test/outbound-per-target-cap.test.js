// outbound-p1d: per-(Tenant,Ziel)-Wiederhol-Cap. 3 Calls aufs selbe Ziel passieren das
// Gate (enden am Offline-Originate als 500, jeder persistiert einen Outbound-Record),
// der 4. wird VOR dem Dial mit 429 grund=ziel_limit gesperrt. Ein ANDERES Ziel ist
// unberuehrt (ziel-isoliert). Reiner Spawn (startServer + ensureOwnerNumber-Seed), KEIN
// pglite (Lehre p6a-Stall). Owner-Pfad (keine Identitaet, MULTI_TENANT default aus): der
// Owner passiert KYC/Identitaet/Nummer/Budget/Allowlist (Boot-Seed id_verified, Pfad 2)
// und erreicht den Offline-Originate -> 500 (= alle Gates passiert), wie w5-abo-allowlist-
// gate.test.js / kyc-gate-outbound.test.js. Die per-(Tenant,Ziel)-Isolation auf ops-Ebene
// (pg-Spiegel) deckt store-pg-tenant-budget.test.js ab; hier der HTTP-Gate-Pfad (json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const TARGET_A = "+4915112345678"; // DE-Mobil, kein Premium-/Denylist-Prefix
const TARGET_B = "+4915187654321"; // anderes Ziel (eigener Zaehler)

const postCall = (url, to) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Termin vereinbaren" }),
  });

test("per-Target-Cap: 3x dasselbe Ziel ok, 4. -> 429; anderes Ziel frei", async (t) => {
  const srv = await startServer({
    env: { ALLOWED_COUNTRY_CODES: "*", PER_TARGET_CALL_CAP: "3" },
  });
  try {
    for (let i = 1; i <= 3; i++) {
      const res = await postCall(srv.localUrl, TARGET_A);
      assert.equal(res.status, 500, `Call ${i} passiert das Gate (Originate-Offline -> 500)`);
    }
    await t.test("4. Call aufs selbe Ziel -> 429 grund=ziel_limit", async () => {
      const res = await postCall(srv.localUrl, TARGET_A);
      assert.equal(res.status, 429, "Cap (3) erreicht -> 429 VOR Dial");
      assert.match((await res.json()).error, /Wiederhol-Limit/, "per-Target-Fehlertext");
    });
    await t.test("anderes Ziel unberuehrt -> passiert (500)", async () => {
      const res = await postCall(srv.localUrl, TARGET_B);
      assert.equal(res.status, 500, "anderes Ziel hat eigenen Zaehler");
    });
  } finally {
    await srv.stop();
  }
});
