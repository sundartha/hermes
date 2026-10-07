import { test } from "node:test";
import assert from "node:assert/strict";
import { findPlan } from "../../src/plans.js";
import { startServer, externalIp } from "../helpers.js";

const EXTERNAL_IP = externalIp();
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const KATALOG_SLUGS = ["starter", "business"];
const STARTER_PREIS_CENT = 499;
const BUSINESS_PREIS_CENT = 999;
const KATALOG_PREISE_CENT = [STARTER_PREIS_CENT, BUSINESS_PREIS_CENT];

test("S3: findPlan(bekannt) -> Katalog-Objekt", () => {
  assert.equal(findPlan("starter")?.slug, "starter");
  assert.equal(findPlan("business")?.slug, "business");
});

test("S3: findPlan(unbekannt/leer/undefined) -> null (Null-Zweig)", () => {
  assert.equal(findPlan("nope"), null);
  assert.equal(findPlan(""), null);
  assert.equal(findPlan(undefined), null);
});

test("GET /api/plans liefert den Spec-Katalog (oeffentlich, ohne Login)", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/api/plans`);
    assert.equal(res.status, HTTP_OK);
    const plans = await res.json();
    assert.ok(Array.isArray(plans), "Antwort ist kein Array");
    assert.equal(plans.length, KATALOG_SLUGS.length);
    assert.deepEqual(
      plans.map((plan) => plan.slug),
      KATALOG_SLUGS,
    );
    assert.deepEqual(
      plans.map((plan) => plan.amountCents),
      KATALOG_PREISE_CENT,
    );
    for (const plan of plans) assert.equal(plan.currency, "eur");
  } finally {
    await srv.stop();
  }
});

test(
  "/api/plans ist ohne Sitzung erreichbar, /api/state nicht (extern ohne Creds)",
  { skip: !EXTERNAL_IP && "keine externe Interface-IP" },
  async (kontext) => {
    const srv = await startServer({ env: { DASHBOARD_PASSWORD: "s3cret" } });
    try {
      await kontext.test("extern ohne Creds: /api/plans -> 200", async () => {
        const res = await fetch(`${srv.externalUrl}/api/plans`);
        assert.equal(res.status, HTTP_OK);
        assert.equal((await res.json()).length, KATALOG_SLUGS.length);
      });

      await kontext.test("extern ohne Creds: /api/state -> 403 (Kontrast, internalOnly)", async () => {
        const res = await fetch(`${srv.externalUrl}/api/state`);
        assert.equal(res.status, HTTP_FORBIDDEN);
      });
    } finally {
      await srv.stop();
    }
  },
);
