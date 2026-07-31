// AL-P10b (PLAN-ASSISTANT-LEAP, Phase 10b): die beiden REINEN Riegel des In-Call-
// Nachschlags - was darf raus (sanitizeLookupQuery), was darf rein (lookupFactsFrom).
// Offline, ohne Server, ohne Netz, ohne Store.
//
// Testnamen tragen bewusst KEINE Katalog-ID (GAP-/PROMPT-/...) am Namensanfang - sonst
// landen sie still im Gates-Lauf (package.json config.i18nCatalogPattern), wo Rot erlaubt
// ist (Lehre catalog-id-prefix-misroutes-tests). Praefix ist "AL-P10b-G<n>:".
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOOKUP_MAX_FACTS,
  LOOKUP_QUERY_MAX_CHARS,
  lookupFactsFrom,
  sanitizeLookupQuery,
} from "../src/research/lookup-guard.js";
import { KEY_FACTS_LIMITS } from "../src/store/defaults.js";

// Der Angerufene: Nummer + Name + eine caller-Zeile, gegen die die Zitat-Suche laeuft.
const CALL = Object.freeze({
  to: "+4915112345678",
  callerName: "Petra Hollmann",
  transcript: [
    { role: "agent", text: "Guten Tag, ich rufe wegen eines Termins an." },
    { role: "caller", text: "Wir haben diese Woche nur noch am Freitag einen Platz frei." },
  ],
});

test("AL-P10b-G1: der Name des Angerufenen verlaesst den Server nicht (Abnahme 7)", () => {
  assert.equal(sanitizeLookupQuery("Praxis Hollmann Sprechzeiten", CALL), null);
  assert.equal(sanitizeLookupQuery("wer ist petra?", CALL), null);
  // Gegenprobe: dieselbe Sachfrage ohne Namen kommt durch.
  assert.ok(sanitizeLookupQuery("Sprechzeiten Zahnarztpraxis Innenstadt", CALL));
});

test("AL-P10b-G2: die Rufnummer des Angerufenen wird in jeder Schreibweise verworfen", () => {
  for (const written of [
    "Wem gehoert +49 151 12345678",
    "Wem gehoert 015112345678",
    "Wem gehoert +49 15 11 23 45 678",
  ]) {
    assert.equal(sanitizeLookupQuery(written, CALL), null, `durchgelassen: ${written}`);
  }
});

test("AL-P10b-G3: lange Ziffernfolgen sind gesperrt, eine Jahreszahl bleibt zulaessig", () => {
  assert.equal(sanitizeLookupQuery("IBAN DE44 5001 0517 5407 3249 31", CALL), null);
  assert.equal(sanitizeLookupQuery("Kundennummer 987654 pruefen", CALL), null);
  assert.ok(sanitizeLookupQuery("Feiertage 2026 in Bayern", CALL));
  assert.ok(sanitizeLookupQuery("oeffnet um 20 Uhr im Jahr 2026", CALL));
});

test("AL-P10b-G4: E-Mail-Adressen verlassen den Server nicht", () => {
  assert.equal(sanitizeLookupQuery("Wem gehoert petra@example.com", CALL), null);
});

test("AL-P10b-G5: eine woertlich uebernommene Anrufer-Wortfolge wird verworfen, eine Paraphrase nicht", () => {
  assert.equal(
    sanitizeLookupQuery("wir haben diese Woche nur noch am Freitag einen Platz frei", CALL),
    null,
  );
  assert.ok(sanitizeLookupQuery("Wie lange hat der Baumarkt freitags offen?", CALL));
});

test("AL-P10b-G6: Zitatspannen werden entfernt, der Rest bleibt zulaessig", () => {
  const cleaned = sanitizeLookupQuery('Er sagt "das ist zu teuer" - Preis Herrenhaarschnitt', CALL);
  assert.ok(cleaned);
  assert.ok(!/["'„“”«»‚‘’]/.test(cleaned), `Anfuehrungszeichen uebrig: ${cleaned}`);
  assert.ok(!cleaned.includes("das ist zu teuer"), `Zitat uebrig: ${cleaned}`);
  assert.ok(cleaned.includes("Preis Herrenhaarschnitt"));
});

test("AL-P10b-G7: eine uebergrosse Query wird an der Wortgrenze gekappt, nicht verworfen", () => {
  const long = `${"Wort ".repeat(60)}Ende`;
  const cleaned = sanitizeLookupQuery(long, CALL);
  assert.ok(cleaned);
  assert.ok(cleaned.length <= LOOKUP_QUERY_MAX_CHARS);
  assert.ok(cleaned.endsWith("Wort"), `unerwartetes Ende: ${cleaned}`);
});

test("AL-P10b-G8: leere und nicht-String-Queries werden abgelehnt", () => {
  for (const bad of ["", "   ", '""', null, undefined, 42, { query: "x" }]) {
    assert.equal(sanitizeLookupQuery(bad, CALL), null, `nicht abgelehnt: ${bad}`);
  }
});

test("AL-P10b-G9: lookupFactsFrom kappt Menge, Laenge und nicht druckbare Zeichen", () => {
  const raw = [
    "Erster Treffer",
    "Zweiter\nTreffer mit Umbruch",
    "Dritter Treffer",
    "Vierter Treffer faellt weg",
  ];
  const facts = lookupFactsFrom(raw);
  assert.equal(facts.length, LOOKUP_MAX_FACTS);
  assert.ok(!facts.some((f) => /\s\s|\n/.test(f)), `Umbruch/Doppel-Leerzeichen uebrig: ${facts}`);
  assert.deepEqual(facts.slice(0, 1), ["Erster Treffer"]);

  const over = lookupFactsFrom([`${"a".repeat(50)} `.repeat(20)]);
  assert.ok(over[0].length <= KEY_FACTS_LIMITS.maxLen);

  for (const bad of [null, undefined, "text", 7, { facts: [] }]) {
    assert.deepEqual(lookupFactsFrom(bad), [], `nicht leer bei: ${bad}`);
  }
  assert.deepEqual(lookupFactsFrom(["", "   ", 5, null]), []);
});
