import { createServer } from "node:http";
import { connect, launch } from "./widget-ladezeit-messen.mjs";

const DONE_BINDING = "hermesAnruffolgeFertig";
const REPLY_DELAY_MS = 60;
const CALL_ID = "attrappe-anruf-1";
const CARD_HEIGHT_PX = 640;
const DEFAULT_WIDTH_PX = 420;

const LANGE_ZEILEN = {
  de: ["Agent: Gesamtkostenabrechnungsvorschlagsbestätigung", "Gegenüber: Haftpflichtversicherungsvertragsänderungsmitteilung"],
  fr: ["Agent: Responsabilité-contractuelle-extracontractuelle", "Interlocuteur: Dénomination-institutionnelle-complémentaire"],
};

const NORMALE_ZEILEN = {
  de: ["Agent: Guten Tag, ich rufe im Auftrag an.", "Gegenüber: Ja, bitte."],
  en: ["Agent: Hello, I am calling on behalf of a customer.", "Counterparty: Yes, go ahead."],
  fr: ["Agent: Bonjour, j'appelle de la part d'un client.", "Interlocuteur: Oui, allez-y."],
  es: ["Agent: Hola, llamo de parte de un cliente.", "Contraparte: Sí, dígame."],
};

function ergebnis(status, felder) {
  return { status, failure_reason: null, ...felder };
}

function fall([locale, inhaltssprache, erwartet], rest) {
  return { locale, inhaltssprache, erwartet, breite: DEFAULT_WIDTH_PX, waehlenS: 6, gespraechS: 120, ...rest };
}

export const SZENARIEN = Object.freeze({
  voll_de: fall(["de", "de", "de"], {
    zeilen: NORMALE_ZEILEN.de,
    ergebnis: ergebnis("completed", {
      objective_achieved: true,
      result_summary: "Der Termin am Donnerstag um 10 Uhr ist bestätigt.",
      outcome: "Termin vereinbart",
      next_step: "Bestätigung per E-Mail abwarten",
    }),
  }),
  nicht_erreicht_en: fall(["en", "en", "en"], {
    zeilen: NORMALE_ZEILEN.en,
    ergebnis: ergebnis("completed", {
      objective_achieved: false,
      result_summary: "The office could not offer a slot this week.",
      outcome: "No appointment available",
      next_step: "Call again next week",
    }),
  }),
  unklar_fr: fall(["fr", "fr", "fr"], {
    zeilen: NORMALE_ZEILEN.fr,
    ergebnis: ergebnis("completed", {
      objective_achieved: "unclear",
      result_summary: "Le rendez-vous reste à confirmer par le secrétariat.",
      outcome: "Réponse ouverte",
      next_step: "Attendre le rappel",
    }),
  }),
  fehler_de: fall(["de", "de", "de"], {
    zeilen: [],
    ergebnis: ergebnis("failed", {
      failure_reason: "no_answer",
      objective_achieved: false,
      result_summary: "Niemand hat abgehoben.",
    }),
  }),
  lang_de_320: fall(["de", "de", "de"], {
    breite: 320,
    zeilen: LANGE_ZEILEN.de,
    ergebnis: ergebnis("completed", {
      objective_achieved: true,
      result_summary: "Gesamtkostenabrechnungsvorschlagsbestätigung liegt vor.",
      outcome: "Gesamtkostenabrechnungsvorschlagsbestätigung erteilt",
      next_step: "Haftpflichtversicherungsvertragsänderungsmitteilung abwarten",
    }),
  }),
  lang_fr_420: fall(["fr", "fr", "fr"], {
    zeilen: LANGE_ZEILEN.fr,
    ergebnis: ergebnis("completed", {
      objective_achieved: true,
      result_summary: "Responsabilité-contractuelle-extracontractuelle confirmée.",
      outcome: "Dénomination-institutionnelle-complémentaire acceptée",
      next_step: "Attendre l'anticonstitutionnellement-longue confirmation",
    }),
  }),
  ohne_woerterbuch_es: fall(["es", "es", "en"], {
    zeilen: NORMALE_ZEILEN.es,
    ergebnis: ergebnis("completed", {
      objective_achieved: true,
      result_summary: "La cita queda confirmada para el jueves.",
      outcome: "Cita acordada",
      next_step: "Esperar la confirmación por correo",
    }),
  }),
  mismatch_de_en: fall(["de", "en", "en"], {
    zeilen: NORMALE_ZEILEN.en,
    ergebnis: ergebnis("completed", {
      objective_achieved: true,
      result_summary: "The appointment on Thursday at 10 am is confirmed.",
      outcome: "Appointment booked",
      next_step: "Wait for the confirmation e-mail",
    }),
  }),
});

export function statusZu(szenario, simMs, uhrNachAbgehoben) {
  const MS = 1000;
  const abgehobenMs = szenario.waehlenS * MS;
  const gescheitert = szenario.ergebnis.status === "failed";
  const endeMs = abgehobenMs + (gescheitert ? 0 : szenario.gespraechS * MS);
  const jetztMs = Math.min(simMs, endeMs);
  const beendet = simMs >= endeMs;
  const status = beendet ? szenario.ergebnis.status : simMs >= abgehobenMs ? "in_progress" : "dialing";
  const vonMs = uhrNachAbgehoben === "von-null" ? abgehobenMs : 0;
  return {
    status,
    failure_reason: status === "failed" ? szenario.ergebnis.failure_reason : null,
    duration_s: Math.round(Math.max(0, jetztMs - vonMs) / MS),
    last_transcript_lines: status === "in_progress" ? szenario.zeilen : [],
  };
}

export function sprachHinweis(szenario) {
  const { locale, inhaltssprache, erwartet } = szenario;
  const fallback = erwartet !== locale || erwartet !== inhaltssprache;
  const grund = locale === inhaltssprache ? `Locale ${locale} ohne Wörterbuch` : `Inhalt ${inhaltssprache} passt nicht zur Locale ${locale}`;
  return { host: locale, inhalt: inhaltssprache, erwartet, hinweis: fallback ? `${grund}: Karte fällt auf ${erwartet} zurück` : `Karte in ${erwartet}` };
}

const HOST_SCRIPT = `
const KONFIG = __KONFIG__;
const frame = document.getElementById("f");
const protokoll = [];
const serverStart = performance.now();
const statusZu = ${statusZu.toString()};
let pushed = false;
let beendet = false;
const meta = { "hermes/content_locale": KONFIG.szenario.inhaltssprache };
function jetzt() { return Math.round((performance.now() - serverStart) * 10) / 10; }
function simMs() { return (performance.now() - serverStart) / KONFIG.tempo; }
function inhaltVon(message) {
  const sc = (message.result && message.result.structuredContent) || (message.params && message.params.structuredContent);
  return sc ? { status: sc.status || null, duration_s: sc.duration_s === undefined ? null : sc.duration_s } : null;
}
function send(message) {
  protokoll.push({ t_ms: jetzt(), von: "host", methode: message.method || (message.error ? "fehler" : "antwort"), id: message.id === undefined ? null : message.id, inhalt: inhaltVon(message) });
  frame.contentWindow.postMessage(Object.assign({ jsonrpc: "2.0" }, message), "*");
}
function karte() {
  const doc = frame.contentDocument;
  const text = (selector) => { const el = doc.querySelector(selector); return el ? el.textContent.trim() : null; };
  return {
    lang: doc.documentElement.lang,
    status: text('[data-mcp="status"]'),
    dauer: text("[data-duration-display]"),
    ergebnis: text('[data-mcp="result_summary"]'),
    ziel: text("[data-objective-display]"),
    grund: text("[data-failure-display]"),
  };
}
function fertig() {
  if (beendet) return;
  beendet = true;
  setTimeout(() => window[${JSON.stringify(DONE_BINDING)}](JSON.stringify({ protokoll, karte: karte() })), 100);
}
function ergebnisAntwort() {
  const { ergebnis } = KONFIG.szenario;
  return { call_id: KONFIG.callId, result_summary: ergebnis.result_summary, objective_achieved: ergebnis.objective_achieved, outcome: ergebnis.outcome || "", next_step: ergebnis.next_step || "" };
}
function beantworte(m) {
  const name = m.params.name;
  if (name === "get_call_status") {
    const status = Object.assign({ call_id: KONFIG.callId }, statusZu(KONFIG.szenario, simMs(), KONFIG.uhrNachAbgehoben));
    send({ id: m.id, result: { structuredContent: status, content: [] } });
    if (status.status === "failed") fertig();
  } else if (name === "get_call_result") {
    send({ id: m.id, result: { structuredContent: ergebnisAntwort(), content: [], _meta: meta } });
    fertig();
  } else {
    send({ id: m.id, error: { code: -32601, message: "unbekanntes Werkzeug" } });
  }
}
function beiInitialisiert() {
  if (pushed) return;
  pushed = true;
  send({ method: "ui/notifications/host-context-changed", params: { locale: KONFIG.szenario.locale } });
  send({ method: "ui/notifications/tool-result", params: { structuredContent: { call_id: KONFIG.callId, status: "dialing", duration_s: 0 }, _meta: meta } });
}
window.addEventListener("message", (event) => {
  const m = event.data;
  if (event.source !== frame.contentWindow || !m || typeof m !== "object") return;
  protokoll.push({ t_ms: jetzt(), von: "karte", methode: m.method || "antwort", id: m.id === undefined ? null : m.id, werkzeug: m.method === "tools/call" ? m.params.name : null });
  if (m.method === "ui/initialize") send({ id: m.id, result: { protocolVersion: "2026-01-26", hostInfo: { name: "attrappe", version: "0" }, hostCapabilities: {}, hostContext: {} } });
  if (m.method === "ui/notifications/initialized") beiInitialisiert();
  if (m.method === "tools/call") setTimeout(() => beantworte(m), ${REPLY_DELAY_MS});
});
frame.src = "/widget";
`;

function hostSeite(konfig) {
  const json = JSON.stringify(konfig).replaceAll("<", "\\u003c");
  const script = HOST_SCRIPT.replace("__KONFIG__", () => json);
  const style = `border:0;width:${konfig.szenario.breite}px;height:${CARD_HEIGHT_PX}px`;
  return `<!doctype html><html><body style="margin:0"><iframe id="f" style="${style}"></iframe><script>${script}</script></body></html>`;
}

function serve(html, konfig) {
  const host = hostSeite(konfig);
  const server = createServer((request, response) => {
    const seite = request.url === "/" ? host : request.url === "/widget" ? html : null;
    response.writeHead(seite === null ? 404 : 200, { "content-type": "text/html; charset=utf-8" });
    response.end(seite ?? "");
  });
  const listening = new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  return { listening, close: () => server.close() };
}

function szenarioVon(wahl) {
  const szenario = typeof wahl === "string" ? SZENARIEN[wahl] : wahl;
  if (!szenario) throw new Error(`unbekanntes Szenario: ${wahl}`);
  return szenario;
}

export async function spieleAnruffolge(chrome, html, { szenario: wahl, tempo = 1, uhrNachAbgehoben = "weiter" }) {
  const szenario = szenarioVon(wahl);
  const server = serve(html, { szenario, tempo, uhrNachAbgehoben, callId: CALL_ID });
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
    const gemessen = JSON.parse(await done);
    const sprache = { ...sprachHinweis(szenario), gemessen: gemessen.karte.lang };
    return { szenario: typeof wahl === "string" ? wahl : "eigenes", tempo, uhrNachAbgehoben, sprache, ...gemessen };
  } finally {
    await browser.stop();
    if (client) client.close();
    server.close();
  }
}
