import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, launch } from "./widget-ladezeit-messen.mjs";
import { bedieneAnruffolge, CALL_ID, mitAnruffolge, szenarioVon } from "./widget-anruffolge-attrappe.mjs";

const VIEWPORT = Object.freeze({ width: 420, height: 640, deviceScaleFactor: 1, mobile: false });
const RING_DICHTE = 3;
const LANG_S = 3600;
const RUHE_MS = 700;
const SUCHE_MAX_MS = 30000;
const TEMPO_ERGEBNIS = 0.05;

const RING_RECHTECK = `(() => {
  const r = document.getElementById("f").contentDocument.querySelector("[data-ring]").getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
})()`;

const wartePunkt = (status) => `new Promise((fertig) => {
  const pruefe = () => {
    const treffer = protokoll.filter((eintrag) => eintrag.von === "host" && eintrag.inhalt && eintrag.inhalt.status === ${JSON.stringify(status)});
    const letzter = treffer[treffer.length - 1];
    if (letzter && jetzt() - letzter.t_ms > ${RUHE_MS}) fertig(true);
    else if (jetzt() > ${SUCHE_MAX_MS}) fertig(false);
    else setTimeout(pruefe, 50);
  };
  pruefe();
})`;

const ruhe = () => `new Promise((fertig) => setTimeout(() => fertig(true), ${RUHE_MS}))`;

async function auswerten(werkzeug, ausdruck) {
  const { result } = await werkzeug.send("Runtime.evaluate", { expression: ausdruck, returnByValue: true, awaitPromise: true }, werkzeug.sessionId);
  return result.value;
}

async function schiesse(werkzeug, pfad, clip) {
  const optionen = clip ? { format: "png", clip: { ...clip, scale: RING_DICHTE } } : { format: "png" };
  const { data } = await werkzeug.send("Page.captureScreenshot", optionen, werkzeug.sessionId);
  writeFileSync(pfad, Buffer.from(data, "base64"));
  return pfad;
}

function pfadeVon({ ordner, name }, zustand, status) {
  return { bild: join(ordner, `${name}-${zustand}.png`), ring: status ? join(ordner, `${name}-ring-${status}.png`) : null };
}

async function belegeZustand(werkzeug, pfade) {
  await werkzeug.send("Emulation.setDeviceMetricsOverride", VIEWPORT, werkzeug.sessionId);
  const dateien = [await schiesse(werkzeug, pfade.bild)];
  if (pfade.ring) dateien.push(await schiesse(werkzeug, pfade.ring, await auswerten(werkzeug, RING_RECHTECK)));
  return dateien;
}

async function mitZustand(chrome, html, { szenario, status, lies }) {
  const server = bedieneAnruffolge(html, { szenario, tempo: 1, uhrNachAbgehoben: "weiter", callId: CALL_ID });
  const port = await server.listening;
  const browser = launch(chrome);
  let client;
  try {
    client = connect(await browser.endpoint);
    await client.opened;
    const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
    const werkzeug = { send: client.send, sessionId };
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Emulation.setDeviceMetricsOverride", VIEWPORT, sessionId);
    await client.send("Page.navigate", { url: `http://127.0.0.1:${port}/` }, sessionId);
    if (!(await auswerten(werkzeug, wartePunkt(status)))) throw new Error(`Karte erreicht den Zustand ${status} nicht`);
    return await lies(werkzeug);
  } finally {
    await browser.stop(client && client.send);
    if (client) client.close();
    server.close();
  }
}

export async function nimmBelege(chrome, html, { szenario: wahl, ordner }) {
  const basis = szenarioVon(wahl);
  const name = typeof wahl === "string" ? wahl : "eigenes";
  mkdirSync(ordner, { recursive: true });
  const waehlen = await mitZustand(chrome, html, { szenario: { ...basis, waehlenS: LANG_S, gespraechS: LANG_S }, status: "dialing", lies: (werkzeug) => belegeZustand(werkzeug, pfadeVon({ ordner, name }, "waehlen", null)) });
  const verbunden = await mitZustand(chrome, html, { szenario: { ...basis, waehlenS: 0, gespraechS: LANG_S }, status: "in_progress", lies: (werkzeug) => belegeZustand(werkzeug, pfadeVon({ ordner, name }, "verbunden", "in_progress")) });
  const ergebnis = await mitAnruffolge(chrome, html, { szenario: basis, tempo: TEMPO_ERGEBNIS, lies: async (_meldung, werkzeug) => {
    await auswerten(werkzeug, ruhe());
    return belegeZustand(werkzeug, pfadeVon({ ordner, name }, "ergebnis", basis.ergebnis.status));
  } });
  return { szenario: name, viewport: { breite_px: VIEWPORT.width, hoehe_px: VIEWPORT.height }, ring_pixeldichte: RING_DICHTE, dateien: [...waehlen, ...verbunden, ...ergebnis] };
}
