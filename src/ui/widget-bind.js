const LINE_CLASS = "turn";

const ROW_CLASS = "row";
const CELL_CLASS = "cell";
const ROW_FIELDS_ATTR = "data-mcp-row";
const FIELD_ATTR = "data-field";
const FIELD_SEP = ",";

const UI_PROTOCOL_VERSION = "2026-01-26";
const METHOD_INITIALIZE = "ui/initialize";
const METHOD_INITIALIZED = "ui/notifications/initialized";
export const METHOD_TOOL_RESULT = "ui/notifications/tool-result";
const METHOD_SIZE_CHANGED = "ui/notifications/size-changed";
const INIT_ID = 1;

export const UI_READY_FLAG = "__hermesUiReady";
export const UI_READY_EVENT = "hermes:ui-ready";

export function isObject(value) {
  return typeof value === "object" && value !== null;
}

export function renderLines(doc, container, lines) {
  while (container.firstChild) container.removeChild(container.firstChild);
  for (const line of lines) {
    const div = doc.createElement("div");
    div.className = LINE_CLASS;
    div.textContent = String(line);
    container.appendChild(div);
  }
}

export function rowFields(container) {
  const raw = container.getAttribute ? container.getAttribute(ROW_FIELDS_ATTR) : null;
  if (!raw) return [];
  return raw.split(FIELD_SEP).map((f) => f.trim()).filter(Boolean);
}

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

export function bind(doc, data) {
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (value === null || value === undefined) continue;
    applyField(doc, key, value);
  }
}

export function postToHost(root, message) {
  const parent = root && root.parent;
  if (parent && typeof parent.postMessage === "function") parent.postMessage(message, "*");
}

export function reportSize(root) {
  const body = root && root.document && root.document.body;
  const height = body && body.scrollHeight ? body.scrollHeight : 0;
  const width = body && body.scrollWidth ? body.scrollWidth : 0;
  postToHost(root, { jsonrpc: "2.0", method: METHOD_SIZE_CHANGED, params: { width, height } });
}

export function signalUiReady(root) {
  if (!root || root[UI_READY_FLAG]) return;
  root[UI_READY_FLAG] = true;
  if (typeof root.CustomEvent !== "function" || typeof root.dispatchEvent !== "function") return;
  root.dispatchEvent(new root.CustomEvent(UI_READY_EVENT));
}

export function handleHostMessage(root, doc, message) {
  if (!isObject(message)) return false;
  if (message.id === INIT_ID && isObject(message.result)) {
    postToHost(root, { jsonrpc: "2.0", method: METHOD_INITIALIZED, params: {} });
    reportSize(root);
    signalUiReady(root);
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

export function run(root) {
  try {
    const doc = root && root.document;
    if (!doc) return;
    postToHost(root, {
      jsonrpc: "2.0",
      id: INIT_ID,
      method: METHOD_INITIALIZE,
      params: {
        appCapabilities: { availableDisplayModes: ["inline"] },
        appInfo: { name: "hermes-widget", version: "1.0.0" },
        protocolVersion: UI_PROTOCOL_VERSION,
      },
    });
    reportSize(root);
    if (typeof root.addEventListener === "function") {
      root.addEventListener("message", (event) => handleHostMessage(root, doc, event && event.data));
      root.addEventListener("load", () => reportSize(root));
    }
    if (typeof root.ResizeObserver === "function" && doc.body) {
      new root.ResizeObserver(() => reportSize(root)).observe(doc.body);
    }
  } catch (e) {
  }
}

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

export const BIND_SCRIPT = buildBindScript();
