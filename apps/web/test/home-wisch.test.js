import { test } from "node:test";
import assert from "node:assert/strict";
import { swipeStartsOnPage, swipeTarget } from "../src/lib/section-nav.js";

const VIEW = 714;
const tops = (pages) => pages.map((page) => page.top);
const STARTS = tops([{ top: 0 }, { top: 714 }, { top: 1428 }, { top: 2142 }, { top: 2856 }, { top: 3570 }, { top: 4284 }]);
const TALL_SECOND_PAGE = tops([{ top: 0 }, { top: 714 }, { top: 2142 }, { top: 2856 }]);
const UNSORTED_DOUBLED = tops([{ top: 1428 }, { top: 0 }, { top: 714 }, { top: 714 }, { top: 2142 }]);
const PAGE = { starts: STARTS, view: VIEW, max: 4284 };

test("Startseite mobil: ein leichter Wisch fuehrt zur Nachbarseite", () => {
  const cases = [
    { name: "kurzer Wisch von Seite 1, Seite hat sich noch nicht bewegt", from: 0, moved: 30, scrollTop: 0, expected: 714 },
    { name: "langsames Ziehen von Seite 1, losgelassen bei 65", from: 0, moved: 80, scrollTop: 65, expected: 714 },
    { name: "Wisch ueber die halbe Seite hinaus", from: 714, moved: 500, scrollTop: 1200, expected: 1428 },
    { name: "kurzer Wisch von Seite 3 nach oben", from: 1428, moved: -30, scrollTop: 1400, expected: 714 },
    { name: "kurzer Wisch auf die letzte Seite", from: 3570, moved: 30, scrollTop: 3600, expected: 4284 },
    { name: "Sichtbereich so hoch wie die Seite", from: 714, moved: 50, scrollTop: 760, view: 754, expected: 1428 },
  ];
  for (const { name, expected, ...swipe } of cases) {
    assert.equal(swipeTarget({ ...PAGE, ...swipe }), expected, name);
  }
});

test("Startseite mobil: der Wisch-Helfer greift nicht ein, wo er nichts zu suchen hat", () => {
  const cases = [
    { name: "Finger kaum bewegt", from: 714, moved: 4, scrollTop: 718 },
    { name: "hin und zurueck gezogen", from: 714, moved: 0, scrollTop: 714 },
    { name: "nach oben am Seitenanfang", from: 0, moved: -60, scrollTop: -60 },
    { name: "nach unten am Seitenende", from: 4284, moved: 56, scrollTop: 4340 },
    { name: "Beruehrung mitten in einer laufenden Bewegung", from: 300, moved: 80, scrollTop: 380 },
    { name: "Seite hoeher als der Bildschirm: frei scrollen", from: 714, moved: 90, scrollTop: 800, starts: TALL_SECOND_PAGE, max: 2856 },
    { name: "letzte Seite hoeher als der Bildschirm", from: 4284, moved: -34, scrollTop: 4250, max: 5200 },
    { name: "kein Sichtbereich", from: 0, moved: 60, scrollTop: 60, view: 0 },
  ];
  for (const { name, ...swipe } of cases) {
    assert.equal(swipeTarget({ ...PAGE, ...swipe }), null, name);
  }
});

test("Startseite mobil: der Wisch-Helfer kommt mit ungeordneten und doppelten Seitenanfaengen zurecht", () => {
  const page = { starts: UNSORTED_DOUBLED, view: VIEW, max: 2142, from: 714 };
  assert.equal(swipeTarget({ ...page, moved: 26, scrollTop: 740 }), Math.max(...UNSORTED_DOUBLED.filter((top) => top < page.max)));
  assert.equal(swipeTarget({ ...page, moved: -24, scrollTop: 690 }), 0);
});

test("Startseite mobil: der Wisch-Helfer startet nur auf einer eingerasteten, passenden Seite", () => {
  assert.equal(swipeStartsOnPage({ ...PAGE, from: 714 }), true);
  assert.equal(swipeStartsOnPage({ ...PAGE, from: 300 }), false);
  assert.equal(swipeStartsOnPage({ ...PAGE, from: 714, starts: TALL_SECOND_PAGE, max: 2856 }), false);
});
