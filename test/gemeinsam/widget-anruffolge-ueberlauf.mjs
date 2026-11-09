import { connect, launch } from "./widget-ladezeit-messen.mjs";
import { bedieneAnruffolge, CALL_ID, DONE_BINDING, szenarioVon } from "./widget-anruffolge-attrappe.mjs";

const TEXT_ZEICHEN = 40;
const TOLERANZ_PX = 1;
const DEZIMALEN = 10;

export function leseUeberlauf(doc, maxZeichen, toleranz, dezimalen) {
  const runde = (wert) => Math.round(wert * dezimalen) / dezimalen;
  const karte = doc.querySelector(".card") || doc.body;
  const rahmen = karte.getBoundingClientRect();
  const sichtbar = (el) => el.getClientRects().length > 0 && !el.closest("svg, canvas, .slot-hidden");
  const text = (el) => (el ? el.textContent.trim() : "");
  const klasse = (el) => el.getAttribute("class") || el.tagName.toLowerCase();
  const treffer = [];
  for (const el of karte.querySelectorAll("*")) {
    if (!sichtbar(el)) continue;
    const box = el.getBoundingClientRect();
    const ueberRand = Math.max(box.right - rahmen.right, rahmen.left - box.left, 0);
    const innen = el.scrollWidth - el.clientWidth;
    if (ueberRand > 0 || innen > toleranz) treffer.push({ klasse: klasse(el), text: text(el).slice(0, maxZeichen), ueberstand_px: runde(Math.max(ueberRand, innen)) });
  }
  const zeilen = [...karte.querySelectorAll(".row")]
    .filter((zeile) => zeile.getClientRects().length > 0)
    .map((zeile) => ({ label: text(zeile.querySelector(".row-k")), wert: text(zeile.querySelector(".row-v")) }));
  const ring = doc.querySelector("[data-ring]");
  return { lang: doc.documentElement.lang, ring_overflow: ring ? doc.defaultView.getComputedStyle(ring).overflow : null, karte_breite_px: runde(rahmen.width), treffer, zeilen };
}

const LESE_AUSDRUCK = `(${leseUeberlauf.toString()})(document.getElementById("f").contentDocument, ${TEXT_ZEICHEN}, ${TOLERANZ_PX}, ${DEZIMALEN})`;

export async function messeUeberlauf(chrome, html, { szenario: wahl, tempo = 1 }) {
  const szenario = szenarioVon(wahl);
  const server = bedieneAnruffolge(html, { szenario, tempo, uhrNachAbgehoben: "weiter", callId: CALL_ID });
  const port = await server.listening;
  const browser = launch(chrome);
  let client;
  try {
    client = connect(await browser.endpoint);
    await client.opened;
    const { send, nextBinding } = client;
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Runtime.enable", {}, sessionId);
    await send("Runtime.addBinding", { name: DONE_BINDING }, sessionId);
    const done = nextBinding();
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/` }, sessionId);
    await done;
    const { result } = await send("Runtime.evaluate", { expression: LESE_AUSDRUCK, returnByValue: true }, sessionId);
    return { szenario: typeof wahl === "string" ? wahl : "eigenes", breite_px: szenario.breite, ...result.value };
  } finally {
    await browser.stop(client && client.send);
    if (client) client.close();
    server.close();
  }
}
