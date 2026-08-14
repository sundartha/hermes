// W2-B6 (i18n-Testkatalog: WEB-07, WEB-18, WEB-19, GAP-30). WEB-08 ist mit P14
// ersatzlos entfallen: das Gate mass styleLabel() IN public/tenant.html, und die Datei
// ist geloescht (die App-Shell hat keinen sprachblinden Enum-Label-Helfer). Spezifikation
// tasks/i18n-tests/08-web-dashboard-onboarding.md + 11-luecken-und-e2e.md.
// Liest NUR (R-A: kein src/, kein public/, kein apps/web/ ausser Lesezugriff hier) -
// aendert nichts. Reine Quelltext-/Modul-Pruefung, kein Server, kein Netz, kein Build
// (apps/web/dist ist gitignored - gelesen wird apps/web/src/; Praezedenz
// test/gap-15-legal-pages-no-placeholder-en-routes.test.js).
//
// Dashboard-i18n Etappe 2 (dynamische Strings aus lib/render.js/subscribe.js/api.js,
// werden zur Renderzeit erzeugt statt ueber [data-i18n]): das Dashboard ist seitdem
// ECHT zweisprachig, nicht mehr durchgaengig Englisch. WEB-18 unten ist deshalb
// umgeschrieben (nicht abgeschwaecht) auf die neue Invariante: die EN-Konstanten
// bleiben test-gepinnte Quelle der Wahrheit, jede lebt neben einer modul-lokalen
// DE-Entsprechung ("<NAME>_DE") und einem kleinen Aufloeser (tPair/tDyn, lib/i18n.js).
// Reste-Pruefung bleibt bestehen: es gibt weiterhin GENAU zwei toLocale-Aufrufstellen
// im gesamten apps/web/src-Baum, beide in lib/subscribe.js -- renewDate() waehlt jetzt
// PER SPRACHE zwischen DATE_LOCALE/DATE_LOCALE_DE an DERSELBEN Stelle (keine neue
// Aufrufstelle), germanDate() bleibt unveraendert fest auf DATE_LOCALE_DE (§ 312k-
// Ausnahme, s. dort). Zwei neue Tests (ohne Katalog-Praefix, laufen also mit den
// uebrigen Regressionstests in "npm test", nicht erst mit "npm run test:gates")
// nageln die neuen Konventionen fest: Schluesselparitaet zwischen jedem EN/DE-
// Woerterbuchpaar, und dass die 312k-Knopftexte (CANCEL_BUTTON_LABEL/
// CONFIRM_CANCEL_BUTTON_LABEL) in KEINEM dieser Woerterbuecher als Wert
// auftauchen. Owner-Entscheidung 2026-08-14: der EN-Modus zeigt eine
// gleichwertig eindeutige ENGLISCHE Formulierung (CANCEL_BUTTON_LABEL_EN/
// CONFIRM_CANCEL_BUTTON_LABEL_EN, eigene benannte Konstanten + Resolver
// cancelButtonLabel()/confirmCancelButtonLabel(), s. subscribe.js) -- der
// Woerterbuch-Ausschluss hier schuetzt weiterhin, dass der DEUTSCHE
// Pflichtwortlaut nie in einem frei uebersetzbaren Woerterbuch landet und im
// DE-Modus woertlich erscheint.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { SELF_SERVICE_FREE_FIELDS, SELF_SERVICE_RESTRICT_ONLY_FIELDS } from "../src/self-service.js";
import {
  SETTINGS_FREE_FIELDS,
  SETTINGS_RESTRICT_ONLY_FIELDS,
  CALL_STATUS_LABELS,
  CALL_STATUS_LABELS_DE,
  TURN_ROLE_LABELS,
  TURN_ROLE_LABELS_DE,
  SETTINGS_LANGUAGE_LABELS_EN,
  SETTINGS_LANGUAGE_LABELS_DE,
  SETTINGS_PERMISSION_LABELS_EN,
  SETTINGS_PERMISSION_LABELS_DE,
  SETTINGS_PERMISSION_HINTS_EN,
  SETTINGS_PERMISSION_HINTS_DE,
} from "../apps/web/src/lib/api.js";
import { STATUS_PILL_LABELS, STATUS_PILL_LABELS_DE } from "../apps/web/src/lib/render.js";
import {
  SUBSCRIBE_MESSAGES,
  SUBSCRIBE_MESSAGES_DE,
  CANCEL_MESSAGES,
  CANCEL_MESSAGES_DE,
  NEWSLETTER_MESSAGES,
  NEWSLETTER_MESSAGES_DE,
  PLAN_CHOICE_COPY,
  PLAN_CHOICE_COPY_DE,
  BILLING_STATUS_BADGE,
  BILLING_STATUS_BADGE_DE,
  CANCEL_BUTTON_LABEL,
  CONFIRM_CANCEL_BUTTON_LABEL,
} from "../apps/web/src/lib/subscribe.js";

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
// Extrahiert das Argument eines Funktionsaufrufs ab der oeffnenden Klammer bis zur
// PASSENDEN schliessenden Klammer (Klammer-Tiefe gezaehlt) -- das Argument kann
// selbst Aufrufe enthalten (z.B. "getLang() === \"de\" ? DATE_LOCALE_DE :
// DATE_LOCALE"), ein simples "bis zum naechsten ')'" wuerde bei getLang() zu frueh
// abbrechen.
function callArgAt(source, openIndex) {
  let depth = 1;
  let i = openIndex + 1;
  for (; i < source.length && depth > 0; i++) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") depth -= 1;
  }
  return source.slice(openIndex + 1, i - 1);
}

// Jede Locale-Aufrufstelle (.toLocale*(...)/.toString(...)/Intl.x(...)) im Baum,
// mit Datei + vollstaendigem (klammerbalanciertem) Argument-Text.
function localeCallSites(files) {
  const sites = [];
  const pattern = /\.(?:toLocale\w*|toString)\(|Intl\.\w+\(/g;
  for (const { file, source } of files) {
    for (const m of source.matchAll(pattern)) {
      const openIndex = m.index + m[0].length - 1;
      sites.push({ file, call: m[0], arg: callArgAt(source, openIndex) });
    }
  }
  return sites;
}

test("WEB-18 (Regressions-Baseline, gruen) - apps/web formatiert Datum ueber GENAU zwei benannte Locale-Konstanten (en-US/de-DE), keine dritte Aufrufstelle", () => {
  const files = sourceFilesUnder(WEB_SRC);
  const dateLocale = files.find(({ file }) => file.endsWith("lib/subscribe.js"));
  assert.match(dateLocale.source, /const DATE_LOCALE = "en-US";/, "DATE_LOCALE muss en-US sein");
  assert.match(dateLocale.source, /const DATE_LOCALE_DE = "de-DE";/, "DATE_LOCALE_DE muss de-DE sein");

  // subscribe.js traegt GENAU diese zwei Locale-String-Literale (renewDate() waehlt
  // seit Etappe 2 sprachbewusst zwischen beiden, germanDate() bleibt fest auf
  // DATE_LOCALE_DE, § 312k) - kein drittes, kein fr-FR. Ausserhalb von subscribe.js
  // bleibt JEDES de-DE/fr-FR/en-US-Literal verboten (die beiden Konstanten sind die
  // EINZIGE erlaubte Quelle).
  const otherFiles = files.filter(({ file }) => file !== dateLocale.file);
  const foreignLocaleLiteralsElsewhere = filesMatching(otherFiles, /["'](de-DE|fr-FR)["']/);
  assert.deepEqual(
    foreignLocaleLiteralsElsewhere,
    [],
    "kein de-DE/fr-FR-Literal ausserhalb von lib/subscribe.js erlaubt",
  );
  const foreignLocaleLiteralsInSubscribe = dateLocale.source.match(/["'](de-DE|fr-FR)["']/g) || [];
  assert.deepEqual(
    foreignLocaleLiteralsInSubscribe.sort(),
    ['"de-DE"'],
    "subscribe.js darf GENAU EIN de-DE-Literal tragen (DATE_LOCALE_DE) - kein zweites, kein fr-FR",
  );

  // Aufrufstellen: GENAU zwei im gesamten Baum, beide in lib/subscribe.js. Jede
  // referenziert AUSSCHLIESSLICH DATE_LOCALE/DATE_LOCALE_DE (nie ein inline-Literal) --
  // renewDate() darf dabei sprachbewusst zwischen beiden waehlen (Ternary IM Argument,
  // "dieselbe Stelle waehlt nur die Konstante", keine zweite Aufrufstelle), germanDate()
  // referenziert nur DATE_LOCALE_DE.
  const sites = localeCallSites(files);
  assert.equal(sites.length, 2, "unerwartete Anzahl Locale-Aufrufstellen - Extraktion pruefen");
  const identsPerSite = sites.map((site) => {
    assert.equal(
      path.relative(ROOT, site.file),
      "apps/web/src/lib/subscribe.js",
      `Locale-Aufrufstelle ausserhalb von lib/subscribe.js: ${site.call}${site.arg})`,
    );
    assert.doesNotMatch(
      site.arg,
      /["'](de-DE|en-US|fr-FR)["']/,
      `Aufrufstelle "${site.call}${site.arg})" reicht ein inline-Locale-Literal durch`,
    );
    const idents = [...new Set(site.arg.match(/\bDATE_LOCALE(?:_DE)?\b/g) || [])];
    assert.ok(idents.length > 0, `Aufrufstelle ohne benannte Locale-Konstante: ${site.call}${site.arg})`);
    return idents.sort();
  });
  // Eine Stelle (germanDate) referenziert NUR DATE_LOCALE_DE (fest, § 312k, keine
  // Sprachbedingung); die andere (renewDate) referenziert BEIDE Konstanten (sprach-
  // bewusst). Reihenfolge der beiden Sites ist bewusst nicht festgelegt (Fundstellen-
  // Reihenfolge im Quelltext), darum ueber die SORTIERTE Menge der Identifier-Saetze.
  assert.deepEqual(
    identsPerSite.map((idents) => idents.join(",")).sort(),
    ["DATE_LOCALE,DATE_LOCALE_DE", "DATE_LOCALE_DE"],
    "genau eine Aufrufstelle muss sprachbewusst zwischen beiden Konstanten waehlen (renewDate), die andere fest auf DATE_LOCALE_DE bleiben (germanDate, § 312k)",
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

// ---- Dashboard-i18n Etappe 2: dynamische Woerterbuecher (render.js/subscribe.js/
// api.js) -- KEIN Katalog-Praefix (laufen in "npm test", nicht erst in "npm run
// test:gates"): das sind Regressions-/Mechanismus-Tests fuer bereits gebautes
// Verhalten, kein offener Produktbefund. -------------------------------------

// Jedes EN/DE-Woerterbuchpaar der drei dynamischen Module, benannt fuer lesbare
// Fehlermeldungen. EIN Ort (G5) fuer beide Tests unten (Paritaet + 312k-Ausschluss).
const DICT_PAIRS = [
  ["render.js STATUS_PILL_LABELS", STATUS_PILL_LABELS, STATUS_PILL_LABELS_DE],
  ["api.js CALL_STATUS_LABELS", CALL_STATUS_LABELS, CALL_STATUS_LABELS_DE],
  ["api.js TURN_ROLE_LABELS", TURN_ROLE_LABELS, TURN_ROLE_LABELS_DE],
  ["api.js SETTINGS_LANGUAGE_LABELS", SETTINGS_LANGUAGE_LABELS_EN, SETTINGS_LANGUAGE_LABELS_DE],
  ["api.js SETTINGS_PERMISSION_LABELS", SETTINGS_PERMISSION_LABELS_EN, SETTINGS_PERMISSION_LABELS_DE],
  ["api.js SETTINGS_PERMISSION_HINTS", SETTINGS_PERMISSION_HINTS_EN, SETTINGS_PERMISSION_HINTS_DE],
  ["subscribe.js SUBSCRIBE_MESSAGES", SUBSCRIBE_MESSAGES, SUBSCRIBE_MESSAGES_DE],
  ["subscribe.js CANCEL_MESSAGES", CANCEL_MESSAGES, CANCEL_MESSAGES_DE],
  ["subscribe.js NEWSLETTER_MESSAGES", NEWSLETTER_MESSAGES, NEWSLETTER_MESSAGES_DE],
  ["subscribe.js PLAN_CHOICE_COPY", PLAN_CHOICE_COPY, PLAN_CHOICE_COPY_DE],
  ["subscribe.js BILLING_STATUS_BADGE", BILLING_STATUS_BADGE, BILLING_STATUS_BADGE_DE],
];

test("dashboard-i18n Etappe 2: jede DE-Uebersetzung hat einen EN-Zwilling (Schluesselparitaet der dynamischen Woerterbuecher)", () => {
  for (const [name, en, de] of DICT_PAIRS) {
    assert.deepEqual(
      Object.keys(de).sort(),
      Object.keys(en).sort(),
      `${name}: DE-Woerterbuch driftet von den EN-Schluesseln (fehlender/ueberzaehliger Key)`,
    );
  }
});

test("dashboard-i18n Etappe 2: die gesetzlich vorgegebenen 312k-Knopftexte tauchen in KEINEM dynamischen Woerterbuch auf", () => {
  // CANCEL_BUTTON_LABEL/CONFIRM_CANCEL_BUTTON_LABEL sind § 312k BGB wortgetreu
  // vorgegeben und bleiben in BEIDEN Sprachen unveraendert deutsch (subscribe.js
  // Kommentar "SPRACHBRUCH IST GEWOLLT") -- sie duerfen nie versehentlich in ein
  // uebersetzbares Woerterbuch wandern (weder als Key noch als Wert).
  const forbiddenValues = [CANCEL_BUTTON_LABEL, CONFIRM_CANCEL_BUTTON_LABEL];
  for (const [name, en, de] of DICT_PAIRS) {
    for (const [dictLabel, dict] of [["EN", en], ["DE", de]]) {
      for (const key of Object.keys(dict)) {
        assert.ok(!forbiddenValues.includes(key), `${name} (${dictLabel}): 312k-Wortlaut als Schluessel "${key}"`);
      }
      for (const value of Object.values(dict)) {
        assert.ok(
          !forbiddenValues.includes(value),
          `${name} (${dictLabel}): enthaelt den gesetzlich vorgegebenen 312k-Wortlaut "${value}" als Wert - das darf nie uebersetzbar werden`,
        );
      }
    }
  }
});
