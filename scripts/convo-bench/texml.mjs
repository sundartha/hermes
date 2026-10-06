const SAY_RE = /<Say[^>]*>([\s\S]*?)<\/Say>/g;
const GATHER_ACTION_RE = /<Gather\b[^>]*\baction="([^"]*)"/;

function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function resolveTurnUrl(actionAttr, baseUrl) {
  const parsed = new URL(actionAttr, baseUrl);
  return new URL(parsed.pathname + parsed.search, baseUrl).toString();
}

export function parseVoiceBody(body, baseUrl) {
  const sayTexts = [...body.matchAll(SAY_RE)].map((m) => decodeXmlEntities(m[1]));
  const hasGather = body.includes("<Gather");
  const hasHangup = body.includes("<Hangup");
  const actionMatch = body.match(GATHER_ACTION_RE);
  const nextTurnUrl = actionMatch ? resolveTurnUrl(actionMatch[1], baseUrl) : null;
  return { sayTexts, hasGather, hasHangup, nextTurnUrl };
}
