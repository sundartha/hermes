import { test } from "node:test";
import assert from "node:assert/strict";
import { PUBLIC_ROUTES } from "../src/route-policy.js";
import { APP_PATH } from "../src/portal-paths.js";

const CANCEL_PATTERN = /cancel|kuendig/i;
const CANCEL_INTENT_HASH = "#kuendigen";

test("Kuendigen nur im Kundenbereich: keine oeffentliche Kuendigungs-Route", () => {
  const publicCancel = PUBLIC_ROUTES.filter(({ path }) => CANCEL_PATTERN.test(path));
  assert.deepEqual(
    publicCancel.map(({ method, path }) => `${method} ${path}`),
    [],
    "oeffentliche Kuendigungs-Route ohne Owner-Entscheidung",
  );
});

test("Kuendigen nur im Kundenbereich: der Website-Link fuehrt in die App-Shell", async () => {
  process.env.PUBLIC_GATEWAY_URL ??= "https://gateway.example";
  const routes = await import("../apps/web/src/lib/routes.js");
  assert.equal(
    routes.CANCEL_URL,
    `${process.env.PUBLIC_GATEWAY_URL}${APP_PATH}${CANCEL_INTENT_HASH}`,
  );
  assert.equal(routes.CANCELLATION_URL, undefined, "Formular-Ziel ist zurueck");
});
