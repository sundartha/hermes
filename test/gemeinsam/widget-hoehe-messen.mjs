import { createServer } from "node:http";
import { connect, launch } from "./widget-ladezeit-messen.mjs";
import { bedieneAnruffolge, CALL_ID, mitAnruffolge, SZENARIEN } from "./widget-anruffolge-attrappe.mjs";

const RUHE_MS = 700;
const SUCHE_MAX_MS = 30000;
const LISTE_BREITE_PX = 420;
const LISTE_HOEHE_PX = 640;

const MESSE_KARTE = `(() => {
  const doc = document.getElementById("f").contentDocument;
  const karte = doc.querySelector(".w").getBoundingClientRect();
  const inhalt = doc.querySelector(".inhalt");
  return { karte_px: Math.round(karte.height), inhalt_scroll_px: inhalt.scrollHeight, inhalt_sichtbar_px: inhalt.clientHeight, zeilen: doc.querySelectorAll('[data-row="lines"] .turn').length };
})()`;

const MESSE_LISTE = `(() => {
  const doc = document.getElementById("f").contentDocument;
  const liste = doc.querySelector(".liste");
  return { karte_px: Math.round(doc.querySelector(".w").getBoundingClientRect().height), liste_px: Math.round(liste.getBoundingClientRect().height), liste_scroll_px: liste.scrollHeight, overflow_y: doc.defaultView.getComputedStyle(liste).overflowY, eintraege: liste.querySelectorAll(".row").length };
})()`;

const WARTE_LIVE = `new Promise((fertig) => {
  const pruefe = () => {
    if (typeof protokoll === "undefined") return setTimeout(pruefe, 50);
    const treffer = protokoll.filter((eintrag) => eintrag.von === "host" && eintrag.inhalt && eintrag.inhalt.status === "in_progress");
    const letzter = treffer[treffer.length - 1];
    if (letzter && jetzt() - letzter.t_ms > ${RUHE_MS}) fertig(true);
    else if (jetzt() > ${SUCHE_MAX_MS}) fertig(false);
    else setTimeout(pruefe, 50);
  };
  pruefe();
})`;

const LISTEN_HOST = (anrufe) => `<!doctype html><html><body style="margin:0"><iframe id="f" style="border:0;width:${LISTE_BREITE_PX}px;height:${LISTE_HOEHE_PX}px"></iframe><script>
const frame = document.getElementById("f");
const anrufe = ${JSON.stringify(anrufe).replaceAll("<", "\\u003c")};
function send(message) { frame.contentWindow.postMessage(Object.assign({ jsonrpc: "2.0" }, message), "*"); }
window.addEventListener("message", (event) => {
  const m = event.data;
  if (event.source !== frame.contentWindow || !m || typeof m !== "object") return;
  if (m.method === "ui/initialize") send({ id: m.id, result: { protocolVersion: "2026-01-26", hostInfo: { name: "attrappe", version: "0" }, hostCapabilities: {}, hostContext: {} } });
  if (m.method === "ui/notifications/initialized") send({ method: "ui/notifications/tool-result", params: { structuredContent: { calls: anrufe } } });
});
frame.src = "/widget";
</script></body></html>`;

const WARTE_LISTE = (anzahl) => `new Promise((fertig) => {
  const start = performance.now();
  const pruefe = () => {
    const rahmen = document.getElementById("f");
    const liste = rahmen && rahmen.contentDocument && rahmen.contentDocument.querySelector(".liste");
    if (liste && liste.querySelectorAll(".row").length === ${anzahl}) setTimeout(() => fertig(true), ${RUHE_MS});
    else if (performance.now() - start > ${SUCHE_MAX_MS}) fertig(false);
    else setTimeout(pruefe, 50);
  };
  pruefe();
})`;

async function auswerten(client, sessionId, ausdruck) {
  const { result, exceptionDetails } = await client.send("Runtime.evaluate", { expression: ausdruck, returnByValue: true, awaitPromise: true }, sessionId);
  if (exceptionDetails) throw new Error(exceptionDetails.exception.description);
  return result.value;
}

async function imBrowser(chrome, server, { warte, messe, viewport }) {
  const port = await server.listening;
  const browser = launch(chrome);
  let client;
  try {
    client = connect(await browser.endpoint);
    await client.opened;
    const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false }, sessionId);
    await client.send("Page.navigate", { url: `http://127.0.0.1:${port}/` }, sessionId);
    if (!(await auswerten(client, sessionId, warte))) throw new Error("Zustand nicht erreicht");
    return await auswerten(client, sessionId, messe);
  } finally {
    await browser.stop(client && client.send);
    if (client) client.close();
    server.close();
  }
}

export function messeKarteEnde(chrome, html, szenario) {
  return mitAnruffolge(chrome, html, { szenario, tempo: 0.05, lies: async (_meldung, { send, sessionId }) => {
    const { result } = await send("Runtime.evaluate", { expression: MESSE_KARTE, returnByValue: true }, sessionId);
    return result.value;
  } });
}

export function messeKarteLive(chrome, html, zeilen) {
  const szenario = { ...SZENARIEN.voll_de, waehlenS: 0, gespraechS: 3600, zeilen };
  const server = bedieneAnruffolge(html, { szenario, tempo: 1, uhrNachAbgehoben: "weiter", callId: CALL_ID });
  return imBrowser(chrome, server, { warte: WARTE_LIVE, messe: MESSE_KARTE, viewport: { width: szenario.breite, height: LISTE_HOEHE_PX } });
}

export function messeListe(chrome, html, anrufe) {
  const host = LISTEN_HOST(anrufe);
  const server = createServer((request, response) => {
    const seite = request.url === "/" ? host : request.url === "/widget" ? html : null;
    response.writeHead(seite === null ? 404 : 200, { "content-type": "text/html; charset=utf-8" });
    response.end(seite ?? "");
  });
  const listening = new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  const bedient = { listening, close: () => { server.close(); server.closeAllConnections(); } };
  return imBrowser(chrome, bedient, { warte: WARTE_LISTE(anrufe.length), messe: MESSE_LISTE, viewport: { width: LISTE_BREITE_PX, height: LISTE_HOEHE_PX } });
}
