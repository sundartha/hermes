// W2-B6 (i18n-Testkatalog: WEB-07, WEB-08, WEB-18, WEB-19, GAP-30). Spezifikation
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
const TENANT_HTML = path.join(ROOT, "public/tenant.html");
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
  // Gegenbeleg: public/tenant.html hat das Stil-Dropdown laengst (styleLabel/renderStyle) -
  // die Luecke ist rein das englische apps/web-Dashboard, nicht das Backend/das DE-Dashboard.
  assert.ok(hits.length > 0, "kein Treffer im gesamten apps/web/src-Baum - agentStyle fehlt der englischen UI");
});

test("WEB-08 (SOLL, rot) - das Persona-Stil-Label folgt der Tenant-Sprache, nicht der deutschen Enum-ID", () => {
  const tenantHtml = fs.readFileSync(TENANT_HTML, "utf8");
  const fnMatch = tenantHtml.match(/function styleLabel\(([^)]*)\)\{([\s\S]*?)\n\}/);
  assert.ok(fnMatch, "styleLabel() nicht in tenant.html gefunden");
  const [, params, body] = fnMatch;
  // (a) strukturell sprachblind: genau EIN Parameter, keine Sprach-/Locale-Quelle im Rumpf.
  assert.equal(params.trim().split(",").length, 1, "styleLabel muss genau einen Parameter haben");
  assert.doesNotMatch(body, /locale|language|lang\b/i, "styleLabel darf keine Sprachquelle im Rumpf lesen");
  // (b) das aus der ID abgeleitete Label darf den deutschen Wortstamm nicht tragen.
  const styleLabel = new Function(`return function styleLabel(${params}){${body}}`)();
  assert.doesNotMatch(styleLabel("warm-persoenlich"), /persoenlich/i, "Label traegt noch den deutschen Enum-Wortstamm");
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
  const tenantHtml = fs.readFileSync(TENANT_HTML, "utf8");
  const tenantHit = /privateNumber|private-number/.test(tenantHtml);
  // Die Server-Seite ist geschlossen und getestet (test/f2-self-service-state-private-
  // number.test.js, /api/self-service/state liefert das maskierte Feld) - die Luecke ist
  // rein oberflaechenseitig, das Feld wird ausgeliefert und von niemandem gelesen.
  assert.ok(webHits.length > 0 || tenantHit, "weder apps/web noch public/tenant.html binden privateNumber");
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
