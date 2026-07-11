// SAFE-1 Regressionsguard: verhindert, dass eine kuenftige Aenderung an den
// Telnyx-Observability-Logs (OBS-1/2/3/FLAG) ein Secret oder eine Rufnummer
// (PII) direkt in eine console.*-Zeile einschleust.
//
// Scan-Einheit sind ausschliesslich die Argument-Slices von console.*-Aufrufen
// (String-/Kommentar-bewusst), NICHT der gesamte Dateitext. Grund: der rohe
// Dateitext erzeugt False Positives, die schon auf dem unveraenderten Bestand
// rot waeren (z.B. `Authorization: Bearer ${config.telnyxApiKey}` im
// Request-Header-Aufbau, `const secret = config.telnyxShimSharedSecret` als
// reine Zuweisung, das Wort "rawBody" in einem Kommentar). Nur was tatsaechlich
// in einer console-Ausgabe landet, ist fuer Regel 4 (Secrets nie loggen)
// relevant.
//
// Bewusste Grenze: Payloads hinter Log-Wrappern (z.B. logShimGate(payload) in
// telnyx-llm-shim.js) werden hier NICHT statisch aufgeloest - die console-
// Zeile des Wrappers traegt selbst kein Geheimnis, das Geheimnis koennte aber
// theoretisch in den Payload-Objekten an den Aufrufstellen landen. Diese
// dynamische Pruefung leistet der OBS-1-Laufzeittest (Console-Spy + Fixture
// mit Fake-Secret/Fake-Transkript). SAFE-1 ist der statische Komplement dazu
// und faengt die haeufigste Leak-Form: ein Secret oder eine Rufnummer direkt
// als console.*-Argument.
//
// Zwei Tripwires gegen einen still wertlos werdenden Guard: (1) jede Scan-
// Einheit muss mindestens einen console.*-Aufruf enthalten (sonst waere ein
// Umbenennen von console.* auf einen Wrapper ein unbemerkter Blackout);
// (2) der Region-Schnitt fuer server.js muss seine Textanker finden (sonst
// waere ein Bruch der /voice-Middleware-Struktur ein stiller Leerlauf-Pass).
// Beide Faelle sollen laut scheitern statt leise gruen zu bleiben.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Familie 1: exakte Bezeichner der realen Secrets/Auth-Kanaele in diesem Scope
// (verifiziert gegen src/config.js: telnyxApiKey, telnyxShimSharedSecret).
const FORBIDDEN_IDENTIFIERS = [
  /config\.telnyx\w*Secret/,
  /config\.telnyxApiKey/,
  /req\.headers\.authorization/i,
  /telnyx-signature-ed25519/,
  /\brawBody\b/,
];
// Familie 2: generischer Teilstring-Fang gegen Rename-Umgehung der exakten
// Bezeichner oben (Pre-Mortem: "Regex zu eng, ein Rename schluepft durch").
const FORBIDDEN_SUBSTRINGS = [/secret/i, /apikey/i, /authorization/i];
// Familie 3: hartcodierte E.164-Rufnummer direkt in einer Log-Zeile.
const E164_LITERAL = /\+\d{8,15}/;
const ALL_FORBIDDEN_PATTERNS = [...FORBIDDEN_IDENTIFIERS, ...FORBIDDEN_SUBSTRINGS, E164_LITERAL];

// Sticky-Regex: prueft an genau der aktuellen Scan-Position, ob dort ein
// console.<method>( beginnt.
const CONSOLE_CALL_START = /console\.(?:log|warn|error|info|debug)\s*\(/y;

const VOICE_MIDDLEWARE_START_MARKER = 'app.use("/voice"';
const VOICE_MIDDLEWARE_END_MARKER = "\n});";

// G35: die gescannten Dateien als benannte Ziel-Tabelle (kein Wert verstreut).
const WHOLE_FILE_SCAN_TARGETS = [
  ["telnyx-llm-shim.js", "../src/telnyx-llm-shim.js"],
  ["telnyx-call-control-ingest.js", "../src/telnyx-call-control-ingest.js"],
  ["telephony/adapters/telnyx/voice.js", "../src/telephony/adapters/telnyx/voice.js"],
];

// Index direkt nach dem schliessenden Anfuehrungszeichen von quote, beginnend
// bei start (der oeffnenden Quote). Respektiert Backslash-Escapes.
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

// Index der zu open (Position eines "(") gehoerenden, balancierten ")".
// Strings/Kommentare zwischen den Klammern werden beim Zaehlen ausgespart,
// damit eine ")" oder "(" im Log-Text die Klammer-Balance nicht verfaelscht.
function matchingParen(source, open) {
  let depth = 0;
  let i = open;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      const nextNewline = source.indexOf("\n", i);
      if (nextNewline === -1) return n;
      i = nextNewline;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(source, i, c);
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return n;
}

// String-/Kommentar-bewusster Einpass-Scanner: liefert die Roh-Slices der
// Argumentlisten aller console.<method>(...)-Aufrufe in source. In // und
// /* */-Kommentaren sowie in '/"/`-Strings werden weder console-Treffer
// erkannt noch Klammern gezaehlt.
function extractConsoleCallArgs(source) {
  const argTexts = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      const nextNewline = source.indexOf("\n", i);
      if (nextNewline === -1) break;
      i = nextNewline;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(source, i, c);
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

// Kartesisch Arg x ALL_FORBIDDEN_PATTERNS; liefert einen Treffer pro Fund mit
// lesbarem, gekuerztem Arg-Snippet fuer die Fehlermeldung.
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

// Schneidet die /voice-Middleware-Region aus server.js anhand zweier
// semantischer Textanker (kein bruechiger Datei:Zeile-Verweis, vgl. C2).
// ok=false signalisiert einen gebrochenen Anker (fail-loud statt leerer Scan).
function voiceMiddlewareRegion(serverSource) {
  const start = serverSource.indexOf(VOICE_MIDDLEWARE_START_MARKER);
  if (start === -1) return { ok: false, region: "" };
  const rest = serverSource.slice(start);
  const relativeEnd = rest.indexOf(VOICE_MIDDLEWARE_END_MARKER);
  if (relativeEnd === -1) return { ok: false, region: "" };
  return { ok: true, region: rest.slice(0, relativeEnd) };
}

function srcPath(relativePath) {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

// Eine Assertion-Quelle fuer alle Scan-Tests (G5): baut auf denselben zwei
// Tripwires (Vacuous-Pass, Leak-Fund) auf.
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

test("server.js /voice-Middleware: console.*-Logs leaken keine Secrets/PII", () => {
  const serverSource = readFileSync(srcPath("../src/server.js"), "utf8");
  const { ok, region } = voiceMiddlewareRegion(serverSource);
  assert.ok(ok, "Anker der /voice-Middleware in server.js nicht gefunden - Region-Drift");
  assertNoConsoleLeak("server.js /voice-Middleware", region);
});

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
