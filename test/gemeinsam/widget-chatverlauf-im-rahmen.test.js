import { test } from "node:test";
import assert from "node:assert/strict";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";
import { mitAnruffolge } from "./widget-anruffolge-attrappe.mjs";

const chrome = findChrome();
const OPTIONS = { skip: chrome ? false : "kein Chromium gefunden (CHROME_BIN setzen)", timeout: 180000 };
const BREITEN = [280, 598];
const SPRACHEN = ["de", "fr", "en"];
const TEMPO = 0.05;
const RAND_TOLERANZ = 0.5;
const KARTE_MAX_PX = 760;
const CHAT_HOEHE_PX = 240;
const LANGE_TURNS = 200;
const WORT = {
  de: "Haftpflichtversicherungsvertragsänderung",
  fr: "Désinstitutionnalisationsadministratives",
  en: "Antidisestablishmentarianismsubcontracts",
};
const WIDGET = (await ausgelieferteWidgets()).call;

function turns(sprache, anzahl) {
  return Array.from({ length: anzahl }, (_, i) => ({
    role: i % 2 === 0 ? "agent" : "counterparty",
    text: `${WORT[sprache]} ${"Termin ".repeat(i % 7)}${i}`,
  }));
}

function mitTranskript(transcript) {
  const einspeisung = `<script>window.addEventListener("message",function(e){var m=e.data;if(m&&m.result&&m.result.structuredContent&&"result_summary" in m.result.structuredContent){m.result._meta=Object.assign({},m.result._meta,{transcript:${JSON.stringify(transcript)}})}})</script>`;
  return WIDGET.replace("<head>", () => "<head>" + einspeisung);
}

const MESSUNG = `(() => {
  const doc = document.getElementById("f").contentDocument;
  const kasten = (el) => { const r = el.getBoundingClientRect(); return { links: r.left, rechts: r.right, hoehe: r.height }; };
  const chat = doc.querySelector("[data-chat]");
  const blasen = [...chat.children].map((blase) => ({ kasten: kasten(blase), abgeschnitten: blase.scrollWidth > blase.clientWidth, text: blase.textContent }));
  return JSON.stringify({
    karte: kasten(doc.querySelector(".w")),
    chat: { ...kasten(chat), scrollHoehe: chat.scrollHeight, sichtbar: doc.querySelector('[data-row="chat"]').style.display !== "none" },
    blasen,
    seitenbreite: doc.documentElement.scrollWidth,
    rahmenbreite: document.getElementById("f").getBoundingClientRect().width,
  });
})()`;

function szenario(sprache, breite) {
  return {
    locale: sprache,
    inhaltssprache: sprache,
    erwartet: sprache,
    breite,
    waehlenS: 1,
    gespraechS: 1,
    zeilen: [],
    ergebnis: { status: "completed", failure_reason: null, objective_achieved: true, result_summary: "Termin gebucht." },
  };
}

function messe(sprache, breite, anzahl) {
  const lies = async (_meldung, { send, sessionId }) => {
    const { result } = await send("Runtime.evaluate", { expression: MESSUNG, returnByValue: true }, sessionId);
    return JSON.parse(result.value);
  };
  return mitAnruffolge(chrome, mitTranskript(turns(sprache, anzahl)), { szenario: szenario(sprache, breite), tempo: TEMPO, lies });
}

for (const sprache of SPRACHEN) {
  for (const breite of BREITEN) {
    test(`Chatverlauf im Rahmen ${sprache} ${breite}px: 200 Turns mit langen Woertern, feste Hoehe, nichts ragt heraus, Kartenhoehe wie mit 3 Turns`, OPTIONS, async () => {
      const lang = await messe(sprache, breite, LANGE_TURNS);
      const kurz = await messe(sprache, breite, 3);
      assert.equal(lang.chat.sichtbar, true);
      assert.equal(lang.blasen.length, LANGE_TURNS);
      assert.equal(lang.chat.hoehe, CHAT_HOEHE_PX);
      assert.ok(lang.chat.scrollHoehe > CHAT_HOEHE_PX, "scrollt intern");
      assert.equal(lang.karte.hoehe, kurz.karte.hoehe);
      assert.ok(lang.karte.hoehe <= KARTE_MAX_PX);
      assert.ok(lang.seitenbreite <= lang.rahmenbreite, "kein waagerechter Ueberlauf der Seite");
      assert.equal(kurz.chat.hoehe, CHAT_HOEHE_PX);
      for (const blase of lang.blasen) {
        assert.ok(blase.kasten.rechts <= lang.chat.rechts + RAND_TOLERANZ, "Blase ragt rechts heraus");
        assert.ok(blase.kasten.links >= lang.chat.links - RAND_TOLERANZ, "Blase ragt links heraus");
        assert.equal(blase.abgeschnitten, false);
        assert.ok(blase.text.includes(WORT[sprache]));
      }
    });
  }
}

test("Chatverlauf im Rahmen: Hermes sitzt links, das Gegenueber rechts", OPTIONS, async () => {
  const messung = await messe("de", 598, 4);
  const mitte = (messung.chat.links + messung.chat.rechts) / 2;
  messung.blasen.forEach((blase, i) => {
    const blasenMitte = (blase.kasten.links + blase.kasten.rechts) / 2;
    if (i % 2 === 0) assert.ok(blasenMitte < mitte, "Hermes links " + i);
    else assert.ok(blasenMitte > mitte, "Gegenueber rechts " + i);
  });
});
