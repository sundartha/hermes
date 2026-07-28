// W2-B6 (i18n-Testkatalog: WEB-07, WEB-18, WEB-19, GAP-30). WEB-08 ist mit P14
// ersatzlos entfallen: das Gate mass styleLabel() IN public/tenant.html, und die Datei
// ist geloescht (die App-Shell hat keinen sprachblinden Enum-Label-Helfer). Spezifikation
// tasks/i18n-tests/08-web-dashboard-onboarding.md + 11-luecken-und-e2e.md.
// Liest NUR (R-A: kein src/, kein public/, kein apps/web/ ausser Lesezugriff hier) -
// aendert nichts. Reine Quelltext-/Modul-Pruefung, kein Server, kein Netz, kein Build
// (apps/web/dist ist gitignored - gelesen wird apps/web/src/; Praezedenz
// test/gap-15-legal-pages-no-placeholder-en-routes.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { SELF_SERVICE_FREE_FIELDS, SELF_SERVICE_RESTRICT_ONLY_FIELDS } from "../src/self-service.js";
import { SETTINGS_FREE_FIELDS, SETTINGS_RESTRICT_ONLY_FIELDS } from "../apps/web/src/lib/api.js";

const WEB_SRC = path.join(ROOT, "apps/web/src");
const SOURCE_EXTENSIONS = [".js", ".astro", ".ts", ".mjs"];

// Alle Quelldateien unter dir (rekursiv) als {file, source}. Reiner Read, kein
// Nebeneffekt - der einzige Sammler dieser Datei (G5/S2: drei Tests konsumieren ihn).
function sourceFilesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFilesUnder(full));
    } else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
      out.push({ file: full, source: fs.readFileSync(full, "utf8") });
    }
  }
  return out;
}

// Dateien, deren Quelltext das Muster trifft - relativ zu ROOT, fuer lesbare
// Fehlermeldungen.
function filesMatching(files, pattern) {
  return files.filter(({ source }) => pattern.test(source)).map(({ file }) => path.relative(ROOT, file));
}

test("WEB-07 (SOLL, rot) - das englische Dashboard bindet agentStyle/personaStyleIds ueberhaupt", () => {
  const hits = filesMatching(sourceFilesUnder(WEB_SRC), /agentStyle|personaStyleIds/);
  // Die Luecke war rein oberflaechenseitig: das Backend fuehrt agentStyle laengst, nur das
  // englische apps/web-Dashboard band es nicht (P13). Der frueher hier zitierte Gegenbeleg
  // (das Stil-Dropdown in public/tenant.html) existiert seit P14 nicht mehr.
  assert.ok(hits.length > 0, "kein Treffer im gesamten apps/web/src-Baum - agentStyle fehlt der englischen UI");
});

test("WEB-18 (Regressions-Baseline, gruen) - apps/web formatiert Datum durchgaengig en-US", () => {
  const files = sourceFilesUnder(WEB_SRC);
  const calLocale = files.find(({ file }) => file.endsWith("lib/api.js"));
  const dateLocale = files.find(({ file }) => file.endsWith("lib/subscribe.js"));
  assert.match(calLocale.source, /const CAL_LOCALE = "en-US";/, "CAL_LOCALE muss en-US sein");
  assert.match(dateLocale.source, /const DATE_LOCALE = "en-US";/, "DATE_LOCALE muss en-US sein");

  const foreignLocaleLiterals = filesMatching(files, /["'](de-DE|fr-FR)["']/);
  assert.deepEqual(foreignLocaleLiterals, [], "kein de-DE/fr-FR-Literal unter apps/web/src erlaubt");

  const localeCallSites = [...files.flatMap(({ source }) => [...source.matchAll(/\.(?:toLocale\w*|toString)\(([A-Z_]+)/g)])]
    .filter((m) => /toLocale/.test(m[0]));
  const intlCallSites = files.flatMap(({ source }) => [...source.matchAll(/Intl\.\w+\(([A-Z_]+)/g)]);
  const allCallSites = [...localeCallSites, ...intlCallSites];
  assert.equal(allCallSites.length, 3, "unerwartete Anzahl Locale-Aufrufstellen - Extraktion pruefen");
  for (const call of allCallSites)
    assert.match(call[1], /^(CAL_LOCALE|DATE_LOCALE)$/, `Aufrufstelle "${call[0]}" reicht kein inline-Locale-Literal durch`);
});

test("WEB-19 (SOLL, rot) - die private Rufnummer hat in mindestens einem Dashboard eine UI", () => {
  const webHits = filesMatching(sourceFilesUnder(WEB_SRC), /privateNumber|private-number/);
  // Die Server-Seite ist geschlossen und getestet (test/f2-self-service-state-private-
  // number.test.js, /api/self-service/state liefert das maskierte Feld) - die Luecke war
  // rein oberflaechenseitig, das Feld wurde ausgeliefert und von niemandem gelesen.
  // P14: apps/web ist seit dem Loeschen von public/tenant.html das EINZIGE Dashboard.
  assert.ok(webHits.length > 0, "apps/web bindet privateNumber nicht");
});

test("GAP-30 (SOLL, rot) - Frontend- und Server-Feldkatalog sind identisch", () => {
  assert.deepEqual(
    [...SETTINGS_FREE_FIELDS].sort(),
    [...SELF_SERVICE_FREE_FIELDS].sort(),
    "Frontend-FREE_FIELDS driftet vom Server-Vertrag - agentStyle fehlt der UI, allowCalendar/allowBooking kennt der Server nicht mehr",
  );
});

test("GAP-30 (Mechanismus, gruen) - die restrict-only-Liste ist zwischen beiden Paketen deckungsgleich", () => {
  assert.deepEqual(
    [...SETTINGS_RESTRICT_ONLY_FIELDS].sort(),
    [...SELF_SERVICE_RESTRICT_ONLY_FIELDS].sort(),
    "der Paritaets-Mechanismus traegt fuer restrict-only - der GAP-30-Befund betrifft genau EINE Liste (FREE_FIELDS), nicht beide",
  );
});
