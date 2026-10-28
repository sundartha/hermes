import test, { after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formBefunde } from "../../tools/auftrag/musterpruefung.mjs";
import {
  EXIT_AUFRUF,
  EXIT_OK,
  EXIT_VORHANDEN,
  REPO,
  frischeWurzel,
  lesen,
  neu,
  raeumeWurzelnAuf,
} from "./neu-hilfen.js";

const EINZEL_HANDLER = join(REPO, "test/werkzeuge/fixtures-neu/intern-anrufpause.txt");

function zeilenOhneKomma(text) {
  return text.split("\n").map((zeile) => zeile.replace(/,$/, ""));
}

function hinzugekommeneZeilen(vorher, nachher) {
  const uebrig = zeilenOhneKomma(vorher);
  const neue = [];
  for (const zeile of zeilenOhneKomma(nachher)) {
    const stelle = uebrig.indexOf(zeile);
    if (stelle === -1) neue.push(zeile);
    else uebrig.splice(stelle, 1);
  }
  return { neue, entfallen: uebrig };
}

after(raeumeWurzelnAuf);

test("neu route legt Router, Test und genau einen Karteneintrag an", () => {
  const wurzel = frischeWurzel("neu-route-fachdatei-");
  const vorher = lesen(wurzel, "tools/bausteine.json");
  const lauf = neu(wurzel, "route", "betrieb", "beispiel-route");
  assert.equal(lauf.status, EXIT_OK, "npm run neu legt keine Route an: " + lauf.stderr);
  const quelle = lesen(wurzel, "src/routes/beispiel-route.js");
  assert.match(quelle, /^export function makeBeispielRouteRoutes\(\{/m);
  assert.match(quelle, /router\.post\("\/api\/beispiel-route", internalOnly,/);
  const pruefung = lesen(wurzel, "test/gemeinsam/beispiel-route.test.js");
  assert.match(pruefung, /from "\.\.\/\.\.\/src\/routes\/beispiel-route\.js"/);
  const { neue, entfallen } = hinzugekommeneZeilen(vorher, lesen(wurzel, "tools/bausteine.json"));
  assert.deepEqual(neue, ['        "src/routes/beispiel-route.js"']);
  assert.deepEqual(entfallen, []);
  assert.match(lauf.stdout, /src\/app\.js/);
});

test("neu route lehnt einen Baustein ab, der anmeldung nicht nutzen darf", () => {
  const wurzel = frischeWurzel("neu-route-fachdatei-");
  const vorher = lesen(wurzel, "tools/bausteine.json");
  const lauf = neu(wurzel, "route", "posteingang", "beispiel-route");
  assert.equal(lauf.status, EXIT_AUFRUF, lauf.stderr);
  assert.match(lauf.stderr, /anmeldung/);
  assert.equal(existsSync(join(wurzel, "src/routes/beispiel-route.js")), false);
  assert.equal(lesen(wurzel, "tools/bausteine.json"), vorher);
});

test("neu route überschreibt nichts und lässt die Karte unverändert", () => {
  const wurzel = frischeWurzel("neu-route-fachdatei-");
  mkdirSync(join(wurzel, "src/routes"), { recursive: true });
  writeFileSync(join(wurzel, "src/routes/beispiel-route.js"), "meine Arbeit\n");
  const vorher = lesen(wurzel, "tools/bausteine.json");
  const lauf = neu(wurzel, "route", "betrieb", "beispiel-route");
  assert.equal(lauf.status, EXIT_VORHANDEN);
  assert.equal(lesen(wurzel, "src/routes/beispiel-route.js"), "meine Arbeit\n");
  assert.equal(lesen(wurzel, "tools/bausteine.json"), vorher);
});

test("neu fachdatei legt eine reine Funktion, den Tabellentest und einen fachlogik-Eintrag an", () => {
  const wurzel = frischeWurzel("neu-route-fachdatei-");
  const vorher = lesen(wurzel, "tools/bereiche.json");
  const lauf = neu(wurzel, "fachdatei", "rueckfrage", "tabellen-hilfe");
  assert.equal(lauf.status, EXIT_OK, "npm run neu legt keine Fachdatei an: " + lauf.stderr);
  const quelle = lesen(wurzel, "src/consult/tabellen-hilfe.js");
  assert.match(quelle, /^export function tabellenHilfe\(/m);
  assert.doesNotMatch(quelle, /\bimport\b/);
  const pruefung = lesen(wurzel, "test/rueckfrage/tabellen-hilfe.test.js");
  assert.match(pruefung, /from "\.\.\/\.\.\/src\/consult\/tabellen-hilfe\.js"/);
  const { neue, entfallen } = hinzugekommeneZeilen(vorher, lesen(wurzel, "tools/bereiche.json"));
  assert.equal(neue.length, 1);
  assert.equal(entfallen.length, 1);
  const alt = JSON.parse(`{${entfallen[0]}}`).fachlogik;
  const eintraege = JSON.parse(`{${neue[0]}}`).fachlogik;
  assert.deepEqual(eintraege.slice(0, alt.length), alt);
  assert.equal(eintraege.length, alt.length + 1);
  const eintrag = eintraege.at(-1);
  assert.equal(new RegExp(eintrag).test("src/consult/tabellen-hilfe.js"), true);
  assert.equal(new RegExp(eintrag).test("src/consult/andere-datei.js"), false);
});

test("neu fachdatei lehnt einen Baustein ohne Ordner und einen unbekannten Baustein ab", () => {
  const wurzel = frischeWurzel("neu-route-fachdatei-");
  const vorher = lesen(wurzel, "tools/bereiche.json");
  assert.equal(neu(wurzel, "fachdatei", "mail", "tabellen-hilfe").status, EXIT_AUFRUF);
  assert.equal(neu(wurzel, "fachdatei", "gibt-es-nicht", "tabellen-hilfe").status, EXIT_AUFRUF);
  assert.equal(existsSync(join(wurzel, "src")), false);
  assert.equal(lesen(wurzel, "tools/bereiche.json"), vorher);
});

test("Rot-Probe intern-anrufpause: der Einzel-Handler besteht die Router-Form nicht, die erzeugte Route schon", () => {
  const wurzel = frischeWurzel("neu-route-fachdatei-");
  const muster = {
    bau: [{ art: "Route", datei: "src/routes/intern-anrufpause.js", form: "router" }],
    test: [],
  };
  mkdirSync(join(wurzel, "tools/auftrag"), { recursive: true });
  writeFileSync(join(wurzel, "tools/auftrag/musterdateien.json"), JSON.stringify(muster));
  mkdirSync(join(wurzel, "src/routes"), { recursive: true });
  cpSync(EINZEL_HANDLER, join(wurzel, "src/routes/intern-anrufpause.js"));
  assert.equal(formBefunde(wurzel).length, 1);
  rmSync(join(wurzel, "src/routes/intern-anrufpause.js"));
  const lauf = neu(wurzel, "route", "betrieb", "intern-anrufpause");
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.match(lesen(wurzel, "src/routes/intern-anrufpause.js"), /makeInternAnrufpauseRoutes/);
  assert.deepEqual(formBefunde(wurzel), []);
});

test("neu fachdatei lehnt einen Namen ab, der ein reserviertes Wort ergibt, und legt nichts an", () => {
  const wurzel = frischeWurzel("neu-reserviert-");
  const vorher = lesen(wurzel, "tools/bereiche.json");
  for (const name of ["class", "if", "default"]) {
    const lauf = neu(wurzel, "fachdatei", "rueckfrage", name);
    assert.equal(lauf.status, EXIT_AUFRUF, lauf.stderr);
    assert.match(lauf.stderr, /reserviert/);
  }
  assert.equal(existsSync(join(wurzel, "src")), false);
  assert.equal(lesen(wurzel, "tools/bereiche.json"), vorher);
});
