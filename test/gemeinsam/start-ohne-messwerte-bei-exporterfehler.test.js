import { test, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { starteTelemetrie, KEINE_TELEMETRIE } from "../../src/utils/telemetrie.js";

const TOKEN = "geheimes-token-".repeat(2);
const BENUTZER = "123456";
const UNGUELTIGES_INTERVALL_MS = 0;

function startEmpfaenger() {
  const empfangen = [];
  const empfaenger = http.createServer((req, res) => {
    empfangen.push(req.url);
    res.writeHead(200).end("{}");
  });
  return new Promise((resolve) => {
    empfaenger.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${empfaenger.address().port}/otlp`;
      resolve({ url, empfangen, stop: () => new Promise((fertig) => empfaenger.close(fertig)) });
    });
  });
}

test("Ein Exporter, der sich nicht aufbauen lässt, liefert keine Messwerte statt eines Startfehlers", async (t) => {
  const empfaenger = await startEmpfaenger();
  t.after(() => empfaenger.stop());
  const warnung = mock.method(console, "warn", () => {});
  t.after(() => warnung.mock.restore());

  const telemetrie = await starteTelemetrie({
    url: empfaenger.url,
    benutzer: BENUTZER,
    token: TOKEN,
    instanzKennung: "i",
    intervallMs: UNGUELTIGES_INTERVALL_MS,
  });

  assert.equal(telemetrie, KEINE_TELEMETRIE);
  assert.equal(telemetrie.aktiv, false);
  assert.equal(empfaenger.empfangen.length, 0);
  assert.equal(warnung.mock.callCount(), 1);
  const aufruf = warnung.mock.calls[0];
  const zeile = aufruf.arguments.join(" ");
  assert.match(zeile, /Messwerte/);
  assert.equal(zeile.includes(TOKEN), false);
  assert.equal(zeile.includes(empfaenger.url), false);
  const port = String(new URL(empfaenger.url).port);
  assert.equal(zeile.includes(port), false);
});

test("Ohne Adresse oder Token bleibt es still bei KEINE_TELEMETRIE", async (t) => {
  const warnung = mock.method(console, "warn", () => {});
  t.after(() => warnung.mock.restore());
  assert.equal(await starteTelemetrie({ url: "", token: TOKEN }), KEINE_TELEMETRIE);
  assert.equal(
    await starteTelemetrie({ url: "http://127.0.0.1:1/x", token: "" }),
    KEINE_TELEMETRIE,
  );
  assert.equal(
    await starteTelemetrie({ url: "http://fremd.example/x", token: TOKEN }),
    KEINE_TELEMETRIE,
  );
  assert.equal(warnung.mock.callCount(), 0);
});
