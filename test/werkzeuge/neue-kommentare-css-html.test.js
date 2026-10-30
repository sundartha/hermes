import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { befundSchluessel } from "../../tools/eslint-rules/bestand.js";
import { bestandsDatei } from "./hermes-regeln-probe.js";
import { REPO_ROOT } from "./probe-repo.js";
import { nachCommitPruefen, repoMitBasis } from "./pr-probe.js";

const TOOL = join(REPO_ROOT, "tools/neue-kommentare.mjs");
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const BESTAND = "tools/basis/kommentare.json";
const CSS = "apps/web/src/styles/app.css";
const SEITE = "apps/web/src/pages/index.astro";
const HTML = "apps/web/public/probe.html";

function quelle(zeilen) {
  return `${zeilen.join("\n")}\n`;
}

function basisRepo(context, dateien = {}) {
  return repoMitBasis(context, {
    "eslint.config.mjs": "export default [];\n",
    [BESTAND]: bestandsDatei([]),
    [CSS]: quelle([".a {", "  color: red;", "}"]),
    [SEITE]: quelle(["---", 'const titel = "Start";', "---", "<h1>{titel}</h1>"]),
    [HTML]: quelle(["<!doctype html>", "<p>eins</p>"]),
    ...dateien,
  });
}

function nachher(repo, dateien) {
  return nachCommitPruefen(repo, TOOL, dateien);
}

test("neue-kommentare: ein neuer CSS-Kommentar in der Web-App ist rot", (context) => {
  const lauf = nachher(basisRepo(context), {
    [CSS]: quelle([".a {", "  color: red;", "}", "/* Fehlerfarbe der Rückkehr-Meldung */", ".b {", "  color: blue;", "}"]),
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /apps\/web\/src\/styles\/app\.css:4 neuer Kommentar/);
});

test("neue-kommentare: ein neuer mehrzeiliger CSS-Kommentar meldet jede neue Zeile", (context) => {
  const lauf = nachher(basisRepo(context), {
    [CSS]: quelle([".a {", "  color: red;", "}", "/* erste Zeile", "   zweite Zeile */"]),
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /app\.css:4 neuer Kommentar/);
  assert.match(lauf.output, /app\.css:5 neuer Kommentar/);
});

test("neue-kommentare: ein neuer HTML-Kommentar in einer Seite ist rot", (context) => {
  const lauf = nachher(basisRepo(context), {
    [HTML]: quelle(["<!doctype html>", "<!-- Hinweis für Betreuer -->", "<p>eins</p>"]),
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /probe\.html:2 neuer Kommentar/);
});

test("neue-kommentare: ein neuer HTML-Kommentar im Markup einer Astro-Seite ist rot", (context) => {
  const lauf = nachher(basisRepo(context), {
    [SEITE]: quelle(["---", 'const titel = "Start";', "---", "<!-- Überschrift -->", "<h1>{titel}</h1>"]),
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /index\.astro:4 neuer Kommentar/);
});

test("neue-kommentare: ein neuer CSS-Kommentar im style-Block einer Astro-Seite ist rot", (context) => {
  const lauf = nachher(basisRepo(context), {
    [SEITE]: quelle(["---", 'const titel = "Start";', "---", "<h1>{titel}</h1>", "<style>", "  /* Abstand */", "  h1 { margin: 0; }", "</style>"]),
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /index\.astro:6 neuer Kommentar/);
});

test("neue-kommentare: ein neuer Kommentar ist auch dann rot, wenn derselbe Text schon in der Basislinie steht", (context) => {
  const repo = basisRepo(context, { [BESTAND]: bestandsDatei([befundSchluessel(CSS, " alt ")]) });
  const lauf = nachher(repo, { [CSS]: quelle([".a {", "  color: red;", "}", "/* alt */"]) });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /app\.css:4 neuer Kommentar/);
});

test("neue-kommentare: ein bestehender CSS- und HTML-Kommentar, neben dem Code ohne Kommentar dazukommt, bleibt grün", (context) => {
  const repo = basisRepo(context, {
    [CSS]: quelle(["/* alt */", ".a {", "  color: red;", "}"]),
    [HTML]: quelle(["<!doctype html>", "<!-- alt -->", "<p>eins</p>"]),
  });
  const lauf = nachher(repo, {
    [CSS]: quelle(["/* alt */", ".a {", "  color: red;", "}", ".b {", "  color: blue;", "}"]),
    [HTML]: quelle(["<!doctype html>", "<!-- alt -->", "<p>eins</p>", "<p>zwei</p>"]),
  });
  assert.equal(lauf.status, EXIT_OK, lauf.output);
});

test("neue-kommentare: Kommentarzeichen in einer CSS-Zeichenkette, in url(), in einem Skript und im Kopf einer Astro-Seite zählen nicht als Kommentar", (context) => {
  const lauf = nachher(basisRepo(context), {
    [SEITE]: quelle(["---", 'const hinweis = "<!-- kein Kommentar -->";', "---", "<h1>{hinweis}</h1>"]),
    [CSS]: quelle([".a {", '  content: "/* kein Kommentar */";', "  background: url(bild/*x*/.png);", "}"]),
    [HTML]: quelle(["<!doctype html>", "<p>eins</p>", '<script>const text = "<!-- kein Kommentar -->";</script>']),
  });
  assert.equal(lauf.status, EXIT_OK, lauf.output);
});
