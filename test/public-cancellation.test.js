// Kuendigen NUR im Kundenbereich (§ 312k BGB, Owner-Entscheidung 2026-10-01).
//
// Am 2026-10-01 lief kurz ein oeffentliches Kuendigungsformular ohne Anmeldung
// (POST /api/cancellation). Der Owner hat es wieder entfernt: ohne Anmeldung koennte
// jeder mit fremdem Namen und fremder Email einen Vertrag kuendigen. Gekuendigt wird
// seitdem nur eingeloggt im Dashboard (POST /api/self-service/billing/cancel, hinter
// webAuthMw, test/312k-p3-self-service-cancel.test.js); jeder Link "Verträge kündigen"
// der Website fuehrt direkt dorthin. Diese Datei haelt beides fest - eine neue
// oeffentliche Kuendigungs-Route braucht eine neue Owner-Entscheidung.
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
