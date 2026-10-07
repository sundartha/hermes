import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../helpers.js";
import { APP_PATH, CHECKOUT_RETURN } from "../../src/portal-paths.js";

function returnTarget(pathWithQuery) {
  const [pathname, search] = pathWithQuery.split("?");
  const [param, value] = (search || "").split("=");
  return { pathname, param, value };
}

test("P14: public/tenant.html existiert nicht mehr", () => {
  assert.equal(
    fs.existsSync(path.join(ROOT, "public/tenant.html")),
    false,
    "das alte Kunden-Dashboard ist geloescht (Owner-Entscheidung 2026-07-27)",
  );
});

test("P14: jede Stripe-Rueckkehr-Adresse zeigt auf die App-Shell", () => {
  const targets = Object.entries(CHECKOUT_RETURN);
  assert.ok(targets.length > 0, "CHECKOUT_RETURN darf nicht leer sein");
  for (const [name, target] of targets) {
    const { pathname, param, value } = returnTarget(target);
    assert.equal(pathname, APP_PATH, `${name} zeigt nicht auf die App-Shell`);
    assert.match(param, /^(card|sub)$/, `${name}: unerwarteter Parametername "${param}"`);
    assert.ok(value, `${name}: Rueckkehr-Adresse ohne Wert`);
  }
});
