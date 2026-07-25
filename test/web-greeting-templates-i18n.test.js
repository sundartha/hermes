// WEB-04 (tasks/i18n-tests/08-web-dashboard-onboarding.md, kanonisch per
// tasks/i18n-tests/00-kanonische-liste.md Cluster D7): GREETING_TEMPLATES bietet keine
// englische (oder franzoesische) Vorlage - ein EN-/FR-Self-Service-Tenant kann sein
// Greeting nur aus drei deutschen Vorlagen waehlen (Freitext ist gesperrt, s.
// src/self-service.js selfServicePatch). Reiner Modul-Import, kein Server/Store noetig.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GREETING_TEMPLATES } from "../src/self-service.js";

test("WEB-04 (SOLL rot): mindestens eine GREETING_TEMPLATES-Vorlage ist englisch", () => {
  const hasEnglish = GREETING_TEMPLATES.some((t) => /\bHello\b|\bHi there\b/i.test(t));
  assert.ok(
    hasEnglish,
    `Keine der ${GREETING_TEMPLATES.length} Vorlagen ist englisch - EN-Self-Service-Tenants ` +
      `haben keine waehlbare EN-Begruessung (Launch-Blocker): ${JSON.stringify(GREETING_TEMPLATES)}`,
  );
});
