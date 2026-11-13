import { mitAnruffolge } from "./widget-anruffolge-attrappe.mjs";

const TEXT_ZEICHEN = 40;
const TOLERANZ_PX = 1;
const DEZIMALEN = 10;

export function leseUeberlauf(doc, { maxZeichen, toleranz, dezimalen }) {
  const runde = (wert) => Math.round(wert * dezimalen) / dezimalen;
  const karte = doc.querySelector(".w") || doc.querySelector(".card") || doc.body;
  const rahmen = karte.getBoundingClientRect();
  const sichtbar = (el) => el.getClientRects().length > 0 && !el.closest("svg, canvas, .slot-hidden, .szene");
  const text = (el) => (el ? el.textContent.trim() : "");
  const klasse = (el) => el.getAttribute("class") || el.tagName.toLowerCase();
  const treffer = [];
  for (const el of karte.querySelectorAll("*")) {
    if (!sichtbar(el)) continue;
    const box = el.getBoundingClientRect();
    const ueberRand = Math.max(box.right - rahmen.right, rahmen.left - box.left, box.bottom - rahmen.bottom, rahmen.top - box.top, 0);
    const innen = el.scrollWidth - el.clientWidth;
    if (ueberRand > 0 || innen > toleranz) treffer.push({ klasse: klasse(el), text: text(el).slice(0, maxZeichen), ueberstand_px: runde(Math.max(ueberRand, innen)) });
  }
  const zeilen = [...karte.querySelectorAll(".row, .zeile")]
    .filter((zeile) => zeile.getClientRects().length > 0)
    .map((zeile) => ({ label: text(zeile.querySelector(".row-k") || zeile.firstElementChild), wert: text(zeile.querySelector(".row-v") || zeile.lastElementChild) }));
  const ring = doc.querySelector("[data-ring]");
  return { lang: doc.documentElement.lang, ring_overflow: ring ? doc.defaultView.getComputedStyle(ring).overflow : null, karte_breite_px: runde(rahmen.width), treffer, zeilen };
}

const LESE_AUSDRUCK = `(${leseUeberlauf.toString()})(document.getElementById("f").contentDocument, { maxZeichen: ${TEXT_ZEICHEN}, toleranz: ${TOLERANZ_PX}, dezimalen: ${DEZIMALEN} })`;

export function messeUeberlauf(chrome, html, { szenario: wahl, tempo = 1 }) {
  return mitAnruffolge(chrome, html, { szenario: wahl, tempo, lies: async (_meldung, { send, sessionId, szenario }) => {
    const { result } = await send("Runtime.evaluate", { expression: LESE_AUSDRUCK, returnByValue: true }, sessionId);
    return { szenario: typeof wahl === "string" ? wahl : "eigenes", breite_px: szenario.breite, ...result.value };
  } });
}
