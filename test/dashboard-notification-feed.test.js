// OUTBOUND-E3a (F2a, L8): der Benachrichtigungs-Feed lag laengst in beiden state-
// Antworten, wurde aber von KEINER Zeile im Frontend gerendert - reine Frontend-Luecke.
// Minimales Fake-Document (Muster apps/web/test/render.test.js), importiert
// ../apps/web/src/lib/render.js direkt (Praezedenz: test/dashboard-i18n-surface.test.js).
// Kein Browser-DOM, kein Netz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationRows } from "../apps/web/src/lib/render.js";

// XSS-Beleg (Leitplanke, Muster apps/web/test/render.test.js#FakeElement): ein
// Schreibzugriff auf innerHTML wirft - belegt, dass der Bau ausschliesslich
// textContent nutzt.
class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.className = "";
    this.textContent = "";
    this.children = [];
  }
  set innerHTML(_value) {
    throw new Error("innerHTML darf nie gesetzt werden (XSS-Schutz, nur textContent)");
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  allText() {
    return this.textContent + this.children.map((child) => child.allText()).join("");
  }
}

const fakeDocument = { createElement: (tag) => new FakeElement(tag) };

// Kind-Anzahl eines Feed-Eintrags: title+body (Bestand) bzw. title+body+time
// (mit `at`) - benannt statt Magic Number (no-magic-numbers).
const CHILDREN_WITHOUT_TIME = 2;
const CHILDREN_WITH_TIME = 3;

// tPair (lib/i18n.js) liest die Sprache ueber getLang() -> localStorage.getItem; Node hat
// von Haus aus keinen globalThis.localStorage (Muster apps/web/test/render.test.js#withLang).
function withLang(lang, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => lang };
  try {
    fn();
  } finally {
    if (had) globalThis.localStorage = original;
    else delete globalThis.localStorage;
  }
}

test("ein Feed-Eintrag rendert title und body als sichtbaren Text", () => {
  const data = { notifications: [{ id: "n1", title: "Anruf nicht zustande gekommen", body: "+12025550143 (Status: failed, Grund: ...)", at: "2026-08-27T10:00:00.000Z", callId: "call_1" }] };

  const rows = notificationRows(fakeDocument, data);

  assert.equal(rows.length, 1);
  assert.match(rows[0].allText(), /Anruf nicht zustande gekommen/);
  assert.match(rows[0].allText(), /\+12025550143/);
});

test("leerer Feed zeigt eine Leer-Zeile in DE und EN", () => {
  withLang("en", () => {
    const rows = notificationRows(fakeDocument, { notifications: [] });
    assert.equal(rows.length, 1);
    assert.match(rows[0].allText(), /No messages yet\./);
  });
  withLang("de", () => {
    const rows = notificationRows(fakeDocument, { notifications: [] });
    assert.equal(rows.length, 1);
    assert.match(rows[0].allText(), /Noch keine Meldungen\./);
  });
});

test("XSS-Leitplanke: ein Eintrag mit <script> im body landet ausschliesslich als textContent", () => {
  const data = {
    notifications: [{ id: "n2", title: "Titel", body: "<script>alert(1)</script>", callId: "call_2" }],
  };

  // Wirft NICHT (innerHTML wird nie beruehrt) - der Bau setzt body ueber el() -> textContent.
  const rows = notificationRows(fakeDocument, data);
  const [row] = rows;
  const bodyNode = row.children[1];

  assert.equal(rows.length, 1);
  assert.equal(bodyNode.textContent, "<script>alert(1)</script>");
});

test("fehlender/kaputter notifications-Wert -> leere Liste statt Absturz (Muster listFrom)", () => {
  assert.equal(notificationRows(fakeDocument, null).length, 1);
  assert.equal(notificationRows(fakeDocument, {}).length, 1);
});

// Fix-Runde 1 (Befund G2): ein Eintrag MIT gueltigem `at` bekommt eine dritte
// Zeile mit der Uhrzeit (turnTimeLabel-Format HH:MM) - Titel/Rumpf bleiben
// children[0]/children[1] (Praezedenz-Wahrung fuer den XSS-Test oben).
test("ein Feed-Eintrag mit `at` rendert zusaetzlich eine Uhrzeit-Zeile", () => {
  const data = {
    notifications: [
      { id: "n3", title: "Titel", body: "Rumpf", at: "2026-08-27T10:05:00.000Z", callId: "call_3" },
    ],
  };

  const [row] = notificationRows(fakeDocument, data);

  assert.equal(row.children.length, CHILDREN_WITH_TIME);
  assert.equal(row.children[0].className, "notification-row__title");
  assert.equal(row.children[1].className, "notification-row__body");
  assert.equal(row.children[2].className, "notification-row__time");
  // turnTimeLabel rechnet in Ortszeit (kein UTC-Anspruch) - Format statt fester
  // Uhrzeit pruefen, sonst ist der Test zeitzonenabhaengig rot (Muster CI/lokal).
  assert.match(row.children[2].textContent, /^\d{2}:\d{2}$/);
});

// Kein `at` (aeltere/kaputte Eintraege) -> kein erfundener Zeitstempel, nur
// die zwei Bestandskinder (Muster callMetaLabel: kein Anker -> keine Zeile).
test("ein Feed-Eintrag ohne `at` bleibt bei title+body (keine erfundene Uhrzeit)", () => {
  const data = { notifications: [{ id: "n4", title: "Titel", body: "Rumpf", callId: "call_4" }] };

  const [row] = notificationRows(fakeDocument, data);

  assert.equal(row.children.length, CHILDREN_WITHOUT_TIME);
});

// Optischer Smoke-Test (Befund G2, Repo-Header-Verifikation): die drei DOM-
// Klassen aus notificationRows() muessen tatsaechlich gestylt sein, sonst
// laufen Titel/Rumpf im Browser ungestylt/verklebt zusammen. Grep statt CSS-
// Parser (Repo hat keine CSS-Test-Infrastruktur) - reicht, um "Klasse hat
// KEINE Regel" (der urspruengliche Blocker) zuverlaessig rot zu machen.
test("Benachrichtigungs-Feed-Klassen sind in calls.css tatsaechlich gestylt", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(
    new URL("../apps/web/src/styles/app/calls.css", import.meta.url),
    "utf8",
  );

  for (const cls of [".notification-row", ".notification-row__title", ".notification-row__body"]) {
    assert.match(
      css,
      new RegExp(`${cls.replace(/[.]/g, "\\.")}[\\s,{]`),
      `${cls} hat keine CSS-Regel in calls.css`,
    );
  }
});
