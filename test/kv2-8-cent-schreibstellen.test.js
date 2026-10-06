import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const STATE_OPS_PFAD = fileURLToPath(new URL("../src/store/state-ops.js", import.meta.url));

const ERLAUBTE_SCHREIBER = Object.freeze(["bookCents", "applyCreditCents"]);
const SCHREIBFORM = /\.costCents\s*\+?=(?!=)/g;
const MIN_TREFFER = 2;

function umschliessendeFunktion(zeilen, index) {
  for (let lauf = index; lauf >= 0; lauf--) {
    const treffer = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/.exec(zeilen[lauf]);
    if (treffer) return treffer[1];
  }
  return null;
}

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

  assert.ok(
    namen.length >= MIN_TREFFER,
    `der Scanner fand nur ${namen.length} Schreibstelle(n) - ein Muster, das nichts findet, sieht aus wie "alles sauber"`,
  );
  for (const erwartet of ERLAUBTE_SCHREIBER) {
    assert.ok(namen.includes(erwartet), `${erwartet} muss unter den gefundenen Schreibern sein, gefunden: ${namen.join(",")}`);
  }

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
    "  return bucket.costCents === 0;",
    "}",
  ].join("\n");

  const namen = schreiberIn(attrappe);
  assert.deepEqual(namen, ["bookCents", "applyCreditCents", "heimlicherDritter"]);
  const unerlaubt = [...new Set(namen)].filter((name) => !ERLAUBTE_SCHREIBER.includes(name));
  assert.deepEqual(unerlaubt, ["heimlicherDritter"], "der dritte Schreiber MUSS auffallen, der Vergleich NICHT");
});
