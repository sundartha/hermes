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

// Geschrumpfte Erwartung (Dashboard-Neubau, feat/dashboard-neubau): Overview-
// Statistik, Action Items und Kalender wurden ersatzlos aus apps/web gestrichen
// (DashboardStats.astro, ActionItemsIsland.astro, CalendarIsland.astro entfernt;
// lib/api.js verlor dabei CAL_LOCALE + calendarDateParts/callStats/... - es gibt
// dafuer keine Ersatzflaeche). Die CAL_LOCALE-Pruefung entfaellt daher ganz (es
// gibt nichts mehr zu pruefen, kein stillschweigender Ersatz). Die Schutzabsicht
// selbst - GENAU EIN benannter, en-US-fester Locale-Kanal pro Zweck, KEIN
// inline-Literal an einer Aufrufstelle, KEIN unbemerktes de-DE/fr-FR-Literal -
// bleibt erhalten und wird unten enger gefasst statt entkernt.
test("WEB-18 (Regressions-Baseline, gruen) - apps/web formatiert Datum durchgaengig en-US (mit dokumentierter § 312k-Ausnahme)", () => {
  const files = sourceFilesUnder(WEB_SRC);
  const dateLocale = files.find(({ file }) => file.endsWith("lib/subscribe.js"));
  assert.match(dateLocale.source, /const DATE_LOCALE = "en-US";/, "DATE_LOCALE muss en-US sein");

  // Bewusste, bereits VOR dem Dashboard-Neubau eingefuehrte Ausnahme (Commit
  // 6abfcb0, 312k-P3): subscribe.js traegt zusaetzlich DATE_LOCALE_DE = "de-DE"
  // fuer die Kuendigungs-Anzeige/-Bestaetigung (§ 312k BGB verlangt das deutsche
  // Datumsformat TT.MM.JJJJ dort, s. germanDate()). Das ist die EINZIGE erlaubte
  // Stelle - jedes de-DE/fr-FR-Literal ausserhalb von subscribe.js bleibt verboten,
  // und auch subscribe.js selbst darf GENAU dieses eine Literal tragen (kein
  // zweites, kein fr-FR).
  const otherFiles = files.filter(({ file }) => file !== dateLocale.file);
  const foreignLocaleLiteralsElsewhere = filesMatching(otherFiles, /["'](de-DE|fr-FR)["']/);
  assert.deepEqual(
    foreignLocaleLiteralsElsewhere,
    [],
    "kein de-DE/fr-FR-Literal ausserhalb der dokumentierten § 312k-Ausnahme (subscribe.js) erlaubt",
  );
  const foreignLocaleLiteralsInSubscribe = dateLocale.source.match(/["'](de-DE|fr-FR)["']/g) || [];
  assert.deepEqual(
    foreignLocaleLiteralsInSubscribe,
    ['"de-DE"'],
    "subscribe.js darf GENAU EIN de-DE-Literal tragen (DATE_LOCALE_DE, § 312k) - kein zweites, kein fr-FR",
  );

  const localeCallSites = [...files.flatMap(({ source }) => [...source.matchAll(/\.(?:toLocale\w*|toString)\(([A-Z_]+)/g)])]
    .filter((m) => /toLocale/.test(m[0]));
  const intlCallSites = files.flatMap(({ source }) => [...source.matchAll(/Intl\.\w+\(([A-Z_]+)/g)]);
  const allCallSites = [...localeCallSites, ...intlCallSites];
  assert.equal(allCallSites.length, 2, "unerwartete Anzahl Locale-Aufrufstellen - Extraktion pruefen");
  for (const call of allCallSites)
    assert.match(
      call[1],
      /^(DATE_LOCALE|DATE_LOCALE_DE)$/,
      `Aufrufstelle "${call[0]}" reicht kein inline-Locale-Literal durch`,
    );
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
