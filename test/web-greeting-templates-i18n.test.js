// Greeting-Vorlagen i18n (ex WEB-04, tasks/i18n-tests/08-web-dashboard-onboarding.md,
// Cluster D7): die waehlbare Vorlagenmenge FOLGT der Tenant-Sprache statt nur drei
// deutscher Vorlagen anzubieten. Reiner Modul-Import, kein Server/Store noetig.
// Umbenannt in P3 (A3): der Name traegt die ID NICHT mehr am Anfang (package.json
// config.i18nCatalogPattern).
import { test } from "node:test";
import assert from "node:assert/strict";
import { greetingTemplatesFor, ALL_GREETING_TEMPLATES, selfServicePatch } from "../src/self-service.js";
import { hasInboundNotice } from "../src/i18n/inbound-notice.js";

test("Greeting-Vorlagen: jede unterstuetzte Sprache hat mindestens eine Vorlage in ihrer Sprache (ex WEB-04)", () => {
  const en = greetingTemplatesFor("en");
  const fr = greetingTemplatesFor("fr");
  const de = greetingTemplatesFor("de");
  assert.ok(en.some((t) => /\bAI assistant\b/i.test(t)), `keine EN-Vorlage: ${JSON.stringify(en)}`);
  assert.ok(fr.some((t) => /assistant IA/i.test(t)), `keine FR-Vorlage: ${JSON.stringify(fr)}`);
  assert.ok(de.some((t) => /KI-Assistent/.test(t)), `keine DE-Vorlage: ${JSON.stringify(de)}`);
  assert.ok(
    !en.some((t) => de.includes(t)) && !fr.some((t) => de.includes(t)) && !en.some((t) => fr.includes(t)),
    "die drei Sprachmengen muessen disjunkt sein",
  );
});

test("Greeting-Vorlagen: jede Vorlage traegt den Pflichtsatz", () => {
  assert.ok(ALL_GREETING_TEMPLATES.length > 0);
  assert.ok(ALL_GREETING_TEMPLATES.every(hasInboundNotice), "eine Vorlage ohne Pflichtsatz gefunden");
});

test("Greeting-Vorlagen: selfServicePatch akzeptiert die EN-Vorlage (EN-Tenant kann waehlen)", () => {
  const { clean, rejected } = selfServicePatch({ greeting: greetingTemplatesFor("en")[0] }, {});
  assert.ok("greeting" in clean, "EN-Vorlage haette angenommen werden muessen");
  assert.ok(!rejected.includes("greeting"));
});

test("Greeting-Vorlagen: {owner}-Platzhalter bleibt in jeder Vorlage erhalten", () => {
  for (const t of ALL_GREETING_TEMPLATES) {
    assert.ok(t.includes("{owner}"), `Vorlage ohne {owner}-Platzhalter: ${t}`);
  }
});
