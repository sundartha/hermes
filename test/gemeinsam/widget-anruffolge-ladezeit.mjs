import { connect, launch } from "./widget-ladezeit-messen.mjs";
import { bedieneAnruffolge, CALL_ID, szenarioVon } from "./widget-anruffolge-attrappe.mjs";

const BINDING = "hermesAnruffolgeLadezeit";
const TEMPO_LADEZEIT = 0.05;
const DEZIMALEN = 10;
const MITTE = 2;
export const DURCHLAEUFE = 7;
export const CPU_DROSSELUNGEN = Object.freeze([1, 4, 6]);
export const LADEZEIT_FELDER = Object.freeze(["fcp_ms", "initialize_ms", "status_ms", "fluegel_ms"]);

const MESS_SKRIPT = `
{
  const felder = ${JSON.stringify(LADEZEIT_FELDER)};
  if (window.top === window) {
    const stand = {};
    window.__merke = (name, ms) => {
      if (name in stand) return;
      stand[name] = ms;
      if (felder.every((feld) => feld in stand)) window[${JSON.stringify(BINDING)}](JSON.stringify(stand));
    };
    window.addEventListener("message", (event) => {
      if (event.data && event.data.method === "ui/initialize") window.__merke("initialize_ms", performance.now());
    });
  } else {
    const jetzt = () => parent.performance.now();
    const merke = (name, ms) => parent.__merke(name, ms);
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      merke("fluegel_ms", jetzt());
      return clear.apply(this, args);
    };
    new PerformanceObserver((liste) => {
      for (const eintrag of liste.getEntries()) {
        if (eintrag.name === "first-contentful-paint") merke("fcp_ms", performance.timeOrigin + eintrag.startTime - parent.performance.timeOrigin);
      }
    }).observe({ type: "paint", buffered: true });
    const zeigt = () => {
      const el = document.querySelector('[data-mcp="status"]');
      const text = el ? el.textContent.trim() : "";
      return text !== "" && text !== "—";
    };
    let gesehen = false;
    new MutationObserver(() => {
      if (gesehen || !zeigt()) return;
      gesehen = true;
      requestAnimationFrame(() => merke("status_ms", jetzt()));
    }).observe(document, { subtree: true, childList: true, characterData: true });
  }
}
`;

function runde(wert) {
  return Math.round(wert * DEZIMALEN) / DEZIMALEN;
}

export function statistik(werte) {
  const sortiert = [...werte].sort((links, rechts) => links - rechts);
  const mitte = Math.floor(sortiert.length / MITTE);
  const median = sortiert.length % MITTE ? sortiert[mitte] : (sortiert[mitte - 1] + sortiert[mitte]) / MITTE;
  return { n: sortiert.length, median_ms: runde(median), min_ms: runde(sortiert[0]), max_ms: runde(sortiert[sortiert.length - 1]) };
}

export async function oeffneSeite(client, cpu) {
  const { send } = client;
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  await send("Runtime.addBinding", { name: BINDING }, sessionId);
  await send("Page.enable", {}, sessionId);
  await send("Page.addScriptToEvaluateOnNewDocument", { source: MESS_SKRIPT }, sessionId);
  if (cpu > 1) await send("Emulation.setCPUThrottlingRate", { rate: cpu }, sessionId);
  return sessionId;
}

export async function messeLadezeit(chrome, html, { szenario = "voll_de", cpu = 1 } = {}) {
  const server = bedieneAnruffolge(html, { szenario: szenarioVon(szenario), tempo: TEMPO_LADEZEIT, uhrNachAbgehoben: "weiter", callId: CALL_ID });
  const port = await server.listening;
  const browser = launch(chrome);
  let client;
  try {
    client = connect(await browser.endpoint);
    await client.opened;
    const sessionId = await oeffneSeite(client, cpu);
    const done = client.nextBinding();
    await client.send("Page.navigate", { url: `http://127.0.0.1:${port}/` }, sessionId);
    return JSON.parse(await done);
  } finally {
    await browser.stop(client && client.send);
    if (client) client.close();
    server.close();
  }
}

export async function messeLadezeitWiederholt(chrome, html, { szenario = "voll_de", durchlaeufe = DURCHLAEUFE, drosselungen = CPU_DROSSELUNGEN, messe = messeLadezeit } = {}) {
  const ergebnis = { szenario, durchlaeufe, bedingungen: {} };
  for (const cpu of drosselungen) {
    const laeufe = [];
    for (let i = 0; i < durchlaeufe; i += 1) laeufe.push(await messe(chrome, html, { szenario, cpu }));
    const werte = Object.fromEntries(LADEZEIT_FELDER.map((feld) => [feld, statistik(laeufe.map((lauf) => lauf[feld]))]));
    ergebnis.bedingungen[cpu === 1 ? "ungedrosselt" : `cpu_${cpu}x`] = { cpu, ...werte, laeufe };
  }
  return ergebnis;
}
