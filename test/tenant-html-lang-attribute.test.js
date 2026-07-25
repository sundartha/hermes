// ex WEB-01, umbenannt in P9 (A3) - i18n-Testkatalog, tasks/i18n-tests/08-web-dashboard-onboarding.md:110.
//
// tenant.html setzt das lang-Attribut ueber einen dynamischen Mechanismus
// (document.documentElement.lang), gespeist aus dem Antwortfeld `language` von
// /api/self-service/state (Server loest die Tenant-Sprache auf, s. self-service-routes.js).
// Zweite Assertion pinnt genau diese Kopplung, damit Server- und Client-Vertrag nicht
// auseinanderdriften koennen, ohne dass dieser Test rot wird.
//
// Statische Datei-Pruefung (kein Server-Spawn noetig), Modus "offline" laut Katalog.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";

test("tenant.html setzt das lang-Attribut aus der Server-Sprache (ex WEB-01)", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/tenant.html"), "utf8");

  assert.match(
    html,
    /document\.documentElement\.lang/,
    "tenant.html braucht einen dynamischen lang-Mechanismus (document.documentElement.lang)",
  );
  assert.match(
    html,
    /setDocumentLanguage\(s\.language\)/,
    "der lang-Mechanismus muss aus dem Antwortfeld `language` von /api/self-service/state gespeist werden",
  );
});
