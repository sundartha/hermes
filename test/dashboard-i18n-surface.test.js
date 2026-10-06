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
  PRIVATE_NUMBER_MESSAGES,
  PRIVATE_NUMBER_MESSAGES_DE,
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

function filesMatching(files, pattern) {
  return files.filter(({ source }) => pattern.test(source)).map(({ file }) => path.relative(ROOT, file));
}

test("WEB-07 (SOLL, rot) - das englische Dashboard bindet agentStyle/personaStyleIds ueberhaupt", () => {
  const hits = filesMatching(sourceFilesUnder(WEB_SRC), /agentStyle|personaStyleIds/);
  assert.ok(hits.length > 0, "kein Treffer im gesamten apps/web/src-Baum - agentStyle fehlt der englischen UI");
});

function callArgAt(source, openIndex) {
  let depth = 1;
  let i = openIndex + 1;
  for (; i < source.length && depth > 0; i++) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") depth -= 1;
  }
  return source.slice(openIndex + 1, i - 1);
}

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
  assert.deepEqual(
    identsPerSite.map((idents) => idents.join(",")).sort(),
    ["DATE_LOCALE,DATE_LOCALE_DE", "DATE_LOCALE_DE"],
    "genau eine Aufrufstelle muss sprachbewusst zwischen beiden Konstanten waehlen (renewDate), die andere fest auf DATE_LOCALE_DE bleiben (germanDate, § 312k)",
  );
});

test("WEB-19 (SOLL, rot) - die private Rufnummer hat in mindestens einem Dashboard eine UI", () => {
  const webHits = filesMatching(sourceFilesUnder(WEB_SRC), /privateNumber|private-number/);
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

const DICT_PAIRS = [
  ["render.js STATUS_PILL_LABELS", STATUS_PILL_LABELS, STATUS_PILL_LABELS_DE],
  ["api.js CALL_STATUS_LABELS", CALL_STATUS_LABELS, CALL_STATUS_LABELS_DE],
  ["api.js TURN_ROLE_LABELS", TURN_ROLE_LABELS, TURN_ROLE_LABELS_DE],
  ["api.js SETTINGS_LANGUAGE_LABELS", SETTINGS_LANGUAGE_LABELS_EN, SETTINGS_LANGUAGE_LABELS_DE],
  ["api.js SETTINGS_PERMISSION_LABELS", SETTINGS_PERMISSION_LABELS_EN, SETTINGS_PERMISSION_LABELS_DE],
  ["api.js SETTINGS_PERMISSION_HINTS", SETTINGS_PERMISSION_HINTS_EN, SETTINGS_PERMISSION_HINTS_DE],
  ["api.js PRIVATE_NUMBER_MESSAGES", PRIVATE_NUMBER_MESSAGES, PRIVATE_NUMBER_MESSAGES_DE],
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
