import assert from "node:assert/strict";
import { test } from "node:test";

import { mcpPost, readToolResult, startServer } from "../helpers.js";

const CALL_WIDGET_URI = /^ui:\/\/hermes\/call\//;

const BESTAETIGUNGS_SPUREN = [
  /data-confirm/,
  /Confirm call/,
  /Anruf bestätigen/,
  /confirmation_code/,
  /hermes\/confirmation/,
  /hermes\/call_data_notice/,
  /awaiting_confirmation/,
  /confirmation_used/,
  /prepare_call/,
];

const LAUFENDER_ANRUF_SPUREN = [
  /data-cancel/,
  /data-status-pill/,
  /get_call_status/,
  /get_call_result/,
  /cancel_call/,
  /ui\/notifications\/tool-result/,
];

function gefundeneSpuren(html, muster) {
  return muster.filter((m) => m.test(html)).map(String);
}

async function callWidgetHtml() {
  const srv = await startServer({ env: { MCP_UI_ENABLED: "true" } });
  try {
    const url = `${srv.localUrl}/mcp`;
    const liste = await readToolResult(
      await mcpPost(url, null, { jsonrpc: "2.0", id: 1, method: "resources/list" }),
    );
    const uri = liste.resources.map((r) => r.uri).find((u) => CALL_WIDGET_URI.test(u));
    assert.ok(uri, "Vorbedingung: resources/list nennt das Call-Widget");
    const gelesen = await readToolResult(
      await mcpPost(url, null, { jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri } }),
    );
    return gelesen.contents[0].text;
  } finally {
    await srv.stop();
  }
}

test("W1 resources/read des Call-Widgets enthaelt keinen Bestaetigungsknopf und keinen Bestaetigungspfad", async () => {
  const html = await callWidgetHtml();
  assert.ok(html.length > 0, "Vorbedingung: die Resource liefert Inhalt");
  assert.deepEqual(gefundeneSpuren(html, BESTAETIGUNGS_SPUREN), []);
});

test("W2 die Anzeige eines laufenden Anrufs bleibt erhalten", async () => {
  const html = await callWidgetHtml();
  assert.deepEqual(
    LAUFENDER_ANRUF_SPUREN.filter((m) => !m.test(html)).map(String),
    [],
  );
});

test("W3 Positiv-Kontrolle: der Pruefer erkennt das alte Bestaetigungs-Markup", () => {
  const altesMarkup =
    '<div class="confirm rows" data-confirm><button data-confirm-button>Confirm call</button></div>' +
    'meta["hermes/confirmation_code"] — ask for a new prepare_call.';
  assert.ok(gefundeneSpuren(altesMarkup, BESTAETIGUNGS_SPUREN).length >= 4);
});

test("X-6 (Draht): resources/read des Call-Widgets enthaelt keine privilegierten APIs (kein fetch/XHR/WebSocket/eval)", async () => {
  const html = await callWidgetHtml();
  assert.ok(html.length > 0, "Vorbedingung: die Resource liefert Inhalt");
  assert.doesNotMatch(html, /\bfetch\s*\(/, "kein fetch()");
  assert.doesNotMatch(html, /\bXMLHttpRequest\b/, "kein XMLHttpRequest");
  assert.doesNotMatch(html, /\bnew\s+WebSocket\s*\(/, "kein WebSocket");
  assert.doesNotMatch(html, /\beval\s*\(/, "kein eval()");
  assert.match(html, /parent\.postMessage/, "der einzige Sendeweg bleibt parent.postMessage");

  const poisoned = html + "\n<script>fetch('https://example.invalid');</script>";
  assert.doesNotMatch(html, /example\.invalid/, "Sanity: der echte Text enthaelt den Marker nicht");
  assert.match(poisoned, /\bfetch\s*\(/, "Sanity: die Pruefung selbst faengt eine eingebaute Verletzung");
});
