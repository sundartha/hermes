import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { connect, launch } from "./widget-ladezeit-messen.mjs";
import { findChrome } from "./widget-im-rahmen.js";
import { bedieneAnruffolge, CALL_ID, DONE_BINDING, szenarioVon, SZENARIEN } from "./widget-anruffolge-attrappe.mjs";

const UHR_HOEHE_PX = 50;
const KARTE_HOEHE_PX = 640;
const VIEWPORT = Object.freeze({ width: 420, height: KARTE_HOEHE_PX + UHR_HOEHE_PX, deviceScaleFactor: 2, mobile: false });
const UHR_TAKT_MS = 50;
const TEMPO_STANDARD = 0.05;
const MS = 1000;
const RUNDUNG = 1000;
const BILDER_PRO_S = 20;
const JPEG_QUALITAET = 85;
const JSON_EINZUG = 2;
const KEIN_FFMPEG = "nicht aufgenommen, ffmpeg fehlt";

export const UHR_SKRIPT = (szenario) => `
if (window === window.top) document.addEventListener("DOMContentLoaded", () => {
  const uhr = document.createElement("div");
  uhr.id = "echtzeituhr";
  uhr.style.cssText = "position:absolute;left:0;top:${KARTE_HOEHE_PX + 4}px;width:100%;height:${UHR_HOEHE_PX - 4}px;font:700 26px/${UHR_HOEHE_PX - 4}px monospace;text-align:center;background:#fff;color:#000";
  document.body.appendChild(uhr);
  const liste = [];
  const letzte = {};
  let ergebnisAnfang = null;
  window.__zeitliste = liste;
  window.__serverStartEpochMs = performance.timeOrigin + serverStart;
  const merke = (art, wert) => {
    if (letzte[art] === wert) return;
    letzte[art] = wert;
    liste.push({ art, wert, t_ms: performance.now() - serverStart });
  };
  const text = (doc, selector) => { const el = doc && doc.querySelector(selector); return el ? el.textContent.trim() : ""; };
  const tick = () => {
    const doc = document.getElementById("f").contentDocument;
    const ring = doc && doc.querySelector("[data-ring]");
    if (ring && ring.getClientRects().length > 0) merke("karte_erste_anzeige", true);
    const status = text(doc, '[data-mcp="status"]');
    if (status) merke("status", status);
    const dauer = text(doc, "[data-duration-display]");
    if (dauer) merke("dauer", dauer);
    const ergebnis = text(doc, '[data-mcp="result_summary"]');
    if (ergebnis && ergebnisAnfang === null) ergebnisAnfang = ergebnis;
    if (ergebnis && ergebnis !== ergebnisAnfang) merke("ergebnis_beginn", true);
    requestAnimationFrame(tick);
  };
  setInterval(() => { uhr.textContent = ((performance.now() - serverStart) / ${MS}).toFixed(1) + " s " + ${JSON.stringify(szenario)}; }, ${UHR_TAKT_MS});
  requestAnimationFrame(tick);
});
`;

export function zeitliste(roh, versatzS) {
  return roh.map((eintrag) => ({ art: eintrag.art, wert: eintrag.wert, t_s: Math.round((eintrag.t_ms / MS - versatzS) * RUNDUNG) / RUNDUNG }));
}

export function versatzS(serverStartEpochMs, ersteBildEpochMs) {
  return Math.round(((ersteBildEpochMs - serverStartEpochMs) / MS) * RUNDUNG) / RUNDUNG;
}

export function findeFfmpeg(pfadVar = process.env.PATH ?? "", cache = join(homedir(), "Library", "Caches", "ms-playwright"), cacheLinux = join(homedir(), ".cache", "ms-playwright")) {
  const kandidaten = ["ffmpeg"];
  for (const ordner of [cache, cacheLinux]) {
    if (!existsSync(ordner)) continue;
    for (const name of readdirSync(ordner).filter((n) => n.startsWith("ffmpeg-"))) {
      for (const datei of readdirSync(join(ordner, name)).filter((n) => n.startsWith("ffmpeg-"))) kandidaten.push(join(ordner, name, datei));
    }
  }
  return kandidaten.find((pfad) => {
    try {
      execFileSync(pfad, ["-version"], { stdio: "ignore", env: { ...process.env, PATH: pfadVar } });
      return true;
    } catch {
      return false;
    }
  }) ?? null;
}

async function auswerten(client, sessionId, ausdruck) {
  const { result } = await client.send("Runtime.evaluate", { expression: ausdruck, returnByValue: true }, sessionId);
  return result.value;
}

async function sammleBilder({ client, sessionId }, ordner, istFertig) {
  const bilder = [];
  while (!istFertig()) {
    const vorher = Date.now();
    const { data } = await client.send("Page.captureScreenshot", { format: "jpeg", quality: JPEG_QUALITAET }, sessionId);
    const nachher = Date.now();
    const datei = join(ordner, `bild-${String(bilder.length).padStart(5, "0")}.jpg`);
    writeFileSync(datei, Buffer.from(data, "base64"));
    bilder.push({ datei, epoch_ms: (vorher + nachher) / 2 });
  }
  return bilder;
}

function kodiere(ffmpeg, bilder, { ziel, ordner }) {
  const liste = join(ordner, "bilder.txt");
  const zeilen = bilder.flatMap((bild, i) => {
    const dauer = i + 1 < bilder.length ? (bilder[i + 1].epoch_ms - bild.epoch_ms) / MS : 1 / BILDER_PRO_S;
    return [`file '${bild.datei}'`, `duration ${dauer}`];
  });
  writeFileSync(liste, `${zeilen.join("\n")}\nfile '${bilder[bilder.length - 1].datei}'\n`);
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", liste, "-vf", `fps=${BILDER_PRO_S}`, "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", ziel]);
  return ziel;
}

async function spiele(chrome, html, { szenario, tempo, ordner }) {
  const server = bedieneAnruffolge(html, { szenario, tempo, uhrNachAbgehoben: "weiter", callId: CALL_ID });
  const port = await server.listening;
  const browser = launch(chrome);
  let client;
  try {
    client = connect(await browser.endpoint);
    await client.opened;
    const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
    await client.send("Target.activateTarget", { targetId });
    await client.send("Target.activateTarget", { targetId });
    await client.send("Page.enable", {}, sessionId);
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Runtime.addBinding", { name: DONE_BINDING }, sessionId);
    await client.send("Emulation.setDeviceMetricsOverride", VIEWPORT, sessionId);
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: UHR_SKRIPT(ordner.name) }, sessionId);
    let fertig = false;
    const done = client.nextBinding().then(() => { fertig = true; });
    await client.send("Page.navigate", { url: `http://127.0.0.1:${port}/` }, sessionId);
    while ((await auswerten(client, sessionId, "document.readyState")) !== "complete") await Promise.resolve();
    const bilder = await sammleBilder({ client, sessionId }, ordner.pfad, () => fertig);
    await done;
    const roh = await auswerten(client, sessionId, "JSON.stringify({ liste: window.__zeitliste, start: window.__serverStartEpochMs, uhr: { text: document.getElementById('echtzeituhr').textContent, ausserhalb_karte: document.getElementById('echtzeituhr').getBoundingClientRect().top >= document.getElementById('f').getBoundingClientRect().bottom } })");
    return { bilder, ...JSON.parse(roh) };
  } finally {
    await browser.stop(client && client.send);
    if (client) client.close();
    server.close();
  }
}

export async function nimmVideo(chrome, html, { szenario: wahl, tempo = TEMPO_STANDARD, ordner, ffmpeg = findeFfmpeg() }) {
  szenarioVon(wahl);
  const name = typeof wahl === "string" ? wahl : "eigenes";
  mkdirSync(ordner, { recursive: true });
  const bilderOrdner = mkdtempSync(join(tmpdir(), "anruffolge-bilder-"));
  try {
    const { bilder, liste, start, uhr } = await spiele(chrome, html, { szenario: szenarioVon(wahl), tempo, ordner: { pfad: bilderOrdner, name } });
    const versatz = versatzS(start, bilder[0].epoch_ms);
    const ziel = ffmpeg ? kodiere(ffmpeg, bilder, { ziel: join(ordner, `${name}.webm`), ordner: bilderOrdner }) : KEIN_FFMPEG;
    return { szenario: name, video: ziel, viewport: { breite_px: VIEWPORT.width, hoehe_px: VIEWPORT.height, pixeldichte: VIEWPORT.deviceScaleFactor }, bilder: bilder.length, versatz_videobeginn_zu_serverstart_s: versatz, uhr, zeitliste: zeitliste(liste, versatz) };
  } finally {
    rmSync(bilderOrdner, { recursive: true, force: true });
  }
}

const HILFE = `Video der Anruffolge der Anrufkarte mit Echtzeituhr im Bild.

Aufruf:
  node test/gemeinsam/widget-anruffolge-video.mjs PFAD [--szenario NAME] [--tempo FAKTOR] [--ordner VERZEICHNIS]

Szenarien: ${Object.keys(SZENARIEN).join(", ")}
Die Uhr unter der Karte zeigt Sekunden seit Serverstart mit Zehntelsekunden und den Szenarionamen.
Die Ausgabe nennt den Versatz Videobeginn zu Serverstart und die Zeitliste in Sekunden seit Videobeginn.
Fehlt ffmpeg, steht video: ${KEIN_FFMPEG}.
`;

async function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { hilfe: { type: "boolean" }, szenario: { type: "string", default: "voll_de" }, tempo: { type: "string", default: String(TEMPO_STANDARD) }, ordner: { type: "string" } } });
  if (values.hilfe) return process.stdout.write(HILFE);
  const chrome = findChrome();
  if (!positionals[0] || !existsSync(positionals[0]) || !chrome) throw new Error("PFAD fehlt oder nicht gefunden, oder kein Chromium (CHROME_BIN setzen); Aufruf mit --hilfe");
  const ordner = values.ordner ?? mkdtempSync(join(tmpdir(), "anruffolge-video-"));
  const ausgabe = await nimmVideo(chrome, readFileSync(positionals[0], "utf8"), { szenario: values.szenario, tempo: Number(values.tempo), ordner });
  return process.stdout.write(`${JSON.stringify(ausgabe, null, JSON_EINZUG)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((fehler) => {
    process.stderr.write(`${fehler.stack || fehler}\n`);
    process.exitCode = 1;
  });
}
