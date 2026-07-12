// Gemeinsames Daten-Binding + Host-Handshake fuer ALLE Hermes-Widgets. Spricht die
// MCP-Apps-UI-Bridge (apps.mdx 2026-01-26): JSON-RPC 2.0 ueber postMessage an
// window.parent. Der Host rendert das Iframe NUR, wenn das Widget den Handshake fuehrt
// UND seine Hoehe meldet - sonst bleibt es leer (Anthropic-Doku: "Missing app.connect()
// calls" + "Iframe height issues" als haeufigste Unsichtbar-Ursachen). Genau EINE Quelle,
// EINMAL je Widget-HTML injiziert (siehe widget-catalog.js); der Iframe-Script-Text
// BIND_SCRIPT ist eine Projektion DERSELBEN Funktionen (Function.prototype.toString).
//
// Reihenfolge im Iframe: ui/initialize -> Host-Antwort -> ui/notifications/initialized
// + Hoehe melden; Host pusht ui/notifications/tool-result -> structuredContent binden +
// Hoehe melden. XSS-Disziplin: Werte landen AUSSCHLIESSLICH ueber textContent, NIE ueber
// innerHTML - host-gepushte Strings werden damit nie als Markup interpretiert.
//
// Nach der Host-Antwort wird zusaetzlich GENAU EINMAL "ui ready" signalisiert (Flag +
// CustomEvent, siehe signalUiReady). Erst danach darf ein Widget eigene tools/call
// senden (Konsument: das Inline-Skript von widgets/call.html) - vor dem Handshake
// beantwortet der Host keinen Tool-Call.

// CSS-Klasse je gerenderter Transkriptzeile - matcht .turn in den Widget-Styles.
const LINE_CLASS = "turn";

// Objekt-Listen (z.B. list_calls / get_calendar): ein data-mcp-Slot rendert eine
// Liste von Objekten als wiederholte Rows. Welche Sub-Felder eine Row zeigt,
// deklariert der Slot generisch im HTML via data-mcp-row="feld1,feld2,..." - das
// Binding kennt KEINE konkreten Widget-Felder (OCP, eine Quelle fuer alle Listen).
const ROW_CLASS = "row";
const CELL_CLASS = "cell";
const ROW_FIELDS_ATTR = "data-mcp-row";
const FIELD_ATTR = "data-field";
const FIELD_SEP = ",";

// MCP-Apps-UI-Bridge: Methodennamen + Protokollversion zentral (keine Magic-Strings,
// EINE Quelle). INIT_ID = JSON-RPC-id der initialize-Anfrage (1, kein Magic-Wert).
const UI_PROTOCOL_VERSION = "2026-01-26";
const METHOD_INITIALIZE = "ui/initialize";
const METHOD_INITIALIZED = "ui/notifications/initialized";
const METHOD_TOOL_RESULT = "ui/notifications/tool-result";
const METHOD_SIZE_CHANGED = "ui/notifications/size-changed";
const INIT_ID = 1;

// Ready-Signal (Handshake beantwortet). Konsument ist das self-contained Inline-Skript
// von call.html, das nicht importieren kann - diese beiden Namen sind deshalb DER
// Vertrag zwischen beiden Skripten (exportiert, damit ein Sync-Test sie zusammenhaelt).
export const UI_READY_FLAG = "__hermesUiReady";
export const UI_READY_EVENT = "hermes:ui-ready";

// true nur fuer ein nicht-null Objekt (geteilte Pruefung, keine Duplizierung G5).
export function isObject(value) {
  return typeof value === "object" && value !== null;
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

// Liest die deklarierten Row-Felder eines Containers (data-mcp-row="a,b,c").
// Kein Attribut / leere Deklaration -> [] (der Aufrufer faellt dann auf die flache
// Zeilen-Sicht renderLines zurueck). getAttribute fehlt im Fake-DOM -> defensiv null.
export function rowFields(container) {
  const raw = container.getAttribute ? container.getAttribute(ROW_FIELDS_ATTR) : null;
  if (!raw) return [];
  return raw.split(FIELD_SEP).map((f) => f.trim()).filter(Boolean);
}

// Liste von Objekten -> je Eintrag eine Row mit einer Zelle je deklariertem Feld
// (data-mcp-row am Container). Werte landen AUSSCHLIESSLICH ueber textContent
// (XSS-sicher, nie innerHTML); fehlende Felder -> leere Zelle (kein Crash). Container
// vorher leeren (kein Doppeln beim erneuten Binden) - dieselbe 3-arg-Signatur und
// Disziplin wie renderLines.
export function renderRows(doc, container, items) {
  const fields = rowFields(container);
  while (container.firstChild) container.removeChild(container.firstChild);
  for (const item of items) {
    const row = doc.createElement("div");
    row.className = ROW_CLASS;
    for (const field of fields) {
      const cell = doc.createElement("span");
      cell.className = CELL_CLASS;
      if (cell.setAttribute) cell.setAttribute(FIELD_ATTR, field);
      const value = isObject(item) ? item[field] : undefined;
      cell.textContent = value === null || value === undefined ? "" : String(value);
      row.appendChild(cell);
    }
    container.appendChild(row);
  }
}

// Fuellt ALLE Slots eines Schluessels. Array von Objekten mit deklarierten Row-Feldern
// (data-mcp-row) -> renderRows; sonst Array -> renderLines (skalare Zeilen); sonst
// textContent. Fehlender Slot -> no-op (Selektor-Treffer leer).
export function applyField(doc, key, value) {
  const nodes = doc.querySelectorAll('[data-mcp="' + key + '"]');
  for (const el of nodes) {
    if (Array.isArray(value)) {
      if (rowFields(el).length) renderRows(doc, el, value);
      else renderLines(doc, el, value);
    } else {
      el.textContent = String(value);
    }
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

// Postet eine JSON-RPC-Nachricht an den Host (window.parent). Im sandboxed Iframe hat
// das Widget einen null-Origin -> targetOrigin "*" (der Host filtert seinerseits).
// Fehlt der parent (kein Host/Fake-DOM) -> no-op (fail-safe).
export function postToHost(root, message) {
  const parent = root && root.parent;
  if (parent && typeof parent.postMessage === "function") parent.postMessage(message, "*");
}

// Aktuelle Inhaltshoehe an den Host melden - sonst bleibt das Iframe 0/leer (apps.mdx:
// der Host MUSS auf ui/notifications/size-changed hoeren und die Iframe-Dimension
// nachziehen). body fehlt im Fake-DOM -> 0 (kein Crash).
export function reportSize(root) {
  const body = root && root.document && root.document.body;
  const height = body && body.scrollHeight ? body.scrollHeight : 0;
  const width = body && body.scrollWidth ? body.scrollWidth : 0;
  postToHost(root, { jsonrpc: "2.0", method: METHOD_SIZE_CHANGED, params: { width, height } });
}

// Signalisiert GENAU EINMAL, dass der Host-Handshake beantwortet ist: Flag am window
// (late-safe fuer Skripte, die SPAETER laufen - das BIND_SCRIPT wird nach dem Inline-
// Skript injiziert) UND ein CustomEvent (fuer Skripte, die frueher liefen und warten).
// Ohne CustomEvent/dispatchEvent (kein Browser) bleibt das Flag die einzige Wirkung
// (fail-safe, kein Crash).
export function signalUiReady(root) {
  if (!root || root[UI_READY_FLAG]) return;
  root[UI_READY_FLAG] = true;
  if (typeof root.CustomEvent !== "function" || typeof root.dispatchEvent !== "function") return;
  root.dispatchEvent(new root.CustomEvent(UI_READY_EVENT));
}

// Behandelt eine eingehende Host-Nachricht: Antwort auf ui/initialize -> initialized
// bestaetigen + Hoehe melden; ui/notifications/tool-result -> structuredContent binden +
// Hoehe melden. Unbekannte Nachrichten -> no-op. Gibt true zurueck, wenn gebunden wurde.
export function handleHostMessage(root, doc, message) {
  if (!isObject(message)) return false;
  if (message.id === INIT_ID && isObject(message.result)) {
    postToHost(root, { jsonrpc: "2.0", method: METHOD_INITIALIZED, params: {} });
    reportSize(root);
    signalUiReady(root); // erst NACH bestaetigtem initialized duerfen Tool-Calls raus
    return false;
  }
  if (message.method === METHOD_TOOL_RESULT && isObject(message.params)) {
    const data = message.params.structuredContent;
    if (isObject(data)) bind(doc, data);
    reportSize(root);
    return true;
  }
  return false;
}

// Bootstrap im Iframe: Handshake starten (ui/initialize an den Host), auf Host-Nachrichten
// lauschen und die Hoehe bei DOM-Aenderungen nachmelden. Alles fail-safe (kein Crash ohne
// Host/DOM); ohne diesen Handshake + die Hoehenmeldung rendert der Host das Widget nicht.
export function run(root) {
  try {
    const doc = root && root.document;
    if (!doc) return;
    postToHost(root, {
      jsonrpc: "2.0",
      id: INIT_ID,
      method: METHOD_INITIALIZE,
      params: {
        // appInfo (NICHT clientInfo): SEP-1865 macht appInfo im ui/initialize zur
        // PFLICHT (McpUiInitializeRequestSchema, non-optional). Der Host validiert die
        // Anfrage gegen dieses Schema; fehlt appInfo, antwortet er mit JSON-RPC-error
        // statt result -> das Widget bestaetigt nie initialized -> der Host liefert nie
        // tool-result -> nichts rendert. Genau das passierte mit dem alten clientInfo.
        appCapabilities: { availableDisplayModes: ["inline"] },
        appInfo: { name: "hermes-widget", version: "1.0.0" },
        protocolVersion: UI_PROTOCOL_VERSION,
      },
    });
    // PROAKTIV: Hoehe sofort melden, NICHT auf eine Host-Antwort warten. Bleibt die
    // initialize-Antwort aus (Host-Handshake leicht abweichend), bekommt das Iframe so
    // trotzdem eine Hoehe statt 0/leer zu bleiben - die haeufigste Unsichtbar-Ursache.
    reportSize(root);
    if (typeof root.addEventListener === "function") {
      root.addEventListener("message", (event) => handleHostMessage(root, doc, event && event.data));
      // Nach vollstaendigem Layout (Fonts/Bilder) Hoehe nachmelden.
      root.addEventListener("load", () => reportSize(root));
    }
    if (typeof root.ResizeObserver === "function" && doc.body) {
      new root.ResizeObserver(() => reportSize(root)).observe(doc.body);
    }
  } catch (e) {
    // fail-safe no-op: ohne Host/DOM bleibt die Karte still (kein Fehler im Host)
  }
}

// Projiziert dieselben Funktionen als Iframe-Script-Text (eine Quelle, G5/S2). Die
// Funktionsdeklarationen sind im IIFE gehoistet -> Querverweise + Konstanten im Scope.
function buildBindScript() {
  const body = [
    '"use strict";',
    `var LINE_CLASS = ${JSON.stringify(LINE_CLASS)};`,
    `var ROW_CLASS = ${JSON.stringify(ROW_CLASS)};`,
    `var CELL_CLASS = ${JSON.stringify(CELL_CLASS)};`,
    `var ROW_FIELDS_ATTR = ${JSON.stringify(ROW_FIELDS_ATTR)};`,
    `var FIELD_ATTR = ${JSON.stringify(FIELD_ATTR)};`,
    `var FIELD_SEP = ${JSON.stringify(FIELD_SEP)};`,
    `var UI_PROTOCOL_VERSION = ${JSON.stringify(UI_PROTOCOL_VERSION)};`,
    `var METHOD_INITIALIZE = ${JSON.stringify(METHOD_INITIALIZE)};`,
    `var METHOD_INITIALIZED = ${JSON.stringify(METHOD_INITIALIZED)};`,
    `var METHOD_TOOL_RESULT = ${JSON.stringify(METHOD_TOOL_RESULT)};`,
    `var METHOD_SIZE_CHANGED = ${JSON.stringify(METHOD_SIZE_CHANGED)};`,
    `var INIT_ID = ${JSON.stringify(INIT_ID)};`,
    `var UI_READY_FLAG = ${JSON.stringify(UI_READY_FLAG)};`,
    `var UI_READY_EVENT = ${JSON.stringify(UI_READY_EVENT)};`,
    isObject.toString(),
    renderLines.toString(),
    rowFields.toString(),
    renderRows.toString(),
    applyField.toString(),
    bind.toString(),
    postToHost.toString(),
    reportSize.toString(),
    signalUiReady.toString(),
    handleHostMessage.toString(),
    run.toString(),
    "run(window);",
  ].join("\n");
  return `<script>\n(function () {\n${body}\n})();\n</script>`;
}

// Geteilte Binding-Quelle, EINMAL je Serve in die Widget-HTML injiziert (G5/S2).
export const BIND_SCRIPT = buildBindScript();
