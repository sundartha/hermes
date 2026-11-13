import { test } from "node:test";
import assert from "node:assert/strict";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";
import { connect, launch } from "./widget-ladezeit-messen.mjs";

const SKIP = findChrome() ? false : "kein Chromium gefunden (CHROME_BIN setzen)";
const chrome = findChrome();
const OPTIONS = { skip: SKIP, timeout: 120000 };
const BINDING = "hermesErsteZeichnungGemeldet";
const MAX_FRAMES = 900;

const HOST_SCRIPT = `
const frame = document.getElementById("f");
const slots = { phase: "[data-hud-phase]", dauer: "[data-duration-display]" };
let frames = 0;
let stage = "erste";
let initialized = false;
let canvasBeiErsterZeichnung = null;
function send(message) { frame.contentWindow.postMessage(Object.assign({ jsonrpc: "2.0" }, message), "*"); }
function snapshot(doc) {
  const text = (selector) => { const el = doc.querySelector(selector); return el ? el.textContent.trim() : null; };
  const karte = doc.querySelector(".w");
  const zustand = karte && Array.from(karte.classList).find((name) => name.startsWith("ph-"));
  return {
    pille: zustand || null, phase: text(slots.phase), dauer: text(slots.dauer),
    canvas: Boolean(doc.querySelector("[data-wing-canvas] canvas")),
  };
}
function visible(el) { const box = el && el.getBoundingClientRect(); return Boolean(box && box.width > 0 && box.height > 0); }
function report(name, doc, festgehalten) { window[${JSON.stringify(BINDING)}](JSON.stringify({ name, ...snapshot(doc), ...festgehalten })); }
function pushWhenReady() {
  if (stage !== "gemountet" || !initialized) return;
  stage = "pushed";
  send({ method: "ui/notifications/tool-result", params: { structuredContent: { call_id: "attrappe-1" }, _meta: { "hermes/locale": "de" } } });
}
function watch() {
  frames += 1;
  const doc = frame.contentDocument;
  const pilleSichtbar = Boolean(doc && doc.body && visible(doc.querySelector(".verbindung .pill")));
  if (pilleSichtbar && canvasBeiErsterZeichnung === null) canvasBeiErsterZeichnung = snapshot(doc).canvas;
  const ready = pilleSichtbar && doc.readyState !== "loading";
  if (ready && stage === "erste") { stage = "gezeichnet"; report("erste_zeichnung", doc, { canvas: canvasBeiErsterZeichnung }); }
  else if (ready && stage === "gezeichnet" && (snapshot(doc).canvas || frames > ${MAX_FRAMES})) { stage = "gemountet"; report("ohne_ereignis", doc); pushWhenReady(); }
  else if (stage === "pushed" && (snapshot(doc).phase !== "Placing call" || frames > ${MAX_FRAMES})) { stage = "fertig"; report("nach_push_de", doc); }
  if (stage !== "fertig") requestAnimationFrame(watch);
}
window.addEventListener("message", (event) => {
  const m = event.data;
  if (!m || typeof m !== "object") return;
  if (m.method === "ui/initialize") send({ id: m.id, result: { protocolVersion: "2026-01-26", hostInfo: { name: "attrappe", version: "0" }, hostCapabilities: {}, hostContext: {} } });
  if (m.method === "ui/notifications/initialized") { initialized = true; pushWhenReady(); }
  if (m.method === "tools/call") send({ id: m.id, result: { content: [] } });
});
frame.srcdoc = new TextDecoder().decode(Uint8Array.from(atob(WIDGET_BASE64), (c) => c.charCodeAt(0)));
requestAnimationFrame(watch);
`;

function hostPage(html) {
  const source = Buffer.from(html).toString("base64");
  const script = HOST_SCRIPT.replace("WIDGET_BASE64", JSON.stringify(source));
  return `<!doctype html><html><body style="margin:0"><iframe id="f" style="border:0;width:600px;height:700px"></iframe><script>${script}</script></body></html>`;
}

async function sammle(html) {
  const browser = launch(chrome);
  let client;
  try {
    client = connect(await browser.endpoint);
    await client.opened;
    const { send, nextBinding } = client;
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Runtime.enable", {}, sessionId);
    await send("Runtime.addBinding", { name: BINDING }, sessionId);
    const page = `data:text/html;base64,${Buffer.from(hostPage(html)).toString("base64")}`;
    const meldungen = [nextBinding()];
    await send("Page.navigate", { url: page }, sessionId);
    const werte = {};
    for (let i = 0; i < 3; i += 1) {
      const meldung = JSON.parse(await meldungen[i]);
      werte[meldung.name] = meldung;
      meldungen.push(nextBinding());
    }
    return werte;
  } finally {
    await browser.stop(client && client.send);
    if (client) client.close();
  }
}

const gemessen = SKIP ? null : sammle((await ausgelieferteWidgets()).call);

test("Anrufkarte ist mit Status-Pille gezeichnet, bevor die Flügel-Engine gemountet ist", OPTIONS, async () => {
  const { erste_zeichnung: erste, ohne_ereignis: spaeter } = await gemessen;
  assert.ok(erste.pille, "Pille steht bei der ersten Zeichnung");
  assert.equal(erste.canvas, false, "kein canvas in [data-wing-canvas] bei der ersten Zeichnung");
  assert.equal(spaeter.canvas, true, "die Engine wird nach der ersten Zeichnung gemountet");
});

test("Anrufkarte zeigt ohne Host-Ereignis Connecting, Placing call, 0:00 und den laufenden Ring", OPTIONS, async () => {
  const { erste_zeichnung: erste, ohne_ereignis: spaeter } = await gemessen;
  for (const ansicht of [erste, spaeter]) {
    assert.equal(ansicht.pille, "ph-dial");
    assert.equal(ansicht.phase, "Placing call");
    assert.equal(ansicht.dauer, "0:00");
  }
});

test("Anrufkarte zeigt mit Sprache de nach dem ersten Push Verbindung und Anruf wird platziert", OPTIONS, async () => {
  const { nach_push_de: nachPush } = await gemessen;
  assert.equal(nachPush.pille, "ph-dial");
  assert.equal(nachPush.phase, "Anruf wird platziert");
  assert.equal(nachPush.dauer, "0:00");
});
