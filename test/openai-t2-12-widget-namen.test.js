import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { startServer, seedState, mcpPost, readToolResult } from "./helpers.js";
import { BIND_SCRIPT, signalUiReady } from "../src/ui/widget-bind.js";

const UI_ENV = { MCP_UI_ENABLED: "true" };
const OLD_CALL_RESULT_NAME = "get_transcript";
const CALL_ID = "call_t12d";

async function httpToolsList(baseUrl) {
  const res = await mcpPost(baseUrl, null, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  return (await readToolResult(res)).tools;
}

async function httpResourceRead(baseUrl, uri) {
  const res = await mcpPost(baseUrl, null, {
    jsonrpc: "2.0",
    id: 2,
    method: "resources/read",
    params: { uri },
  });
  return await readToolResult(res);
}

async function fetchToolsAndCallWidget(baseUrl) {
  const tools = await httpToolsList(baseUrl);
  const placeCall = tools.find((tool) => tool.name === "place_call");
  assert.ok(placeCall?._meta?.ui?.resourceUri, "place_call traegt die Call-Widget-resourceUri");
  const read = await httpResourceRead(baseUrl, placeCall._meta.ui.resourceUri);
  const html = read.contents.map((content) => content.text || "").join("\n");
  return { tools, html };
}

function makeAutoElement() {
  const listeners = {};
  return {
    _text: "",
    className: "",
    children: [],
    style: {},
    disabled: false,
    attrs: {},
    get textContent() {
      return this._text;
    },
    set textContent(text) {
      this._text = text;
      this.children = [];
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((other) => other !== child);
      return child;
    },
    addEventListener(type, handler) {
      (listeners[type] = listeners[type] || []).push(handler);
    },
    click() {
      for (const handler of listeners.click || []) handler();
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
      if (name === "class") this.className = value;
    },
    getAttribute(name) {
      return name in this.attrs ? this.attrs[name] : null;
    },
  };
}

function makeAutoDocument() {
  const bySelector = new Map();
  function get(sel) {
    if (!bySelector.has(sel)) bySelector.set(sel, makeAutoElement());
    return bySelector.get(sel);
  }
  get("[data-wing] img").src = "data:image/png;base64,FAKE";
  return {
    querySelector: get,
    querySelectorAll: () => [],
    createElement: () => makeAutoElement(),
    slot: (name) => get(`[data-mcp="${name}"]`),
  };
}

function ownScriptFromWire(html) {
  const withoutBind = html.replace(BIND_SCRIPT, "");
  const matches = [...withoutBind.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(matches.length >= 1, "eigenes Inline-Skript im Draht-HTML gefunden");
  return matches[matches.length - 1][1];
}

function driveToCompletion(scriptSource) {
  const doc = makeAutoDocument();
  const sandbox = { document: doc };
  sandbox.window = sandbox;
  sandbox._posted = [];
  sandbox.parent = { postMessage: (msg) => sandbox._posted.push(msg) };
  const listeners = {};
  sandbox.addEventListener = (type, handler) => {
    (listeners[type] = listeners[type] || []).push(handler);
  };
  sandbox.CustomEvent = function CustomEvent(type) {
    this.type = type;
  };
  sandbox.dispatchEvent = (event) => {
    for (const handler of listeners[event.type] || []) handler(event);
  };
  const intervalFns = new Map();
  let intervalSeq = 0;
  sandbox.setInterval = (fn) => {
    intervalSeq += 1;
    intervalFns.set(intervalSeq, fn);
    return intervalSeq;
  };
  sandbox.clearInterval = (id) => intervalFns.delete(id);
  const timeoutFns = new Map();
  let timeoutSeq = 0;
  sandbox.setTimeout = (fn) => {
    timeoutSeq += 1;
    timeoutFns.set(timeoutSeq, fn);
    return timeoutSeq;
  };
  sandbox.clearTimeout = (id) => timeoutFns.delete(id);

  vm.createContext(sandbox);
  vm.runInContext(scriptSource, sandbox);

  signalUiReady(sandbox);
  doc.slot("call_id").textContent = CALL_ID;
  for (const fn of intervalFns.values()) fn();

  const emit = (data) => {
    for (const handler of listeners.message || []) handler({ data });
  };
  emit({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: {
      structuredContent: {
        call_id: CALL_ID,
        status: "in_progress",
        duration_s: 5,
        last_transcript_lines: [],
        failure_reason: null,
      },
    },
  });
  emit({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: {
      structuredContent: {
        call_id: CALL_ID,
        status: "completed",
        duration_s: 12,
        last_transcript_lines: [],
        failure_reason: null,
      },
    },
  });

  return sandbox._posted;
}

function sentToolNames(posted) {
  return posted.filter((msg) => msg.params && msg.params.name).map((msg) => msg.params.name);
}

function assertSendsExpectedCalls(sentNames) {
  assert.ok(sentNames.length > 0, "Positiv-Kontrolle: mindestens ein tools/call gesendet");
  assert.ok(sentNames.includes("get_call_status"), "Positiv-Kontrolle: get_call_status gesendet");
  assert.equal(
    sentNames.filter((name) => name === "get_call_result").length,
    1,
    "Positiv-Kontrolle: get_call_result genau einmal gesendet",
  );
}

function assertSentNamesInToolsList(sentNames, toolNames) {
  for (const name of sentNames) {
    assert.ok(toolNames.has(name), notInToolsListMessage(name));
  }
}

function notInToolsListMessage(name) {
  return `gesendeter Name "${name}" steht nicht in tools/list desselben Servers`;
}

test("T12-d: Call-Widget vom Draht - jeder gesendete tools/call-Name steht in tools/list desselben Servers", async () => {
  const srv = await startServer({ seed: seedState({}), env: UI_ENV });
  try {
    const { tools, html } = await fetchToolsAndCallWidget(srv.localUrl + "/mcp");
    const toolNames = new Set(tools.map((tool) => tool.name));
    const posted = driveToCompletion(ownScriptFromWire(html));
    const sentNames = sentToolNames(posted);
    assertSendsExpectedCalls(sentNames);
    assertSentNamesInToolsList(sentNames, toolNames);
  } finally {
    await srv.stop();
  }
});

test("T12-d Gegenprobe: wird der alte Name wieder eingesetzt, wird die Pruefung von oben tatsaechlich rot", async () => {
  const srv = await startServer({ seed: seedState({}), env: UI_ENV });
  try {
    const { tools, html } = await fetchToolsAndCallWidget(srv.localUrl + "/mcp");
    const toolNames = new Set(tools.map((tool) => tool.name));
    const original = ownScriptFromWire(html);
    const mutated = original.replace(/"get_call_result"/g, `"${OLD_CALL_RESULT_NAME}"`);
    assert.notEqual(mutated, original, "Mutation griff tatsaechlich - sonst waere die Gegenprobe wirkungslos");

    const sentNames = sentToolNames(driveToCompletion(mutated));
    assert.ok(sentNames.includes(OLD_CALL_RESULT_NAME), "Positiv-Kontrolle: das mutierte Skript sendet den alten Namen");

    assert.throws(() => assertSentNamesInToolsList(sentNames, toolNames), {
      name: "AssertionError",
      message: notInToolsListMessage(OLD_CALL_RESULT_NAME),
    });
  } finally {
    await srv.stop();
  }
});
