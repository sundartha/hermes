import { test } from "node:test";
import assert from "node:assert/strict";
import { registerTools } from "../src/mcp-tools.js";
import { SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";

const REFERENCE_LANGUAGE = "en";

function subfieldsOf(node) {
  const inner = typeof node?.unwrap === "function" ? node.unwrap() : null;
  return Object.entries(inner?.shape ?? {});
}

function collectInto(descriptions, { name, description, schema }) {
  descriptions.set(name, description || "");
  for (const [field, node] of Object.entries(schema || {})) {
    descriptions.set(`${name}.${field}`, node?.description || "");
    for (const [sub, subNode] of subfieldsOf(node)) descriptions.set(`${name}.${field}.${sub}`, subNode?.description || "");
  }
}

function captureDescriptions(language) {
  const descriptions = new Map();
  const fakeServer = {
    tool: (name, description, schema) => collectInto(descriptions, { name, description, schema }),
    registerTool: (name, config) => collectInto(descriptions, { name, description: config.description, schema: config.inputSchema }),
    registerResource() {},
  };
  registerTools(fakeServer, { language, consultAllowed: true });
  return descriptions;
}

test("Werkzeugbeschreibungen sind fuer jede Sprache des Katalogs dieselben wie fuer Englisch", () => {
  const reference = captureDescriptions(REFERENCE_LANGUAGE);
  assert.ok(reference.size > 0, "die Referenz enthaelt Beschreibungen");
  assert.ok(SUPPORTED_LANGUAGES.includes(REFERENCE_LANGUAGE), "Englisch ist im Katalog");
  for (const language of SUPPORTED_LANGUAGES) {
    const captured = captureDescriptions(language);
    assert.deepEqual([...captured.keys()], [...reference.keys()], `${language}: dieselben Pfade wie Englisch`);
    for (const [path, text] of captured) {
      assert.ok(text.length > 0, `${language}: ${path} hat eine Beschreibung`);
      assert.equal(text, reference.get(path), `${language}: ${path} weicht von Englisch ab`);
    }
  }
});
