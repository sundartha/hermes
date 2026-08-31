// KV2-8, Abnahmekriterium (h): es entsteht KEIN dritter Cent-Schreibweg. Eigene Datei,
// damit die Zusage sichtbar bleibt statt in einem Sammeltest zu verschwinden - und ein
// DAUERHAFTER Test statt eines einmaligen grep: das Bestandsmuster `grep -n "costCents +="`
// fand nur EINE der beiden Kanten (applyCreditCents schreibt per Zuweisung, nicht per
// Inkrement) und haette eine dritte Zuweisungs-Fundstelle ebenso uebersehen.
//
// In-process, netzfrei: der Test liest die Quelldatei mit node:fs und wertet sie
// strukturell aus. Testnamen tragen bewusst KEINE Katalog-/Abnahme-Kennung am
// Namensanfang (Lehre catalog-id-prefix-misroutes-tests) - diese Tests gehoeren in den
// Regressionslauf.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const STATE_OPS_PFAD = fileURLToPath(new URL("../src/store/state-ops.js", import.meta.url));

// Die ZWEI erlaubten Cent-Schreiber der Gate-Achse. bookCents inkrementiert (Belastung),
// applyCreditCents WEIST ZU (Gutschrift mit 0-Boden) - deshalb erfasst das Muster unten
// beide Formen.
const ERLAUBTE_SCHREIBER = Object.freeze(["bookCents", "applyCreditCents"]);
// JEDE Schreibform an einem costCents-Feld: `.costCents =` und `.costCents +=`, aber NICHT
// `.costCents ==`/`===` (Vergleich). Der Empfaengername ist bewusst nicht Teil des Musters -
// ein dritter Schreiber auf einem anders benannten Objekt soll ebenfalls auffallen.
const SCHREIBFORM = /\.costCents\s*\+?=(?!=)/g;
// Mindestzahl der Treffer (Positiv-Kontrolle, Lehre pruefkommando-ohne-positiv-kontrolle):
// ein Scanner, der NICHTS findet, saehe aus wie "alles sauber".
const MIN_TREFFER = 2;

// Der Name der Funktion, in der eine Zeile steht: rueckwaerts die naechste
// `function <name>(`-Zeile suchen. Reine Textauswertung ueber demselben Zeilen-Array.
function umschliessendeFunktion(zeilen, index) {
  for (let lauf = index; lauf >= 0; lauf--) {
    const treffer = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/.exec(zeilen[lauf]);
    if (treffer) return treffer[1];
  }
  return null;
}

// Alle Schreibstellen eines Quelltexts als Funktionsnamen. Exportfaehig gehalten (reine
// Funktion), damit die Positiv-Kontrolle unten DENSELBEN Code gegen eine Attrappe fahren
// kann statt eine zweite, vereinfachte Fassung zu erfinden (G5).
function schreiberIn(quelltext) {
  const zeilen = quelltext.split("\n");
  const namen = [];
  for (const [index, zeile] of zeilen.entries()) {
    SCHREIBFORM.lastIndex = 0;
    const treffer = [...zeile.matchAll(SCHREIBFORM)];
    for (let lauf = 0; lauf < treffer.length; lauf++) namen.push(umschliessendeFunktion(zeilen, index));
  }
  return namen;
}

test("(h) state-ops.js hat GENAU zwei Cent-Schreiber: bookCents und applyCreditCents", () => {
  const namen = schreiberIn(readFileSync(STATE_OPS_PFAD, "utf8"));

  // Positiv-Kontrolle 1: der Scanner findet ueberhaupt etwas.
  assert.ok(
    namen.length >= MIN_TREFFER,
    `der Scanner fand nur ${namen.length} Schreibstelle(n) - ein Muster, das nichts findet, sieht aus wie "alles sauber"`,
  );
  for (const erwartet of ERLAUBTE_SCHREIBER) {
    assert.ok(namen.includes(erwartet), `${erwartet} muss unter den gefundenen Schreibern sein, gefunden: ${namen.join(",")}`);
  }

  // Die eigentliche Zusage: KEIN dritter Name.
  const unerlaubt = [...new Set(namen)].filter((name) => !ERLAUBTE_SCHREIBER.includes(name));
  assert.deepEqual(
    unerlaubt,
    [],
    `dritte Cent-Schreibstelle(n) in state-ops.js: ${unerlaubt.join(",")} - die Gate-Achse hat genau zwei Kanten (KV2-8, Abnahme (h))`,
  );
});

test("(h) Positiv-Kontrolle: derselbe Scanner findet einen DRITTEN Schreiber in einer Attrappe", () => {
  const attrappe = [
    "function bookCents(usage, cents) {",
    "  usage.costCents += cents;",
    "}",
    "function applyCreditCents(usage, deltaCents) {",
    "  usage.costCents = Math.max(0, usage.costCents + deltaCents);",
    "}",
    "function heimlicherDritter(bucket) {",
    "  bucket.costCents = 0;",
    "  return bucket.costCents === 0;", // Vergleich - darf NICHT als Schreibstelle zaehlen
    "}",
  ].join("\n");

  const namen = schreiberIn(attrappe);
  // Der LESENDE `usage.costCents +` auf der rechten Seite zaehlt NICHT mit - nur die
  // Zuweisung selbst; ebenso wenig der `=== 0`-Vergleich im dritten Schreiber.
  assert.deepEqual(namen, ["bookCents", "applyCreditCents", "heimlicherDritter"]);
  const unerlaubt = [...new Set(namen)].filter((name) => !ERLAUBTE_SCHREIBER.includes(name));
  assert.deepEqual(unerlaubt, ["heimlicherDritter"], "der dritte Schreiber MUSS auffallen, der Vergleich NICHT");
});
