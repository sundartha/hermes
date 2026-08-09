// B3b: die ANFRAGESEITE der LLM-Werkzeug-Schleife ist jetzt neutral - kein Fachcode
// (claude.js, precall-briefing.js) kennt noch Anthropic-Vokabular (input_schema,
// cache_control, max_tokens, tool_choice). Die Uebersetzung sitzt ausschliesslich im
// Anthropic-Adapter (src/llm/adapters/anthropic.js). Reine node:test-Units gegen
// injizierte messagesCreate (DIP) bzw. gegen den Quelltext selbst (Struktur-Riegel);
// kein Netz, kein Store fuer die meisten Faelle (P12 F.I.R.S.T.).
//
// Testnamen tragen bewusst KEINE Katalog-ID am Namensanfang (package.json
// config.i18nCatalogPattern) - Praefix ist "B3B-<n>:".
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAnthropicProvider } from "../src/llm/adapters/anthropic.js";
import { LLM_TOOL_CHOICE, forcedTool } from "../src/llm/tool-choice.js";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const readSrc = (name) => fs.readFileSync(path.join(SRC_DIR, name), "utf8");
const countOf = (source, marker) => (source.match(new RegExp(marker, "g")) || []).length;

// Provider mit festem Antwort-Objekt; merkt sich, was messagesCreate bekommen hat.
function providerReturning(resp) {
  const seen = [];
  const provider = createAnthropicProvider({
    messagesCreate: (params) => {
      seen.push(params);
      return Promise.resolve(resp);
    },
  });
  return { provider, seen };
}

const MODEL = "claude-haiku-4-5";
const emptyResp = { content: [] };

// ---------- B3B-1: Struktur-Riegel mit Positiv-Kontrolle -----------------------------

test("B3B-1: kein Anthropic-Vokabular mehr im Fachcode - mit Positiv-Kontrolle im Adapter", () => {
  const claudeSrc = readSrc("claude.js");
  const briefingSrc = readSrc("precall-briefing.js");
  const bridgeSrc = readSrc("bridge.js");
  const adapterSrc = readSrc(path.join("llm", "adapters", "anthropic.js"));

  for (const marker of ["input_schema", "cache_control", "max_tokens", "tool_choice"]) {
    assert.equal(countOf(claudeSrc, marker), 0, `claude.js darf ${marker} nicht mehr enthalten`);
    assert.equal(
      countOf(briefingSrc, marker),
      0,
      `precall-briefing.js darf ${marker} nicht mehr enthalten`,
    );
  }
  // bridge.js: nur tool_choice bleibt - das ist OpenAI-Realtime-Vokabular auf einem
  // ANDEREN Draht (session.update direkt an OpenAI), nicht LlmRequest.toolChoice.
  for (const marker of ["input_schema", "cache_control", "max_tokens"])
    assert.equal(countOf(bridgeSrc, marker), 0, `bridge.js darf ${marker} nicht mehr enthalten`);
  assert.equal(
    countOf(bridgeSrc, "tool_choice"),
    1,
    "bridge.js behaelt genau EIN tool_choice - das OpenAI-Realtime-Feld",
  );

  // POSITIV-KONTROLLE (Lehre pruefkommando-ohne-positiv-kontrolle): 0 Treffer im
  // Fachcode ist nur ein Beleg, wenn dieselben Marker irgendwo tatsaechlich existieren.
  for (const marker of ["input_schema", "cache_control", "max_tokens", "tool_choice"])
    assert.ok(
      countOf(adapterSrc, marker) > 0,
      `${marker} muss im Adapter existieren - sonst sucht der Riegel nichts`,
    );
});

// ---------- B3B-2: Schluesselposition + keine neutralen Namen auf dem Draht ----------

test("B3B-2: maxTokens wird an DERSELBEN Position zu max_tokens; kein neutraler Schluessel entkommt", async () => {
  const { provider, seen } = providerReturning(emptyResp);
  await provider.complete({
    model: MODEL,
    maxTokens: 300,
    system: "s",
    tools: [],
    messages: [],
    toolChoice: LLM_TOOL_CHOICE.AUTO,
    cachePrefix: true,
  });
  const body = seen[0];
  assert.deepEqual(Object.keys(body), [
    "model",
    "max_tokens",
    "system",
    "tools",
    "messages",
    "tool_choice",
  ]);
  for (const neutralKey of ["maxTokens", "toolChoice", "cachePrefix", "parameters"])
    assert.ok(!(neutralKey in body), `${neutralKey} darf den Draht nicht erreichen`);
});

// ---------- B3B-3/B3B-4: Werkzeugwahl dreiwertig + fail-closed -----------------------

test("B3B-3: Werkzeugwahl dreiwertig - AUTO/REQUIRED/forcedTool in Anthropics Formen", async () => {
  const cases = [
    [LLM_TOOL_CHOICE.AUTO, { type: "auto" }],
    [LLM_TOOL_CHOICE.REQUIRED, { type: "any" }],
    [forcedTool("hintergrund"), { type: "tool", name: "hintergrund" }],
  ];
  for (const [toolChoice, expected] of cases) {
    const { provider, seen } = providerReturning(emptyResp);
    await provider.complete({ model: MODEL, messages: [], toolChoice });
    assert.deepEqual(seen[0].tool_choice, expected);
  }
});

test("B3B-4: eine unbekannte Werkzeugwahl wirft mit Kontext statt still name:undefined zu senden", async () => {
  const { provider } = providerReturning(emptyResp);
  for (const bad of [{}, "beliebig"])
    await assert.rejects(
      () => provider.complete({ model: MODEL, messages: [], toolChoice: bad }),
      /unbekannte Werkzeugwahl/,
    );
});

// ---------- B3B-5: Werkzeugform + Durchreich-Regel fuer Anbieter-eigene Werkzeuge ----

test("B3B-5: {name,description,parameters} -> {name,description,input_schema}; ohne parameters referenzgleich durch", async () => {
  const serverTool = { type: "web_search_20250305", name: "web_search", max_uses: 1 };
  const { provider, seen } = providerReturning(emptyResp);
  await provider.complete({
    model: MODEL,
    messages: [],
    tools: [
      { name: "hintergrund", description: "d", parameters: { type: "object" } },
      serverTool,
    ],
  });
  assert.deepEqual(seen[0].tools[0], {
    name: "hintergrund",
    description: "d",
    input_schema: { type: "object" },
  });
  assert.equal(seen[0].tools[1], serverTool, "ein Eintrag ohne parameters geht REFERENZGLEICH durch");
});

// ---------- B3B-6/B3B-7: cachePrefix - Hinweis, kein Anbieter-Feld -------------------

test("B3B-6: cachePrefix:true markiert System-Block + letztes Werkzeug, cachePrefix selbst fehlt im Body", async () => {
  const { provider, seen } = providerReturning(emptyResp);
  await provider.complete({
    model: MODEL,
    system: "Systemtext",
    tools: [
      { name: "a", description: "a", parameters: {} },
      { name: "b", description: "b", parameters: {} },
    ],
    messages: [],
    cachePrefix: true,
  });
  const body = seen[0];
  assert.deepEqual(body.system, [
    { type: "text", text: "Systemtext", cache_control: { type: "ephemeral" } },
  ]);
  assert.equal(body.tools[0].cache_control, undefined, "nur das LETZTE Werkzeug traegt die Marke");
  assert.deepEqual(body.tools[1].cache_control, { type: "ephemeral" });
  assert.ok(!("cachePrefix" in body), "cachePrefix ist ein Hinweis an den Adapter, kein Draht-Feld");
});

test("B3B-7: ohne cachePrefix bleibt system ein String und KEIN Werkzeug traegt eine Marke", async () => {
  const { provider, seen } = providerReturning(emptyResp);
  await provider.complete({
    model: MODEL,
    system: "Systemtext",
    tools: [{ name: "a", description: "a", parameters: {} }],
    messages: [],
  });
  const body = seen[0];
  assert.equal(body.system, "Systemtext");
  assert.equal(body.tools[0].cache_control, undefined);
});

// ---------- B3B-8: Grenzfall leere Werkzeugliste (T5) --------------------------------

test("B3B-8: leere Werkzeugliste mit cachePrefix:true bleibt leer, kein Absturz, keine Marke", async () => {
  const { provider, seen } = providerReturning(emptyResp);
  await provider.complete({ model: MODEL, tools: [], messages: [], cachePrefix: true });
  assert.deepEqual(seen[0].tools, []);
});

// ---------- B3B-9: Abnahme 5 - Realtime-Pfad und Budget-Pfad, dieselbe Werkzeugform --

let claude, bridge;

before(async () => {
  process.env.ANTHROPIC_API_KEY = "test-b3b-key";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }],
      calls: [seedCall({ id: "call_b3b" })],
    }),
  );
  await import("../src/config.js");
  claude = await import("../src/claude.js");
  bridge = await import("../src/bridge.js");
});

test("B3B-9: realtimeTools liefert dieselbe parameters-Form wie toolDefs - kein input_schema mehr", () => {
  for (const lang of ["de", "en", "fr"]) {
    const defs = claude.toolDefs(lang);
    const realtime = bridge.realtimeTools(lang);
    assert.equal(realtime.length, defs.length);
    for (let i = 0; i < defs.length; i++) {
      assert.deepEqual(realtime[i].parameters, defs[i].parameters, `Werkzeug ${i} (${lang})`);
      assert.ok(!("input_schema" in realtime[i]), `Werkzeug ${i} (${lang}) darf kein input_schema tragen`);
    }
  }
});
