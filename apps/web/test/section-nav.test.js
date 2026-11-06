import { test } from "node:test";
import assert from "node:assert/strict";
import { keyDirection, sectionTarget } from "../src/lib/section-nav.js";

const VIEW = 900;
const PAGE = { view: VIEW, max: 5400 };
const SECTIONS = [{ top: 0 }, { top: 900 }, { top: 1800 }, { top: 2700 }, { top: 3900 }, { top: 4800 }];
const STARTS = SECTIONS.map((section) => section.top);

test("Startseite: Tasten fuer sektionsweises Scrollen", () => {
  const cases = [
    { key: " ", shift: false, expected: 1 },
    { key: " ", shift: true, expected: -1 },
    { key: "PageDown", shift: false, expected: 1 },
    { key: "PageUp", shift: false, expected: -1 },
    { key: "ArrowDown", shift: false, expected: 1 },
    { key: "ArrowUp", shift: false, expected: -1 },
    { key: "Home", shift: false, expected: 0 },
    { key: "Tab", shift: false, expected: 0 },
    { key: "a", shift: false, expected: 0 },
  ];
  for (const { key, shift, expected } of cases) {
    assert.equal(keyDirection(key, shift), expected, `${JSON.stringify(key)} shift=${shift}`);
  }
});

test("Startseite: naechster Sektionsanfang je Position und Richtung", () => {
  const cases = [
    { name: "Hero nach unten: Anfang der Idee", from: 0, direction: 1, expected: 900 },
    { name: "Idee nach unten: Anwendungsfaelle", from: 900, direction: 1, expected: 1800 },
    { name: "knapp neben dem Anfang zaehlt als Anfang", from: 901, direction: 1, expected: 1800 },
    { name: "hohe Sektion: erst der Rest der Sektion", from: 2700, direction: 1, expected: 3000 },
    { name: "Rest kleiner als ein Bildschirm: genau bis zum Sektionsende", from: 3000, direction: 1, expected: 3900 },
    { name: "Sektion nur wenige Pixel zu hoch: direkt zur naechsten", from: 900, direction: 1, view: 870, expected: 1800 },
    { name: "Abschluss nach unten: Seitenende mit Fuss", from: 4800, direction: 1, expected: 5400 },
    { name: "am Seitenende nach unten: nichts tun", from: 5400, direction: 1, expected: null },
    { name: "Anfang Preise nach oben: vorige Sektion", from: 1800, direction: -1, expected: 900 },
    { name: "mitten in hoher Sektion nach oben: deren Anfang", from: 3000, direction: -1, expected: 2700 },
    { name: "Seitenende nach oben: Anfang Abschluss", from: 5400, direction: -1, expected: 4800 },
    { name: "ganz oben nach oben: nichts tun", from: 0, direction: -1, expected: null },
    { name: "ohne Richtung: nichts tun", from: 900, direction: 0, expected: null },
  ];
  for (const { name, from, direction, expected, view = PAGE.view } of cases) {
    assert.equal(sectionTarget({ starts: STARTS, scrollTop: from, view, max: PAGE.max, direction }), expected, name);
  }
});

test("Startseite: lange Sektion wird nie uebersprungen, auch weit unter dem Anfang", () => {
  const page = { starts: [{ top: 0 }, { top: 900 }, { top: 4000 }].map((section) => section.top), max: 4500 };
  const steps = [
    { from: 900, to: 1665 },
    { from: 1665, to: 2430 },
    { from: 2430, to: 3100 },
    { from: 3100, to: 4000 },
    { from: 4000, to: 4500 },
    { from: 4500, to: null },
  ];
  for (const { from, to } of steps) {
    const next = sectionTarget({ starts: page.starts, scrollTop: from, view: VIEW, max: page.max, direction: 1 });
    assert.equal(next, to, `von ${from}`);
    if (next !== null) assert.ok(next - from <= VIEW, `Sprung ${from} -> ${next} groesser als ein Bildschirm`);
  }
});
