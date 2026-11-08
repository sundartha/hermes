import { gzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { connect, launch } from "./widget-ladezeit-messen.mjs";
import { bedieneAnruffolge, CALL_ID, DONE_BINDING, szenarioVon } from "./widget-anruffolge-attrappe.mjs";

const MS = 1000;
const PROBE_SIM_MS = 100;
const SCHWELLEN_MS = [20, 34, 50];
const P95 = 0.95;
const DEZIMALEN = 1000;
const ANZEIGE = /^(\d+):(\d{2})$/;
const CHROME_METRIKEN = ["LayoutCount", "RecalcStyleCount", "ScriptDuration", "TaskDuration"];
const TRACE_KATEGORIEN = "devtools.timeline,v8.execute,blink.user_timing";

const MESS_SKRIPT = `
const konfig = __KONFIG__;
{
  if (window.top === window) {
    window.__mess = { rafs: [], zeichnungen: [], proben: [], ereignisse: [], langaufgaben: [], verschiebungen: [] };
  } else {
  const mess = parent.__mess;
  const jetzt = () => Math.round(parent.simMs() * konfig.tempo * 10) / 10;
  const text = (selector) => {
    const el = document.querySelector(selector);
    return el ? el.textContent.trim() : null;
  };
  const merke = (art, wert) => mess.ereignisse.push({ art, wert, ms: jetzt(), sim_ms: Math.round(parent.simMs()) });
  const vorher = { status: null, dauer: null, ergebnis: false };
  function pruefe() {
    const status = text('[data-mcp="status"]');
    const dauer = text("[data-duration-display]");
    const ergebnis = text('[data-mcp="result_summary"]');
    if (status !== vorher.status) merke("status", status);
    if (dauer !== vorher.dauer) merke("dauer", dauer);
    if (!vorher.ergebnis && ergebnis && ergebnis !== "—") merke("ergebnis_beginn", ergebnis);
    vorher.ergebnis = vorher.ergebnis || Boolean(ergebnis && ergebnis !== "—");
    vorher.status = status;
    vorher.dauer = dauer;
  }
  let letzterTakt = 0;
  let letzteProbe = -Infinity;
  let gezeigt = false;
  function takt(stempel) {
    if (letzterTakt) mess.rafs.push([jetzt(), stempel - letzterTakt]);
    letzterTakt = stempel;
    const sim = parent.simMs();
    if (sim - letzteProbe >= konfig.probeSimMs) {
      letzteProbe = sim;
      mess.proben.push({ sim_ms: sim, text: text("[data-duration-display]") });
    }
    const karte = document.querySelector("[data-status-pill]") || document.querySelector(".card");
    const box = karte && karte.getBoundingClientRect();
    if (!gezeigt && box && box.width > 0 && box.height > 0) {
      gezeigt = true;
      merke("erste_anzeige", null);
    }
    requestAnimationFrame(takt);
  }
  const clear = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    mess.zeichnungen.push(jetzt());
    return clear.apply(this, args);
  };
  const beobachte = (type, beiEintrag) => {
    try {
      new PerformanceObserver((liste) => liste.getEntries().forEach(beiEintrag)).observe({ type, buffered: true });
    } catch {
      return;
    }
  };
  beobachte("longtask", (eintrag) => mess.langaufgaben.push([jetzt(), eintrag.duration]));
  beobachte("layout-shift", (eintrag) => mess.verschiebungen.push(eintrag.hadRecentInput ? 0 : eintrag.value));
  requestAnimationFrame(takt);
  new MutationObserver(pruefe).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
}
}
`;

function runde(wert) {
  return Math.round(wert * DEZIMALEN) / DEZIMALEN;
}

function rang(sortiert, anteil) {
  return sortiert[Math.max(Math.ceil(anteil * sortiert.length) - 1, 0)];
}

export function bewerteTakt(abstaendeMs) {
  const sortiert = [...abstaendeMs].sort((links, rechts) => links - rechts);
  const n = sortiert.length;
  const summe = sortiert.reduce((acc, wert) => acc + wert, 0);
  const ueber = Object.fromEntries(
    SCHWELLEN_MS.map((grenze) => {
      const anzahl = sortiert.filter((wert) => wert > grenze).length;
      return [`ueber_${grenze}_ms`, { anzahl, anteil: n ? runde(anzahl / n) : 0 }];
    }),
  );
  if (n === 0) return { n, fps: 0, median_ms: null, p95_ms: null, max_ms: null, ...ueber };
  return { n, fps: runde((n / summe) * MS), median_ms: runde(rang(sortiert, 0.5)), p95_ms: runde(rang(sortiert, P95)), max_ms: runde(sortiert[n - 1]), ...ueber };
}

export function zeigeSekunden(text) {
  const treffer = ANZEIGE.exec(text || "");
  return treffer ? Number(treffer[1]) * 60 + Number(treffer[2]) : null;
}

export function messeTimer(proben) {
  const gueltig = proben.filter((probe) => probe.anzeige_s !== null);
  const abweichungen = gueltig.map((probe) => probe.anzeige_s - probe.wahr_s);
  const spruenge = [];
  let pause = 0;
  let letzte = null;
  for (const probe of gueltig) {
    if (letzte === null || probe.anzeige_s === letzte.anzeige_s) {
      letzte = letzte || { ...probe, wechsel_sim_ms: probe.sim_ms };
      continue;
    }
    const abstand = probe.sim_ms - letzte.wechsel_sim_ms;
    pause = Math.max(pause, abstand);
    if (probe.anzeige_s - letzte.anzeige_s !== 1) spruenge.push({ bei_sim_ms: Math.round(probe.sim_ms), von_s: letzte.anzeige_s, nach_s: probe.anzeige_s, abstand_ms: Math.round(abstand) });
    letzte = { ...probe, wechsel_sim_ms: probe.sim_ms };
  }
  const summe = abweichungen.reduce((acc, wert) => acc + wert, 0);
  return {
    n: gueltig.length,
    abweichung_min_s: abweichungen.length ? runde(Math.min(...abweichungen)) : null,
    abweichung_max_s: abweichungen.length ? runde(Math.max(...abweichungen)) : null,
    abweichung_mittel_s: abweichungen.length ? runde(summe / abweichungen.length) : null,
    spruenge,
    laengste_pause_ms: Math.round(pause),
  };
}

export function wahreDauerS(szenario, simMs, uhrNachAbgehoben) {
  const abgehobenMs = szenario.waehlenS * MS;
  const gescheitert = szenario.ergebnis.status === "failed";
  const endeMs = abgehobenMs + (gescheitert ? 0 : szenario.gespraechS * MS);
  const vonMs = uhrNachAbgehoben === "von-null" ? abgehobenMs : 0;
  return Math.max(0, Math.min(simMs, endeMs) - vonMs) / MS;
}

function metrikDifferenz(vorher, nachher) {
  const wert = (liste, name) => liste.metrics.find((metrik) => metrik.name === name).value;
  return Object.fromEntries(CHROME_METRIKEN.map((name) => [name, runde(wert(nachher, name) - wert(vorher, name))]));
}

function abstaende(zeiten) {
  return zeiten.slice(1).map((zeit, index) => zeit - zeiten[index]);
}

function nimmTraceAuf(endpoint) {
  const socket = new WebSocket(endpoint);
  const ereignisse = [];
  const stufen = { start: null, ende: null };
  const bereit = new Promise((resolve, reject) => {
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method: "Tracing.start", params: { categories: TRACE_KATEGORIEN } })));
    socket.addEventListener("error", reject);
    stufen.start = resolve;
  });
  const fertig = new Promise((resolve) => {
    stufen.ende = resolve;
  });
  socket.addEventListener("message", (event) => {
    const nachricht = JSON.parse(event.data);
    if (nachricht.id === 1) stufen.start();
    if (nachricht.method === "Tracing.dataCollected") ereignisse.push(...nachricht.params.value);
    if (nachricht.method === "Tracing.tracingComplete") stufen.ende();
  });
  const beende = async () => {
    socket.send(JSON.stringify({ id: 2, method: "Tracing.end" }));
    await fertig;
    socket.close();
    return gzipSync(JSON.stringify({ traceEvents: ereignisse }));
  };
  return { bereit, beende };
}

function ausDemBrowser(roh, szenario, uhrNachAbgehoben) {
  const proben = roh.proben.map((probe) => ({ sim_ms: probe.sim_ms, wahr_s: wahreDauerS(szenario, probe.sim_ms, uhrNachAbgehoben), anzeige_s: zeigeSekunden(probe.text) }));
  const dauern = roh.langaufgaben.map(([, dauer]) => dauer);
  return {
    bildtakt: bewerteTakt(roh.rafs.map(([, abstand]) => abstand)),
    fluegel: { zeichnungen: roh.zeichnungen.length, ...bewerteTakt(abstaende(roh.zeichnungen)) },
    langaufgaben: { anzahl: dauern.length, summe_ms: runde(dauern.reduce((acc, wert) => acc + wert, 0)), laengste_ms: runde(Math.max(0, ...dauern)) },
    layout_shift: runde(roh.verschiebungen.reduce((acc, wert) => acc + wert, 0)),
    timer: messeTimer(proben),
    zeitliste: roh.ereignisse,
  };
}

async function oeffneSeite(client, port, tempo) {
  const { send } = client;
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  await send("Runtime.addBinding", { name: DONE_BINDING }, sessionId);
  await send("Performance.enable", {}, sessionId);
  await send("Page.enable", {}, sessionId);
  const source = MESS_SKRIPT.replace("__KONFIG__", () => JSON.stringify({ tempo, probeSimMs: PROBE_SIM_MS }));
  await send("Page.addScriptToEvaluateOnNewDocument", { source }, sessionId);
  return sessionId;
}

export async function messeAnruffolge(chrome, html, { szenario: wahl, tempo = 1, uhrNachAbgehoben = "weiter", traceDatei = null }) {
  const szenario = szenarioVon(wahl);
  const server = bedieneAnruffolge(html, { szenario, tempo, uhrNachAbgehoben, callId: CALL_ID });
  const port = await server.listening;
  const browser = launch(chrome);
  let client;
  try {
    const endpoint = await browser.endpoint;
    client = connect(endpoint);
    await client.opened;
    const sessionId = await oeffneSeite(client, port, tempo);
    const { send, nextBinding } = client;
    const trace = nimmTraceAuf(endpoint);
    await trace.bereit;
    const vorher = await send("Performance.getMetrics", {}, sessionId);
    const done = nextBinding();
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/` }, sessionId);
    await done;
    const nachher = await send("Performance.getMetrics", {}, sessionId);
    const { result } = await send("Runtime.evaluate", { expression: "JSON.stringify(window.__mess)", returnByValue: true }, sessionId);
    const gz = await trace.beende();
    if (traceDatei) writeFileSync(traceDatei, gz);
    return { szenario: typeof wahl === "string" ? wahl : "eigenes", tempo, uhrNachAbgehoben, fenster: "gesamte Anruffolge", ...ausDemBrowser(JSON.parse(result.value), szenario, uhrNachAbgehoben), chrome: metrikDifferenz(vorher, nachher), trace: { bytes_gzip: gz.length, datei: traceDatei } };
  } finally {
    await browser.stop(client && client.send);
    if (client) client.close();
    server.close();
  }
}
