import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  ELEVENLABS_CONSULT_PATH,
  ELEVENLABS_LOOKUP_PATH,
} from "../../src/routes/webhooks-elevenlabs.js";

const VORLAGE = JSON.parse(
  readFileSync(
    new URL("../../elevenlabs/agent_configs/outbound-agent.template.json", import.meta.url),
    "utf8",
  ),
);
const HOST_VARIABLE = "{{system__env_hermes_host}}";
const UMGEBUNGEN = Object.freeze({
  production: "app.sundartha.com",
  staging: "hermes-staging.example",
});
const BEDIENTE_PFADE = Object.freeze({
  get_consult: ELEVENLABS_CONSULT_PATH,
  look_up: ELEVENLABS_LOOKUP_PATH,
});
const TOKEN_HEADER = "x-hermes-tool-token";

function apiSchemas() {
  return Object.entries(VORLAGE.tools)
    .filter(([name, werkzeug]) => !name.startsWith("_") && werkzeug.tool_config?.type === "webhook")
    .map(([name, werkzeug]) => [name, werkzeug.tool_config.api_schema]);
}

test("EL-WERKZEUG-ADRESSEN a: jede Werkzeug-Adresse zeigt je Umgebung auf deren Host und den bedienten Pfad", () => {
  const schemas = apiSchemas();
  assert.deepEqual(schemas.map(([name]) => name).sort(), Object.keys(BEDIENTE_PFADE).sort());

  for (const [umgebung, host] of Object.entries(UMGEBUNGEN)) {
    for (const [name, schema] of schemas) {
      const adresse = new URL(schema.url.replace(HOST_VARIABLE, host));
      assert.equal(adresse.protocol, "https:", `${umgebung}/${name}`);
      assert.equal(adresse.host, host, `${umgebung}/${name}: ${schema.url}`);
      assert.equal(adresse.pathname, BEDIENTE_PFADE[name], `${umgebung}/${name}`);
    }
  }
});

test("EL-WERKZEUG-ADRESSEN b: der Token-Header jedes Werkzeugs kommt aus der Umgebungsvariablen hermes_tool_token", () => {
  const schemas = apiSchemas();
  assert.ok(schemas.length > 0, "keine Webhook-Werkzeuge in der Vorlage");

  for (const [name, schema] of schemas) {
    assert.deepEqual(
      schema.request_headers[TOKEN_HEADER],
      { env_var_label: "hermes_tool_token" },
      name,
    );
  }
});
