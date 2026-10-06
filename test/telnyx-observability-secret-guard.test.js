import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FORBIDDEN_IDENTIFIERS = [
  /config\.(telnyx\w*\.)?\w*Secret/,
  /config\.telnyxApiKey/,
  /req\.headers\.authorization/i,
  /telnyx-signature-ed25519/,
  /\brawBody\b/,
];
const FORBIDDEN_SUBSTRINGS = [/secret/i, /apikey/i, /authorization/i];
const E164_LITERAL = /\+\d{8,15}/;
const ALL_FORBIDDEN_PATTERNS = [...FORBIDDEN_IDENTIFIERS, ...FORBIDDEN_SUBSTRINGS, E164_LITERAL];

const CONSOLE_CALL_START = /console\.(?:log|warn|error|info|debug)\s*\(/y;

const WHOLE_FILE_SCAN_TARGETS = [
  ["telephony/adapters/telnyx/voice.js", "../src/telephony/adapters/telnyx/voice.js"],
  ["routes/voice.js", "../src/routes/voice.js"],
];

function skipString(source, start, quote) {
  let i = start + 1;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    i++;
  }
  return n;
}

function skipCommentOrString(source, i) {
  const n = source.length;
  const c = source[i];
  if (c === "/" && source[i + 1] === "/") {
    const nextNewline = source.indexOf("\n", i);
    return nextNewline === -1 ? n : nextNewline;
  }
  if (c === "/" && source[i + 1] === "*") {
    const end = source.indexOf("*/", i + 2);
    return end === -1 ? n : end + 2;
  }
  if (c === '"' || c === "'" || c === "`") {
    return skipString(source, i, c);
  }
  return null;
}

function matchingParen(source, open) {
  let depth = 0;
  let i = open;
  const n = source.length;
  while (i < n) {
    const skipTo = skipCommentOrString(source, i);
    if (skipTo !== null) {
      i = skipTo;
      continue;
    }
    const c = source[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return n;
}

function extractConsoleCallArgs(source) {
  const argTexts = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const skipTo = skipCommentOrString(source, i);
    if (skipTo !== null) {
      i = skipTo;
      continue;
    }
    CONSOLE_CALL_START.lastIndex = i;
    if (CONSOLE_CALL_START.test(source)) {
      const open = source.indexOf("(", i);
      const close = matchingParen(source, open);
      argTexts.push(source.slice(open + 1, close));
      i = close + 1;
      continue;
    }
    i++;
  }
  return argTexts;
}

function findLeaks(argTexts) {
  const leaks = [];
  for (const arg of argTexts) {
    for (const pattern of ALL_FORBIDDEN_PATTERNS) {
      if (pattern.test(arg)) {
        leaks.push({ pattern: String(pattern), arg: arg.slice(0, 120) });
      }
    }
  }
  return leaks;
}

function srcPath(relativePath) {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

function assertNoConsoleLeak(label, source) {
  const argTexts = extractConsoleCallArgs(source);
  assert.ok(argTexts.length > 0, `keine console.*-Aufrufe in ${label} gefunden - Scanner- oder Datei-Drift`);
  const leaks = findLeaks(argTexts);
  assert.ok(leaks.length === 0, `Secret/PII-Leak in ${label}: ${JSON.stringify(leaks)}`);
}

for (const [label, relativePath] of WHOLE_FILE_SCAN_TARGETS) {
  test(`${label}: console.*-Logs leaken keine Secrets/PII`, () => {
    const source = readFileSync(srcPath(relativePath), "utf8");
    assertNoConsoleLeak(label, source);
  });
}

test("Detektor faengt einen synthetischen Leak (Positiv-Kontrolle)", () => {
  const synthetic = [
    "console.log(`bearer=${config.telnyxShimSharedSecret}`);",
    'console.warn("caller " + "+491700000000");',
    "console.error(req.headers.authorization);",
  ].join("\n");
  const argTexts = extractConsoleCallArgs(synthetic);
  assert.equal(argTexts.length, 3, "Scanner muss die 3 synthetischen console-Aufrufe finden");
  assert.ok(findLeaks(argTexts).length >= 3, "Detektor muss die 3 synthetischen Leaks fangen");
});

test("Detektor findet Leak trotz escapetem Anfuehrungszeichen im String (Grenzfall skipString)", () => {
  const synthetic = 'console.warn("bad\\")" + config.telnyxApiKey);';
  const argTexts = extractConsoleCallArgs(synthetic);
  assert.equal(argTexts.length, 1, "Scanner muss den einen console-Aufruf trotz Escape-Grenzfall finden");
  const leaks = findLeaks(argTexts);
  assert.ok(
    leaks.some((leak) => leak.pattern === String(/config\.telnyxApiKey/)),
    "Detektor muss das Secret nach dem escapeten Anfuehrungszeichen finden",
  );
});
