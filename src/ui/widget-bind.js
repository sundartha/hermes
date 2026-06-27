// Gemeinsames Daten-Binding fuer ALLE Hermes-Widgets (W1). Fuellt die
// [data-mcp="<key>"]-Slots der self-contained Iframe-HTML aus dem host-gepushten
// structuredContent (server-gewhitelistet, SEP-1865). Eine Quelle, EINMAL je Serve
// in jede Widget-HTML injiziert (siehe widget-catalog.js) - kein Copy-Paste je .html
// (G5/S2). Der Iframe-Script-Text BIND_SCRIPT ist eine Projektion DERSELBEN Funktionen
// (Function.prototype.toString), damit die Logik nur einmal existiert und ohne DOM
// (node:test) pruefbar bleibt.
//
// Host-Bruecke wird per Feature-Detection gelesen (keine Konvention hart verdrahtet);
// fehlt sie, bleibt die Karte still mit "—" (fail-safe no-op, kein Crash im Host).
// XSS-Disziplin: Werte landen AUSSCHLIESSLICH ueber textContent im DOM, NIE ueber
// innerHTML - host-gepushte Strings werden damit nie als Markup interpretiert.

// CSS-Klasse je gerenderter Transkriptzeile - matcht .turn in den Widget-Styles.
const LINE_CLASS = "turn";

// true nur fuer ein nicht-null Objekt (geteilte Pruefung, keine Duplizierung G5).
export function isObject(value) {
  return typeof value === "object" && value !== null;
}

// Feature-Detection der synchronen Host-Bruecke. Erste vorhandene Konvention gewinnt;
// keine Bruecke -> null (fail-safe no-op).
//   (a) ChatGPT/skybridge:  root.openai.toolOutput
//   (b) MCP-nativ/Claude:   root.mcpToolOutput  (Kandidat, im W2-Smoke zu bestaetigen)
export function readHostData(root) {
  if (!isObject(root)) return null;
  if (isObject(root.openai) && isObject(root.openai.toolOutput)) return root.openai.toolOutput;
  if (isObject(root.mcpToolOutput)) return root.mcpToolOutput;
  return null;
}

// MCP-nativer postMessage-Handshake: zieht das Tool-Output aus einem message-Event.
//   Kandidaten-Schluessel: event.data.toolOutput | event.data.structuredContent
export function readMessageData(message) {
  if (!isObject(message) || !isObject(message.data)) return null;
  const payload = message.data;
  if (isObject(payload.toolOutput)) return payload.toolOutput;
  if (isObject(payload.structuredContent)) return payload.structuredContent;
  return null;
}

// Array -> je Zeile ein <div class="turn"> mit textContent (XSS-sicher). Container
// vorher leeren (kanonisches DOM-Clear), damit erneutes Binden nicht doppelt rendert.
export function renderLines(doc, container, lines) {
  while (container.firstChild) container.removeChild(container.firstChild);
  for (const line of lines) {
    const div = doc.createElement("div");
    div.className = LINE_CLASS;
    div.textContent = String(line);
    container.appendChild(div);
  }
}

// Fuellt ALLE Slots eines Schluessels. Array -> renderLines, sonst textContent.
// Fehlender Slot -> no-op (Selektor-Treffer leer).
export function applyField(doc, key, value) {
  const nodes = doc.querySelectorAll('[data-mcp="' + key + '"]');
  for (const el of nodes) {
    if (Array.isArray(value)) renderLines(doc, el, value);
    else el.textContent = String(value);
  }
}

// Iteriert die Schluessel des Host-Objekts; null/undefined uebersprungen (Slot bleibt —).
export function bind(doc, data) {
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (value === null || value === undefined) continue;
    applyField(doc, key, value);
  }
}

// Bootstrap im Iframe: synchrone Bruecke lesen + binden, dann den message-Listener
// (postMessage-Handshake) registrieren. Alles fail-safe (kein Crash ohne Bruecke/DOM).
export function run(root) {
  try {
    const doc = root && root.document;
    if (!doc) return;
    const initial = readHostData(root);
    if (initial) bind(doc, initial);
    if (typeof root.addEventListener === "function") {
      root.addEventListener("message", (event) => {
        const data = readMessageData(event);
        if (data) bind(doc, data);
      });
    }
  } catch (e) {
    // fail-safe no-op: ohne Bruecke/Daten bleibt die Karte mit — (kein Fehler im Host)
  }
}

// Projiziert dieselben Funktionen als Iframe-Script-Text (eine Quelle, G5/S2). Die
// Funktionsdeklarationen sind im IIFE gehoistet -> Querverweise + LINE_CLASS im Scope.
function buildBindScript() {
  const body = [
    '"use strict";',
    `var LINE_CLASS = ${JSON.stringify(LINE_CLASS)};`,
    isObject.toString(),
    readHostData.toString(),
    readMessageData.toString(),
    renderLines.toString(),
    applyField.toString(),
    bind.toString(),
    run.toString(),
    "run(window);",
  ].join("\n");
  return `<script>\n(function () {\n${body}\n})();\n</script>`;
}

// Geteilte Binding-Quelle, EINMAL je Serve in die Widget-HTML injiziert (G5/S2).
export const BIND_SCRIPT = buildBindScript();
