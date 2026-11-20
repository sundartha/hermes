import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const ANRUF = (await ausgelieferteWidgets()).call;
const ERGEBNIS = "ui/notifications/tool-result";

function knoten() {
  return {
    className: "",
    style: {},
    attribute: {},
    text: "",
    get textContent() {
      return this.text;
    },
    set textContent(wert) {
      this.text = wert;
    },
    setAttribute(name, wert) {
      this.attribute[name] = wert;
    },
    removeAttribute(name) {
      delete this.attribute[name];
    },
    addEventListener() {},
  };
}

function karte() {
  const knoten_je_wahl = new Map();
  const hole = (sel) => {
    if (!knoten_je_wahl.has(sel)) knoten_je_wahl.set(sel, knoten());
    return knoten_je_wahl.get(sel);
  };
  hole(".w").className = "w";
  const hoerer = [];
  const gesendet = [];
  const fenster = {
    document: { querySelector: hole },
    addEventListener: (art, f) => hoerer.push({ art, f }),
    parent: { postMessage: (nachricht) => gesendet.push(nachricht.params) },
    __hermesUiReady: true,
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
  };
  fenster.window = fenster;
  vm.runInContext(skriptbloecke(ANRUF).filter((s) => s.includes("TOOL_GET_STATUS")).at(-1), vm.createContext(fenster));
  const schicke = (inhalt) => hoerer.filter((h) => h.art === "message").forEach((h) => h.f({ data: { method: ERGEBNIS, params: { structuredContent: { call_id: "c1", ...inhalt } } } }));
  return { hole, schicke };
}

const TABELLE = [
  ["Berlin", "+493012345678", "+49 30 12345678"],
  ["Hamburg", "+49401234567", "+49 40 1234567"],
  ["Frankfurt", "+496912345678", "+49 69 12345678"],
  ["Muenchen", "+498912345678", "+49 89 12345678"],
  ["Mobil 151", "+4915112345678", "+49 151 12345678"],
  ["Mobil 160", "+4916012345678", "+49 160 12345678"],
  ["Mobil 179", "+4917912345678", "+49 179 12345678"],
  ["Koeln, Vorwahllaenge unbekannt", "+492211234567", "+492211234567"],
  ["Nummer ohne Rest nach der Vorwahl", "+4930123", "+4930123"],
  ["Ausland", "+14155550123", "+14155550123"],
  ["Oesterreich", "+43151234567", "+43151234567"],
];

for (const [name, roh, erwartet] of TABELLE) {
  test("widget-nummer-gliederung: " + name + " erscheint als " + erwartet + " in der Nummernanzeige", () => {
    const s = karte();
    s.schicke({ status: "dialing", to: roh });
    assert.equal(s.hole("[data-number-display]").text, erwartet);
  });
}
