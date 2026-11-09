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
    window.__mess = { rafs: [], zeichnungen: [], proben: [], ereignisse: [], langaufgaben: [], verschiebungen: [], fenster: { von: null, bis: null, von_sim_ms: null, bis_sim_ms: null } };
  } else {
  const mess = parent.__mess;
  const jetzt = () => Math.round(parent.simMs() * konfig.tempo * 10) / 10;
  const text = (selector) => {
    const el = document.querySelector(selector);
    return el ? el.textContent.trim() : null;
  };
  const merke = (art, wert) => mess.ereignisse.push({ art, wert, ms: jetzt(), sim_ms: Math.round(parent.simMs()) });
  const vorher = { status: null, dauer: null, ergebnis: false };
  let probeElement = null;
  function hermesFensterStart() { debugger; }
  function hermesFensterEnde() { debugger; }
  function erzwingeLayouts(anzahl) {
    if (!konfig.probeLayouts || anzahl <= 0) return;
    if (!probeElement) {
      probeElement = document.createElement("div");
      probeElement.style.cssText = "position:fixed;left:-100px;top:0;height:1px";
      document.documentElement.appendChild(probeElement);
    }
    for (let i = 0; i < anzahl; i += 1) {
      probeElement.style.width = (i % 2 ? 10 : 11) + "px";
      probeElement.offsetWidth;
    }
  }
  function wechselFenster(status) {
    const fenster = mess.fenster;
    if (status === "in_progress" && fenster.von === null) {
      Object.assign(fenster, { von: jetzt(), von_sim_ms: Math.round(parent.simMs()) });
    } else if (status !== "in_progress" && fenster.von !== null && fenster.bis === null) {
      Object.assign(fenster, { bis: jetzt(), bis_sim_ms: Math.round(parent.simMs()) });
    }
  }
  const post = window.postMessage.bind(window);
  const anker = { start: false, ende: false };
  const probe = konfig.probeLayouts || {};
  const nachZweiBildern = (aufgabe) => requestAnimationFrame(() => requestAnimationFrame(aufgabe));
  window.postMessage = function (nachricht, ...rest) {
    const status = nachricht && nachricht.result && nachricht.result.structuredContent && nachricht.result.structuredContent.status;
    if (status === "in_progress" && !anker.start) {
      anker.start = true;
      nachZweiBildern(() => {
        erzwingeLayouts(probe.vor);
        hermesFensterStart();
        erzwingeLayouts(probe.im);
        post(nachricht, ...rest);
      });
    } else if (status && status !== "in_progress" && anker.start && !anker.ende) {
      anker.ende = true;
      nachZweiBildern(() => {
        hermesFensterEnde();
        erzwingeLayouts(probe.nach);
        post(nachricht, ...rest);
      });
    } else {
      post(nachricht, ...rest);
    }
  };
  function pruefe() {
    const status = text('[data-mcp="status"]');
    const dauer = text("[data-duration-display]");
    const ergebnis = text('[data-mcp="result_summary"]');
    if (status !== vorher.status) {
      merke("status", status);
      wechselFenster(status);
    }
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
  mess.verschiebungenMitZeit = [];
  beobachte("layout-shift", (eintrag) => mess.verschiebungenMitZeit.push([jetzt(), eintrag.hadRecentInput ? 0 : eintrag.value]));
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
  if (letzte !== null) pause = Math.max(pause, gueltig[gueltig.length - 1].sim_ms - letzte.wechsel_sim_ms);
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
  const wert = (liste, name) => {
    const metrik = Array.isArray(liste && liste.metrics) ? liste.metrics.find((eintrag) => eintrag.name === name) : undefined;
    if (!metrik) throw new Error(`Chrome-Metrik ${name} fehlt`);
    return metrik.value;
  };
  return Object.fromEntries(CHROME_METRIKEN.map((name) => [name, runde(wert(nachher, name) - wert(vorher, name))]));
}

function abstaende(zeiten) {
  return zeiten.slice(1).map((zeit, index) => zeit - zeiten[index]);
}

function nimmTraceAuf(endpoint) {
  const socket = new WebSocket(endpoint);
  const ereignisse = [];
  const stufen = { start: null, ende: null, laeuft: false };
  const bereit = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
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
  const starte = () => {
    stufen.laeuft = true;
    const gestartet = new Promise((resolve) => {
      stufen.start = resolve;
    });
    socket.send(JSON.stringify({ id: 1, method: "Tracing.start", params: { categories: TRACE_KATEGORIEN } }));
    return gestartet;
  };
  const beende = async () => {
    if (stufen.laeuft) {
      socket.send(JSON.stringify({ id: 2, method: "Tracing.end" }));
      await fertig;
    }
    socket.close();
    return gzipSync(JSON.stringify({ traceEvents: ereignisse }));
  };
  return { bereit, starte, beende };
}

export function schneideFenster(roh) {
  const { von, bis, von_sim_ms: vonSim, bis_sim_ms: bisSim } = roh.fenster;
  if (von === null) return { rafs: [], zeichnungen: [], proben: [], langaufgaben: [] };
  const ende = bis === null ? Infinity : bis;
  const endeSim = bisSim === null ? Infinity : bisSim;
  return {
    rafs: roh.rafs.filter(([zeit, abstand]) => zeit - abstand >= von && zeit <= ende),
    zeichnungen: roh.zeichnungen.filter((zeit) => zeit >= von && zeit <= ende),
    proben: roh.proben.filter((probe) => probe.sim_ms >= vonSim && probe.sim_ms <= endeSim),
    langaufgaben: roh.langaufgaben.filter(([zeit]) => zeit >= von && zeit <= ende),
    verschiebungen: (roh.verschiebungenMitZeit || []).filter(([zeit]) => zeit >= von && zeit <= ende),
  };
}

export function summiereVerschiebungen(liste) {
  return runde(liste.reduce((acc, [, wert]) => acc + wert, 0));
}

function ausDemBrowser(roh, szenario, uhrNachAbgehoben) {
  const im = schneideFenster(roh);
  const proben = im.proben.map((probe) => ({ sim_ms: probe.sim_ms, wahr_s: wahreDauerS(szenario, probe.sim_ms, uhrNachAbgehoben), anzeige_s: zeigeSekunden(probe.text) }));
  const dauern = im.langaufgaben.map(([, dauer]) => dauer);
  return {
    bildtakt: bewerteTakt(im.rafs.map(([, abstand]) => abstand)),
    fluegel: { zeichnungen: im.zeichnungen.length, ...bewerteTakt(abstaende(im.zeichnungen)) },
    langaufgaben: { anzahl: dauern.length, summe_ms: runde(dauern.reduce((acc, wert) => acc + wert, 0)), laengste_ms: runde(Math.max(0, ...dauern)) },
    layout_shift: runde(roh.verschiebungen.reduce((acc, wert) => acc + wert, 0)),
    layout_shift_bereich: "gesamte Anruffolge",
    layout_shift_fenster: summiereVerschiebungen(im.verschiebungen || []),
    timer: messeTimer(proben),
    zeitliste: roh.ereignisse,
  };
}

async function oeffneSeite(client, tempo, probeLayouts) {
  const { send } = client;
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  await send("Runtime.addBinding", { name: DONE_BINDING }, sessionId);
  await send("Performance.enable", {}, sessionId);
  await send("Page.enable", {}, sessionId);
  const source = MESS_SKRIPT.replace("__KONFIG__", () => JSON.stringify({ tempo, probeSimMs: PROBE_SIM_MS, probeLayouts }));
  await send("Page.addScriptToEvaluateOnNewDocument", { source }, sessionId);
  return { sessionId, targetId };
}

function oeffneHalter(endpoint) {
  const socket = new WebSocket(endpoint);
  const wartend = new Map();
  let beiPause = null;
  let zaehler = 0;
  socket.addEventListener("message", (event) => {
    const nachricht = JSON.parse(event.data);
    if (nachricht.method === "Debugger.paused") return beiPause(nachricht.params, nachricht.sessionId);
    const erwartet = wartend.get(nachricht.id);
    if (!erwartet) return;
    wartend.delete(nachricht.id);
    if (nachricht.error) erwartet.reject(new Error(nachricht.error.message));
    else erwartet.resolve(nachricht.result);
  });
  const geoeffnet = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      zaehler += 1;
      wartend.set(zaehler, { resolve, reject });
      socket.send(JSON.stringify({ id: zaehler, method, params, sessionId }));
    });
  return { geoeffnet, send, bei: (handler) => { beiPause = handler; }, close: () => socket.close() };
}

async function beobachteFenster(endpoint, targetId) {
  const halter = oeffneHalter(endpoint);
  await halter.geoeffnet;
  const { sessionId } = await halter.send("Target.attachToTarget", { targetId, flatten: true });
  await halter.send("Performance.enable", {}, sessionId);
  await halter.send("Debugger.enable", {}, sessionId);
  return { halter, sessionId };
}

function leseFenster({ halter, sessionId }, nimmMetriken, trace) {
  const stand = { vorher: null, nachher: null, gestartet: null, beendet: null, fehler: null };
  let beendeFenster;
  const hoeren = new Promise((resolve) => {
    beendeFenster = resolve;
  });
  const ende = () => {
    stand.beendet = (async () => {
      await stand.gestartet;
      stand.nachher = await nimmMetriken();
      return trace.beende();
    })();
  };
  const halteAn = async (anker) => {
    const metriken = await halter.send("Performance.getMetrics", {}, sessionId);
    if (anker === "hermesFensterStart") stand.vorher = metriken;
    else stand.nachher = metriken;
  };
  const beiPause = async (params) => {
    const anker = params.callFrames[0].functionName;
    const start = anker === "hermesFensterStart";
    const gemeint = start || anker === "hermesFensterEnde";
    try {
      if (gemeint) await halteAn(anker);
    } catch (fehler) {
      stand.fehler = fehler;
    } finally {
      await halter.send("Debugger.resume", {}, sessionId);
    }
    if (start) stand.gestartet = trace.starte();
    if (anker === "hermesFensterEnde") {
      stand.beendet = (async () => {
        await stand.gestartet;
        return trace.beende();
      })();
      beendeFenster();
    }
  };
  halter.bei(beiPause);
  return { stand, ende, trace, hoeren };
}

async function schliesseFenster(roh, fenster, nimmMetriken) {
  if (roh.fenster.von === null) {
    const leer = await nimmMetriken();
    return { vorher: leer, nachher: leer, gz: await fenster.trace.beende() };
  }
  if (roh.fenster.bis === null) {
    await fenster.stand.gestartet;
    fenster.ende();
  } else await fenster.hoeren;
  if (fenster.stand.fehler) throw fenster.stand.fehler;
  const gz = await fenster.stand.beendet;
  return { vorher: fenster.stand.vorher, nachher: fenster.stand.nachher, gz };
}

export async function messeAnruffolge(chrome, html, { szenario: wahl, tempo = 1, uhrNachAbgehoben = "weiter", traceDatei = null, probeLayouts = null }) {
  const szenario = szenarioVon(wahl);
  const server = bedieneAnruffolge(html, { szenario, tempo, uhrNachAbgehoben, callId: CALL_ID });
  const port = await server.listening;
  const browser = launch(chrome);
  let client;
  let beobachter;
  try {
    const endpoint = await browser.endpoint;
    client = connect(endpoint);
    await client.opened;
    const { sessionId, targetId } = await oeffneSeite(client, tempo, probeLayouts);
    const { send, nextBinding } = client;
    const nimmMetriken = () => send("Performance.getMetrics", {}, sessionId);
    const trace = nimmTraceAuf(endpoint);
    await trace.bereit;
    beobachter = await beobachteFenster(endpoint, targetId);
    const fenster = leseFenster(beobachter, nimmMetriken, trace);
    const done = nextBinding();
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/` }, sessionId);
    await done;
    const { result } = await send("Runtime.evaluate", { expression: "JSON.stringify(window.__mess)", returnByValue: true }, sessionId);
    const roh = JSON.parse(result.value);
    const { vorher, nachher, gz } = await schliesseFenster(roh, fenster, nimmMetriken);
    if (traceDatei) writeFileSync(traceDatei, gz);
    const gespraechsfenster = { von_sim_ms: roh.fenster.von_sim_ms, bis_sim_ms: roh.fenster.bis_sim_ms };
    return { szenario: typeof wahl === "string" ? wahl : "eigenes", tempo, uhrNachAbgehoben, fenster: "abgehoben bis Gesprächsende", fenster_sim_ms: gespraechsfenster, ...ausDemBrowser(roh, szenario, uhrNachAbgehoben), chrome: metrikDifferenz(vorher, nachher), trace: { bytes_gzip: gz.length, datei: traceDatei } };
  } finally {
    await browser.stop(client && client.send);
    if (client) client.close();
    if (beobachter) beobachter.halter.close();
    server.close();
  }
}
