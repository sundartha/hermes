// SAFE-1 Regressionsguard: verhindert, dass eine kuenftige Aenderung an den
// Telnyx-Observability-Logs (OBS-1/2/3/FLAG) ein Secret oder eine Rufnummer
// (PII) direkt in eine console.*-Zeile einschleust.
//
// Scan-Einheit sind ausschliesslich die Argument-Slices von console.*-Aufrufen
// (String-/Kommentar-bewusst), NICHT der gesamte Dateitext. Grund: der rohe
// Dateitext erzeugt False Positives, die schon auf dem unveraenderten Bestand
// rot waeren (z.B. `Authorization: Bearer ${config.telnyxApiKey}` im
// Request-Header-Aufbau, `const secret = config.telnyxAssistant.shimSharedSecret` als
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
// Eine Tripwire gegen einen still wertlos werdenden Guard: jede Scan-Einheit
// muss mindestens einen console.*-Aufruf enthalten (sonst waere ein Umbenennen
// von console.* auf einen Wrapper ein unbemerkter Blackout). Dieser Fall soll
// laut scheitern statt leise gruen zu bleiben.
//
// P11 (Server-Slim): die /voice-Webhooks (inkl. der Signatur-Middleware) leben
// jetzt komplett in src/routes/voice.js. Der frühere Region-Schnitt aus
// server.js (Textanker um app.use("/voice", ...)) ist damit entfallen -
// routes/voice.js laeuft stattdessen als vollstaendiges Whole-File-Scan-Ziel
// (WHOLE_FILE_SCAN_TARGETS): deckt dieselbe [voice-signature]-Log-Zeile + alle
// Handler-Logs ab, staerker als der alte Regionsschnitt (keine Textanker, die
// bei einem Strukturbruch brechen koennten - readFileSync scheitert bereits
// laut, wenn die Datei fehlt).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Familie 1: exakte Bezeichner der realen Secrets/Auth-Kanaele in diesem Scope
// (verifiziert gegen src/config.js: telnyxApiKey, telnyxAssistant.shimSharedSecret).
const FORBIDDEN_IDENTIFIERS = [
  /config\.(telnyx\w*\.)?\w*Secret/,
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

// G35: die gescannten Dateien als benannte Ziel-Tabelle (kein Wert verstreut).
const WHOLE_FILE_SCAN_TARGETS = [
  ["telnyx-llm-shim.js", "../src/telnyx-llm-shim.js"],
  ["telnyx-call-control-ingest.js", "../src/telnyx-call-control-ingest.js"],
  ["telephony/adapters/telnyx/voice.js", "../src/telephony/adapters/telnyx/voice.js"],
  ["routes/voice.js", "../src/routes/voice.js"],
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

// Gemeinsamer Kommentar-/String-Ueberspring-Schritt fuer matchingParen() und
// extractConsoleCallArgs() (G5: vorher wortgleich in beiden dupliziert, mit
// bereits eingetretener Drift beim unterminierten //-Kommentar am Dateiende).
// Beginnt an source[i] ein // - oder /* */ -Kommentar oder ein '/"/`-String,
// liefert die Funktion den naechsten zu scannenden Index (bei unterminiertem
// Token: source.length, sodass die aufrufende Schleife regulaer ueber die
// Abbruchbedingung i < n endet). Beginnt an i weder Kommentar noch String,
// liefert sie null - der Aufrufer scannt i selbst regulaer weiter.
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

// Index der zu open (Position eines "(") gehoerenden, balancierten ")".
// Strings/Kommentare zwischen den Klammern werden beim Zaehlen ausgespart,
// damit eine ")" oder "(" im Log-Text die Klammer-Balance nicht verfaelscht.
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

// String-/Kommentar-bewusster Einpass-Scanner: liefert die Roh-Slices der
// Argumentlisten aller console.<method>(...)-Aufrufe in source. In // und
// /* */-Kommentaren sowie in '/"/`-Strings werden weder console-Treffer
// erkannt noch Klammern gezaehlt.
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

// T1/G3: gezielter Grenzfall fuer den Escape-Zweig in skipString() (c === "\\").
// Ein escapetes Anfuehrungszeichen (\") gefolgt von einer schliessenden Klammer
// STEHT INNERHALB des Strings. Ohne die Escape-Behandlung wuerde skipString()
// den String bereits am escapeten Zeichen fuer beendet halten - die danach
// folgende ")" waere dann keine String-, sondern eine echte Klammer und wuerde
// matchingParen() vorzeitig schliessen, BEVOR das Secret im Argument ueberhaupt
// gescannt wird. Genau der False-Negative-Pfad, den G3 (Grenzfaelle testen)
// hier verlangt.
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
