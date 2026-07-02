// TeXML/TwiML-Parser fuer die Conversation-Bench (tasks/convo-bench-spec.md §3a).
// Reiner Regex-Parser (kein XML-Parser-Dep noetig, G25: Konstanten statt verstreuter
// Magic-Strings) - extrahiert Say-Texte + Gather/Hangup-Marker + die naechste Turn-URL
// aus dem von /voice/* gerenderten Provider-Body (TwiML ODER TeXML, beide Provider
// nutzen dieselben Tag-Namen <Say>/<Gather>/<Hangup>, siehe src/telephony/adapters/*).
const SAY_RE = /<Say[^>]*>([\s\S]*?)<\/Say>/g;
const GATHER_ACTION_RE = /<Gather\b[^>]*\baction="([^"]*)"/;

// XML-Entities in Sprich-Text zurueck in Klartext. Reihenfolge: spezifische Entities
// zuerst, &amp; zuletzt - sonst wuerden doppelt kodierte Zeichen falsch dekodiert.
function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Loest die Gather-action-URL IMMER gegen den echten gespawnten Server auf (baseUrl =
// srv.localUrl). Telnyx rendert eine ABSOLUTE URL mit der (in Tests nicht real
// erreichbaren) config.publicUrl-Domain (turnDirectives, server.js: `base =
// isTelnyx ? config.publicUrl : ""`) - ein blosses new URL(action, baseUrl) wuerde bei
// einer absoluten Action deren fremden Origin behalten. Deshalb wird NUR Pfad+Query
// aus der Action uebernommen, der Origin kommt immer von baseUrl.
function resolveTurnUrl(actionAttr, baseUrl) {
  const parsed = new URL(actionAttr, baseUrl);
  return new URL(parsed.pathname + parsed.search, baseUrl).toString();
}

// Parst einen TwiML/TeXML-Body in die fuer die Bench relevanten Signale.
export function parseVoiceBody(body, baseUrl) {
  const sayTexts = [...body.matchAll(SAY_RE)].map((m) => decodeXmlEntities(m[1]));
  const hasGather = body.includes("<Gather");
  const hasHangup = body.includes("<Hangup");
  const actionMatch = body.match(GATHER_ACTION_RE);
  const nextTurnUrl = actionMatch ? resolveTurnUrl(actionMatch[1], baseUrl) : null;
  return { sayTexts, hasGather, hasHangup, nextTurnUrl };
}
