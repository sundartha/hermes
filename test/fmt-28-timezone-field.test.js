// FMT-28 (i18n-Testkatalog). Beleg: src/store/defaults.js (kein timezone-Feld),
// src/db/schema.sql:13-135; tasks/i18n-tests/10-zeit-format-daten.md ("FMT-28");
// PLAN-I18N-TESTS.md Abschnitt 7.6 (Owner-Entscheidung 2026-07-25).
//
// SOLL-Test (heute rot). Die urspruengliche Katalog-Formulierung (10-zeit-format-
// daten.md) pinnte "0 Treffer" als GRUEN - das war vor der Owner-Entscheidung 7.6.
// Diese ist zweigeteilt: das Anrufzeit-*Gate* ist ABGELEHNT (LAW-07 entfaellt dafuer aus
// dem Arbeitsvorrat), aber die Zeitzonen-*ANZEIGE* ist BESCHLOSSEN - ein timeZone-Feld
// am Tenant, beim Onboarding aus dem Land gesetzt (00-kanonische-liste.md, Nachtrag
// 2026-07-25: "FMT-28 entblockt (Datenmodell-Feld + claude.js:43 bekommt timeZone)").
// Der SOLL-Zustand ist deshalb das GEGENTEIL des alten Katalog-Textes: ein timeZone-
// Feld MUSS im Datenmodell auftauchen. Der Fix selbst (Feld ergaenzen + claude.js
// konsumiert es) ist NICHT Teil dieses Testbaus (CLAUDE.md SCOPE-Regel) - dieser Test
// bleibt rot, bis er landet.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const defaultsSrc = fs.readFileSync(path.join(dir, "../src/store/defaults.js"), "utf8");
const schemaSrc = fs.readFileSync(path.join(dir, "../src/db/schema.sql"), "utf8");
const TZ_PATTERN = /timezone|timeZone/;

test("FMT-28 (SOLL, heute rot) - Datenmodell traegt ein timeZone-Feld am Tenant (JSON-Defaults UND Postgres-Schema)", () => {
  assert.ok(
    TZ_PATTERN.test(defaultsSrc),
    "src/store/defaults.js muss ein timezone/timeZone-Feld kennen (Entscheidung 7.6: Zeitzonen-Anzeige am Tenant)",
  );
  assert.ok(
    TZ_PATTERN.test(schemaSrc),
    "src/db/schema.sql muss eine timezone-Spalte kennen (Postgres-Backend muss dasselbe Feld persistieren)",
  );
});
