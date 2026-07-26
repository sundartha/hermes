// BK1-1 Regression: formatPlanPrice + planCard (inline in tenant.html) sind die Geld-Anzeige-
// Logik des Tenant-Dashboards. formatPlanPrice teilt Cents durch CENTS_PER_EURO und lokalisiert
// ueber Intl (de-DE -> Komma-Dezimaltrenner + Euro-Symbol); planCard reicht den Plan-Preis in
// die Kachel. Ein Divisor-Fehler (fehlendes /100 -> "499,00"), ein Locale-Fehler (Punkt statt
// Komma) oder eine hartkodierte/falsche currency liefe sonst ungetestet auf einen Zahlungs-Pfad
// (kein Dashboard-Optik-Fall -> Tests greifen). Das Repo hat kein DOM-Harness, darum wird die
// echte Funktion aus dem HTML extrahiert und in einem isolierten vm-Kontext ausgefuehrt (gleiche
// Technik wie bk1-plan-catalog-failsoft) - so prueft der Check die ausgelieferte Logik, keine Kopie.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SUPPORTED_LANGUAGES, localeFor } from "../src/i18n/locales.js";
import { DEFAULT_LANGUAGE } from "../src/store/defaults.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(dir, "../public/tenant.html"), "utf8");

// Das ICU-Trennzeichen zwischen Betrag und Waehrungssymbol ist ein geschuetztes Leerzeichen,
// dessen Codepoint je ICU-Version variiert (U+00A0 / U+202F). Wir normalisieren jede Leerzeichen-
// Folge auf ein gewoehnliches Space und pinnen so Betrag, Dezimaltrenner und Symbol deterministisch
// (P12-R: in jeder Umgebung reproduzierbar), ohne am unsichtbaren Trennzeichen zu zerbrechen.
const normSpace = (s) => s.replace(/\s+/g, " ");

// Extrahiert benannte Funktionen/Konstanten aus der committeten tenant.html (trusted, kein externer
// Input -> keine Injection) und liefert sie aus einem frischen vm-Kontext. Anker ist der Name + die
// spaltenbuendige schliessende Klammer (kein Datei:Zeile-Bezug, C2); einzeilige Funktionen enden am
// Zeilenumbruch. runInNewContext stellt die Standard-Intrinsics inkl. Intl bereit und isoliert je Lauf.
function extractPriceUi() {
  const grab = (re, label) => {
    const m = html.match(re);
    assert.ok(m, `${label} nicht in tenant.html gefunden`);
    return m[0];
  };
  const cents = grab(/const CENTS_PER_EURO = \d+;/, "CENTS_PER_EURO");
  // P15b/C2: die Preisformatierung liest dieselbe Formatlocale wie Datum/Zeit - Deklaration
  // und Setter muessen deshalb mit in den Kontext, sonst laeuft die extrahierte Funktion ins
  // Leere. Ohne setFormatLocale-Aufruf gilt der statische Fallback (de-DE) wie im Browser
  // vor der ersten /state-Antwort - die Erwartungen unten bleiben damit unveraendert.
  const staticLocale = grab(/const STATIC_FORMAT_LOCALE = "[^"]+";/, "STATIC_FORMAT_LOCALE");
  const letLocale = grab(/let formatLocale = STATIC_FORMAT_LOCALE;/, "formatLocale");
  const setLocale = grab(/function setFormatLocale\([\s\S]*?\n\}/, "setFormatLocale");
  const format = grab(/function formatPlanPrice\([\s\S]*?\n\}/, "formatPlanPrice");
  const escFn = grab(/function esc\([\s\S]*?\n/, "esc"); // einzeilig: bis zum Zeilenende
  const card = grab(/function planCard\([\s\S]*?\n\}/, "planCard");
  const code =
    `${staticLocale} ${letLocale} ${setLocale} ${cents} ${format} ${escFn} ${card} ` +
    `({ formatPlanPrice, planCard, setFormatLocale });`;
  return vm.runInNewContext(code, {});
}

const { formatPlanPrice, planCard } = extractPriceUi();

test("formatPlanPrice: Cents/100 + de-DE-Lokalisierung (Divisor- und Locale-Pin)", () => {
  assert.equal(normSpace(formatPlanPrice(499, "eur")), "4,99 €");
  assert.equal(normSpace(formatPlanPrice(999, "eur")), "9,99 €");
  assert.equal(normSpace(formatPlanPrice(0, "eur")), "0,00 €"); // Grenzfall (T5)
});

test("formatPlanPrice: currency wird geehrt (kein hartkodiertes Euro)", () => {
  const usd = normSpace(formatPlanPrice(499, "usd"));
  assert.equal(usd, "4,99 $");
  assert.ok(!usd.includes("€"), "USD-Preis darf kein Euro-Symbol tragen");
});

// P15b/C2 - HARTE INVARIANTE Geld-Achse: die Locale aendert NUR die Darstellung. Der
// Waehrungscode kommt aus den DATEN (Argument currency) und wandert NIE mit der Sprache
// mit - sonst saehe ein Tenant einen anderen Betrag, als ihm belastet wird (Entscheidung
// 7.1/O12). Geprueft ueber genau die drei Locales, die der Server ausliefern kann
// (EINE Quelle: i18n/locales.js), in einem FRISCHEN vm-Kontext (P12-I: kein geteilter
// Zustand mit den Tests oben).
test("formatPlanPrice: EUR bleibt EUR in de/en/fr - nur die Darstellung folgt der Locale", () => {
  const ui = extractPriceUi();
  const locales = SUPPORTED_LANGUAGES.map((l) => localeFor(l).dateLocale);
  const rendered = locales.map((l) => {
    ui.setFormatLocale(l);
    return normSpace(ui.formatPlanPrice(499, "eur"));
  });
  for (const [i, out] of rendered.entries()) {
    assert.ok(out.includes("€"), `${locales[i]}: EUR-Betrag traegt das Euro-Zeichen`);
    assert.equal(out.replace(/\D/g, ""), "499", `${locales[i]}: identischer Zahlwert`);
  }
  assert.ok(new Set(rendered).size > 1, "die DARSTELLUNG verzweigt wirklich je Locale");
});

test("formatPlanPrice: eine fremde Locale erzeugt KEINE fremde Waehrung", () => {
  const ui = extractPriceUi();
  ui.setFormatLocale("en-GB");
  const usd = normSpace(ui.formatPlanPrice(499, "usd"));
  assert.ok(!usd.includes("€"), "USD bleibt USD, auch unter einer EUR-Locale");
  assert.equal(usd.replace(/\D/g, ""), "499");
});

// FMT-15 - nach P15b/C2 ist von der ID nur noch der Fallback-Zweig uebrig (19-w2-
// baseline.md 3.6): sobald /state antwortet, kommt formatLocale vom Server. Der 403-Pfad
// (gefuehrte Aktivierung) sieht /state NIE und rendert die Plan-Kacheln - also die erste
// Geldanzeige, die ein Neukunde ueberhaupt sieht - im statischen Fallback. Diese Datei
// importiert src/config.js nicht - im eigenen Test-Worker gilt damit der Code-Default
// "en" (DEFAULT_LANGUAGE), unabhaengig von der lokalen .env (Lehre test-base-env-drift).
test("FMT-15 (SOLL, rot) - der Vor-/state-Fallback folgt dem Weltdefault, nicht hart de-DE", () => {
  const literal = html.match(/const STATIC_FORMAT_LOCALE = "([^"]+)";/);
  assert.ok(literal, "STATIC_FORMAT_LOCALE nicht in tenant.html gefunden");
  assert.equal(literal[1], localeFor(DEFAULT_LANGUAGE).dateLocale, "heute 'de-DE', SOLL 'en-GB'");
});

test("FMT-15 (SOLL, rot) - die Aktivierungs-Ansicht formatiert Preise nicht deutsch", () => {
  const ui = extractPriceUi(); // frischer vm-Kontext, KEIN setFormatLocale (Vor-/state-Fallback)
  const expected = new Intl.NumberFormat(localeFor(DEFAULT_LANGUAGE).dateLocale, {
    style: "currency",
    currency: "EUR",
  }).format(4.99);
  assert.equal(normSpace(ui.formatPlanPrice(499, "eur")), normSpace(expected), "heute '4,99 €', SOLL '€4.99'");
});

test("planCard: lokalisierter Katalog-Preis und Popular-Badge landen in der Kachel", () => {
  const plan = {
    slug: "starter",
    name: "Starter",
    amountCents: 499,
    currency: "eur",
    featured: true,
    features: ["10 Anrufe/Monat"],
  };
  const card = normSpace(planCard(plan));
  assert.ok(card.includes("4,99 €"), "Preis aus formatPlanPrice steht in der Kachel");
  assert.match(card, /plan-badge">Popular/); // featured -> Badge (Parity zu preise.astro)
  assert.match(card, /data-plan="starter"/); // CTA traegt den Slug fuer den Checkout
});
