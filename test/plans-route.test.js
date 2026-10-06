import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, externalIp } from "./helpers.js";

const EXTERNAL_IP = externalIp();

test("GET /api/plans liefert den Spec-Katalog (oeffentlich, ohne Login)", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/api/plans`);
    assert.equal(res.status, 200);
    const plans = await res.json();
    assert.ok(Array.isArray(plans), "Antwort ist kein Array");
    assert.equal(plans.length, 2);
    assert.deepEqual(
      plans.map((p) => p.slug),
      ["starter", "business"],
    );
    assert.deepEqual(
      plans.map((p) => p.amountCents),
      [499, 999],
    );
    for (const plan of plans) assert.equal(plan.currency, "eur");
  } finally {
    await srv.stop();
  }
});

test(
  "/api/plans ist ohne Sitzung erreichbar, /api/state nicht (extern ohne Creds)",
  { skip: !EXTERNAL_IP && "keine externe Interface-IP" },
  async (t) => {
    const srv = await startServer({ env: { DASHBOARD_PASSWORD: "s3cret" } });
    try {
      await t.test("extern ohne Creds: /api/plans -> 200", async () => {
        const res = await fetch(`${srv.externalUrl}/api/plans`);
        assert.equal(res.status, 200);
        assert.equal((await res.json()).length, 2);
      });

      await t.test("extern ohne Creds: /api/state -> 403 (Kontrast, internalOnly)", async () => {
        const res = await fetch(`${srv.externalUrl}/api/state`);
        assert.equal(res.status, 403);
      });
    } finally {
      await srv.stop();
    }
  },
);
