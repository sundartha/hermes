import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../src/styles/home.css", import.meta.url), "utf8");

function statueRegelIn(mediaQuery) {
  const media = CSS.indexOf(`${mediaQuery} {`);
  assert.ok(media >= 0, `${mediaQuery} fehlt im Stylesheet`);
  const start = CSS.indexOf(".close .statue {", media);
  assert.ok(start >= 0, `.close .statue fehlt in ${mediaQuery}`);
  return CSS.slice(start, CSS.indexOf("}", start));
}

test("Schlussbild: auf Desktop rückt das Bild um 6 % der Fensterbreite nach links, der Ausschnitt bleibt", () => {
  const desktop = statueRegelIn("@media (min-width: 1001px)");
  assert.match(desktop, /left: -6vw;/);
  assert.match(desktop, /object-position: 42% 22%;/);
});

test("Schlussbild: Tablet und Mobil behalten ihren Bildausschnitt", () => {
  assert.match(statueRegelIn("@media (min-width: 761px) and (max-width: 1000px)"), /object-position: 50% 0%;/);
  assert.match(statueRegelIn("@media (max-width: 760px)"), /object-position: 56% 0%;/);
});
