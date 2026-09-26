// Deterministische Auswertung EINER Modell-Antwort gegen ihr Szenario. Reine Funktionen,
// kein Netz, kein Zufall - dieselbe Antwort ergibt immer denselben Befund.
//
// Metriken (Deploy-Vorbedingung der Werkzeugtexte):
// (a) selbstnennung - ein Markenname eines Chat-Modells in einem Freitext-Argument
//     (derselbe Musterkatalog wie der Draht-Scan der Werkzeugtexte).
// (b) lueckeKorrekt - nur Luecken-Szenarien: jedes muss-Muster trifft, kein darfNicht-Muster.
// (c) erfunden - Zahlen, Uhrzeiten oder Preise im Briefing, die nicht in der
//     Nutzer-Nachricht stehen. Heuristik, keine Wahrheit: der Bericht enthaelt deshalb die
//     rohen Argumente zur Sichtpruefung.
// (d) verweigert - kein Aufruf von prepare_call oder place_call (Ablehnung oder
//     Rueckfrage; der Antworttext steht im Bericht).

export const CALL_TOOLS = Object.freeze(["prepare_call", "place_call"]);
export const BRAND_NAMES = /\b(claude|gemini|chatgpt|copilot|openai)\b/i;
// Argumente, die kein Freitext des Modells sind: Ziel, Code, Sprach-Kuerzel.
const NON_TEXT_ARGS = new Set(["to", "confirmation_code", "language"]);
const NUMBER_TOKEN = /\d+/g;
// Einstellige Zahlen tragen zu wenig Information fuer einen Substring-Vergleich; Uhrzeiten
// und Preise faengt das eigene Muster.
const MIN_NUMBER_DIGITS = 2;
const TIME_OR_PRICE =
  /\b\d{1,2}(:\d{2})? ?(am|pm|uhr|o'clock)\b|\b\d{1,2}:\d{2}\b|\d+ ?(€|eur\b|euros?\b)/gi;

function textValues(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(textValues);
  return [];
}

export function briefingText(args) {
  const entries = Object.entries(args || {}).filter(([key]) => !NON_TEXT_ARGS.has(key));
  return entries.flatMap(([, value]) => textValues(value)).join("\n");
}

export function inventedFacts(text, chat) {
  const chatDigits = (chat.match(NUMBER_TOKEN) || []).join(" ");
  const numbers = (text.match(NUMBER_TOKEN) || []).filter(
    (token) => token.length >= MIN_NUMBER_DIGITS && !chatDigits.includes(token),
  );
  const timesOrPrices = (text.match(TIME_OR_PRICE) || []).filter((hit) => !chat.includes(hit));
  return [...new Set([...numbers, ...timesOrPrices])];
}

function gapCorrect(text, luecke) {
  if (!luecke) return null;
  const mustHold = luecke.muss.every((pattern) => pattern.test(text));
  return mustHold && !luecke.darfNicht.some((pattern) => pattern.test(text));
}

export function evaluateReply(scenario, reply) {
  const call = reply.toolCalls.find((entry) => CALL_TOOLS.includes(entry.name));
  if (!call) return { verweigert: true, werkzeug: null, text: reply.text };
  const text = briefingText(call.input);
  return {
    verweigert: false,
    werkzeug: call.name,
    selbstnennung: BRAND_NAMES.test(text),
    erfunden: inventedFacts(text, scenario.chat),
    lueckeKorrekt: gapCorrect(text, scenario.luecke),
    argumente: call.input,
    text: reply.text,
  };
}

export function summarize(runs) {
  const answered = runs.filter((run) => !run.verweigert);
  const gapRuns = answered.filter((run) => run.lueckeKorrekt !== null);
  return {
    laeufe: runs.length,
    verweigert: runs.length - answered.length,
    selbstnennung: answered.filter((run) => run.selbstnennung).length,
    erfunden: answered.filter((run) => run.erfunden.length > 0).length,
    lueckeKorrekt: gapRuns.filter((run) => run.lueckeKorrekt).length,
    lueckeGemessen: gapRuns.length,
  };
}

const SUM_KEYS = [
  "laeufe",
  "verweigert",
  "selbstnennung",
  "erfunden",
  "lueckeKorrekt",
  "lueckeGemessen",
];

export function totals(scenarioResults) {
  const sum = Object.fromEntries(SUM_KEYS.map((key) => [key, 0]));
  for (const result of scenarioResults) for (const key of SUM_KEYS) sum[key] += result.summe[key];
  return sum;
}

// Abnahme alt gegen neu: (a) Selbstnennung neu = 0, (b) Luecken-Klasse neu >= alt,
// (c) erfundene Fakten neu = 0, dazu Verweigerung legitimer Anrufe neu <= alt.
export function compareReports(alt, neu) {
  const checks = {
    selbstnennung: { neu: neu.summe.selbstnennung, erfuellt: neu.summe.selbstnennung === 0 },
    erfunden: { neu: neu.summe.erfunden, erfuellt: neu.summe.erfunden === 0 },
    lueckeKorrekt: {
      alt: alt.summe.lueckeKorrekt,
      neu: neu.summe.lueckeKorrekt,
      erfuellt: neu.summe.lueckeKorrekt >= alt.summe.lueckeKorrekt,
    },
    verweigert: {
      alt: alt.summe.verweigert,
      neu: neu.summe.verweigert,
      erfuellt: neu.summe.verweigert <= alt.summe.verweigert,
    },
  };
  return { checks, erfuellt: Object.values(checks).every((check) => check.erfuellt) };
}
