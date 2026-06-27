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
  const format = grab(/function formatPlanPrice\([\s\S]*?\n\}/, "formatPlanPrice");
  const escFn = grab(/function esc\([\s\S]*?\n/, "esc"); // einzeilig: bis zum Zeilenende
  const card = grab(/function planCard\([\s\S]*?\n\}/, "planCard");
  const code = `${cents} ${format} ${escFn} ${card} ({ formatPlanPrice, planCard });`;
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
