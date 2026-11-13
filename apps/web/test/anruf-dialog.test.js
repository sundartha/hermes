import { test } from "node:test";
import assert from "node:assert/strict";

import { turnTimeLabel } from "../src/lib/api.js";
import { fillCallModal } from "../src/lib/render.js";
import { withLang } from "./lang-helper.js";

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.className = "";
    this.textContent = "";
    this.children = [];
    this.hidden = false;
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  setAttribute() {}
  allText() {
    if (this.hidden) return "";
    return this.textContent + this.children.map((child) => child.allText()).join("");
  }
  find(name) {
    if (this.className.split(" ").includes(name)) return this;
    for (const child of this.children) {
      const hit = child.find(name);
      if (hit) return hit;
    }
    return undefined;
  }
}

const fakeDocument = { createElement: (tag) => new FakeElement(tag) };

const ROLLEN_IM_WECHSEL = ["agent", "caller"];
const ZEIT_A = "2026-06-23T09:00:05.000Z";
const ZEIT_B = "2026-06-23T09:01:10.000Z";
const ZEIT_C = "2026-06-23T09:02:30.000Z";
const IMPORTZEIT = "2026-06-23T09:04:00.000Z";
const IMPORT_UEBER_MINUTENGRENZE = ["2026-06-23T09:03:59.500Z", "2026-06-23T09:04:00.200Z", "2026-06-23T09:04:00.900Z"];
const KURZES_ECHTES_GESPRAECH = ["2026-06-23T09:00:05.000Z", "2026-06-23T09:00:20.000Z", "2026-06-23T09:00:40.000Z"];

function modalZiele() {
  return {
    directionEl: fakeDocument.createElement("span"),
    contactEl: fakeDocument.createElement("div"),
    summaryEl: fakeDocument.createElement("div"),
    transcriptEl: fakeDocument.createElement("div"),
  };
}

function beitrag(at, index) {
  return { role: ROLLEN_IM_WECHSEL[index % ROLLEN_IM_WECHSEL.length], text: `Beitrag ${index + 1}`, at };
}

function anrufMitDialog(zeiten, status = "completed") {
  return { direction: "outbound", to: "+491", status, summary: "Termin bestaetigt", transcript: zeiten.map(beitrag) };
}

function blasen(ziele) {
  return ziele.transcriptEl.find("chat-log").children;
}

function feldJeBlase(ziele, klasse) {
  return blasen(ziele).map((blase) => blase.find(klasse)?.textContent ?? null);
}

function leerText(ziele) {
  return ziele.transcriptEl.find("call-modal__empty").textContent;
}

test("Dialog: alle Beitraege in Originalreihenfolge mit Sprecher Hermes/Other party und Uhrzeit, Summary oben", () => {
  const zeiten = [ZEIT_A, ZEIT_B, ZEIT_C];
  const ziele = modalZiele();
  fillCallModal(fakeDocument, ziele, anrufMitDialog(zeiten));
  assert.deepEqual(feldJeBlase(ziele, "chat-bubble__text"), ["Beitrag 1", "Beitrag 2", "Beitrag 3"]);
  assert.deepEqual(feldJeBlase(ziele, "chat-bubble__role"), ["Hermes", "Other party", "Hermes"]);
  assert.deepEqual(feldJeBlase(ziele, "chat-bubble__time"), zeiten.map((at) => turnTimeLabel({ at })));
  assert.equal(ziele.summaryEl.hidden, false);
  assert.ok(ziele.summaryEl.allText().includes("Termin bestaetigt"));
});

test("Dialog DE: Sprecher heissen Hermes und Gegenüber", () => {
  withLang("de", () => {
    const ziele = modalZiele();
    fillCallModal(fakeDocument, ziele, anrufMitDialog([ZEIT_A, ZEIT_B]));
    assert.deepEqual(feldJeBlase(ziele, "chat-bubble__role"), ["Hermes", "Gegenüber"]);
  });
});

test("Dialog: liegen alle Beitraege innerhalb von 2 Sekunden (nachtraeglicher Import), zeigt keiner eine Uhrzeit", () => {
  const gleich = modalZiele();
  fillCallModal(fakeDocument, gleich, anrufMitDialog([IMPORTZEIT, IMPORTZEIT, IMPORTZEIT]));
  assert.deepEqual(feldJeBlase(gleich, "chat-bubble__time"), [null, null, null]);

  const grenze = modalZiele();
  fillCallModal(fakeDocument, grenze, anrufMitDialog(IMPORT_UEBER_MINUTENGRENZE));
  assert.deepEqual(feldJeBlase(grenze, "chat-bubble__time"), [null, null, null]);
});

test("Dialog: ein echtes Gespraech innerhalb einer Minute behaelt seine Uhrzeiten", () => {
  const ziele = modalZiele();
  fillCallModal(fakeDocument, ziele, anrufMitDialog(KURZES_ECHTES_GESPRAECH));
  assert.deepEqual(
    feldJeBlase(ziele, "chat-bubble__time"),
    KURZES_ECHTES_GESPRAECH.map((at) => turnTimeLabel({ at })),
  );
});

test("Dialog: ein einzelner Beitrag behaelt seine Uhrzeit", () => {
  const ziele = modalZiele();
  fillCallModal(fakeDocument, ziele, anrufMitDialog([IMPORTZEIT]));
  assert.deepEqual(feldJeBlase(ziele, "chat-bubble__time"), [turnTimeLabel({ at: IMPORTZEIT })]);
});

test("Dialog: laufender Anruf ohne Beitraege sagt, dass das Gespraech noch laeuft, nicht 'geloescht'", () => {
  const ziele = modalZiele();
  fillCallModal(fakeDocument, ziele, anrufMitDialog([], "active"));
  assert.equal(leerText(ziele), "The call is still running. The conversation appears here after the call.");
  withLang("de", () => {
    const de = modalZiele();
    fillCallModal(fakeDocument, de, anrufMitDialog([], "active"));
    assert.equal(leerText(de), "Das Gespräch läuft noch. Der Verlauf erscheint nach dem Gespräch.");
  });
});

test("Dialog: beendeter Anruf ohne Verlauf nennt die 30-Tage-Loeschung (EN/DE)", () => {
  const ziele = modalZiele();
  fillCallModal(fakeDocument, ziele, anrufMitDialog([]));
  assert.equal(leerText(ziele), "Conversation no longer available (deleted after 30 days)");
  withLang("de", () => {
    const de = modalZiele();
    fillCallModal(fakeDocument, de, anrufMitDialog([]));
    assert.equal(leerText(de), "Gesprächsverlauf nicht mehr verfügbar (wird nach 30 Tagen gelöscht)");
  });
});

test("Dialog: fehlgeschlagener oder abgebrochener Anruf sagt, dass kein Gespraech zustande kam, nicht 'geloescht'", () => {
  for (const status of ["failed", "cancelled", "unbekannt"]) {
    const ziele = modalZiele();
    fillCallModal(fakeDocument, ziele, anrufMitDialog([], status));
    assert.equal(leerText(ziele), "No conversation took place.");
    withLang("de", () => {
      const de = modalZiele();
      fillCallModal(fakeDocument, de, anrufMitDialog([], status));
      assert.equal(leerText(de), "Es kam kein Gespräch zustande.");
    });
  }
});
