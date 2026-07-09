// Phase A (PLAN-VOUCHER-SETUP-FEE-GAP.md): Einrichtungsgebuehr in tenant.html. Wie
// test/fixc-number-status-visibility.test.js hat tenant.html keinen JS-Ausfuehrungs-
// Harness fuer diese Stelle - Inhalts-Assertion auf dem committeten Rohtext pinnt
// nur die Verdrahtung (existiert + wird tatsaechlich aufgerufen), [Prozess/Repo]-Grenze.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

test("tenant.html: Setup-Gebuehr ist verdrahtet (numberSetupFeeFrom -> planCard -> renderPlanCards)", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const html = fs.readFileSync(path.join(dir, "../public/tenant.html"), "utf8");
  assert.match(html, /function numberSetupFeeFrom\(s\)/);
  assert.match(html, /function planCard\(plan,\s*fee\)/);
  assert.match(html, /function renderPlanCards\(plans,\s*fee\)/);
  assert.match(html, /renderPlanCards\(planCatalog \|\| \[\],\s*numberSetupFeeFrom\(s\)\)/);
  assert.match(html, /numberSetupFeeCents:\s*st\.numberSetupFeeCents/);
  assert.match(html, /class="plan-fee"/);
});
