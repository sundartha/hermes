// P7/G5: Drift-Test zwischen scripts/telnyx-assistant-provision.mjs (SHIM_ROUTE) und der
// echten Route-Registrierung in src/app.js (Server-Slim P15: der Shim-Mount wohnt seit der
// Kompositionswurzel-Aufteilung in registerPublicRoutes, nicht mehr in src/server.js). Ohne
// diesen Test wuerde eine spaetere Aenderung der Route in app.js NICHT npm test rot machen,
// sondern erst beim naechsten manuellen Owner-Provisioning-Lauf gegen die echte Telnyx-API
// auffallen (404 gegen den Shim). Rein textuelle Pruefung (kein Parser, kein Import von
// app.js) - haelt den P7-Scope bei scripts/+test/, ohne src/ anzufassen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SHIM_ROUTE } from "../scripts/telnyx-assistant-provision.mjs";

const APP_JS_PATH = fileURLToPath(new URL("../src/app.js", import.meta.url));
const SHIM_HANDLER_NAME = "makeTelnyxLlmShim";

test("SHIM_ROUTE (Provisioning-Skript) == registrierte Route in src/app.js", () => {
  const appSource = readFileSync(APP_JS_PATH, "utf8");
  const registrationLine = appSource
    .split("\n")
    .find((line) => line.includes("app.post") && line.includes(SHIM_HANDLER_NAME));
  assert.ok(
    registrationLine,
    `Route-Registrierung fuer ${SHIM_HANDLER_NAME} nicht in src/app.js gefunden`,
  );

  const match = registrationLine.match(/app\.post\(\s*"([^"]+)"/);
  assert.ok(
    match,
    `Route-String nicht aus der Registrierungszeile extrahierbar: ${registrationLine}`,
  );

  assert.equal(match[1], SHIM_ROUTE);
});
