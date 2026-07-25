// DID-14 (i18n-Testkatalog). Beleg: src/config.js:702-709;
// tasks/i18n-tests/06-nummern-provisioning.md ("DID-14"). Mechanismus-Test (gruen,
// Regressionsschutz): PROVISIONING_ENABLED ist OHNE Env-Ueberschreibung fail-closed
// (false) - das schuetzt JEDEN echten Nummernkauf, auch internationale (US/UK/...),
// solange der Betreiber den Schalter nicht bewusst umlegt. Reiner Modul-Import, kein
// Server-Spawn (Muster test/config-shape.test.js) - NODE_ENV=test verhindert das Laden
// der lokalen .env (src/config.js:10-12), die Assertion ist daher unabhaengig vom
// lokalen Entwickler-Setup deterministisch, solange PROVISIONING_ENABLED nicht in der
// Shell-Umgebung des Testlaufs selbst gesetzt ist (wie bei den bestehenden
// config-shape.test.js-Direktimporten).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";

test("DID-14 (Mechanismus, gruen) - PROVISIONING_ENABLED Default ist false (schuetzt jeden internationalen Kauf)", () => {
  assert.equal(config.provisioning.provisioningEnabled, false);
});
