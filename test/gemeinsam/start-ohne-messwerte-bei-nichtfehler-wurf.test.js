import assert from "node:assert/strict";
import { test, mock } from "node:test";

import { starteTelemetrie, KEINE_TELEMETRIE } from "../../src/utils/telemetrie.js";
import { WEB_SITZUNGS_GEHEIMNIS } from "./erfundene-geheimnisse.js";

test("Wirft der Aufbau einen Wert ohne Namen, startet Hermes trotzdem ohne Messwerte", async (t) => {
  const warnung = mock.method(console, "warn", () => {});
  t.after(() => warnung.mock.restore());
  const einstellungen = {
    url: "http://127.0.0.1:1/otlp",
    benutzer: "123456",
    token: WEB_SITZUNGS_GEHEIMNIS,
    instanzKennung: "i",
    get intervallMs() {
      throw undefined;
    },
  };

  const telemetrie = await starteTelemetrie(einstellungen);

  assert.equal(telemetrie, KEINE_TELEMETRIE);
  assert.equal(warnung.mock.callCount(), 1);
  const aufruf = warnung.mock.calls[0];
  const zeile = aufruf.arguments.join(" ");
  assert.match(zeile, /Exporters fehlgeschlagen \(undefined\)/);
});
