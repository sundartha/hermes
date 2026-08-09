// B5 (tasks/b5-spec.md, Abschnitt 3 "K21 Registry"): die Anbieter-WAHL. Zwei Haelften,
// beide noetig:
//   - Units gegen den config-Singleton (welcher Adapter kommt heraus, mit welchem
//     Schluessel, was passiert bei Muell),
//   - Spawn-Tests gegen den echten Boot (Boot-Refusal bei unbekanntem Wert, Gegenprobe
//     mit gueltigem Wert, und der Beweis der Phase: Anbieterwechsel = reine Env-Operation).
//
// Testnamen tragen bewusst KEINE Katalog-ID am Namensanfang (package.json
// config.i18nCatalogPattern) - Praefix ist "B5-R<n>:"/"B5-P<n>:".
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { activeLlmErrors, createLlmProvider } from "../src/llm/registry.js";
import { anthropicErrors } from "../src/llm/adapters/anthropic.js";
import { deepseekErrors } from "../src/llm/adapters/deepseek.js";
import { LLM_PROVIDER } from "../src/llm/provider.js";
import { MODEL_PRICE_RATE_FIELDS } from "../src/store/defaults.js";
import { makeConfigOverrides, startServer, startServerExpectExit } from "./helpers.js";

const { withConfig, withConfigOverrides } = makeConfigOverrides(config);

const DEEPSEEK_MODEL = "deepseek-v4-pro";
const TEST_DEEPSEEK_KEY = "sk-b5-registry-dummy";
// Unterscheidbarer Gegenwert: nur so ist "der falsche Schluessel ging raus" ueberhaupt
// beobachtbar (ein leerer Anthropic-Schluessel steckt als Teilstring in jedem Header).
const ANTHROPIC_SENTINEL_KEY = "sk-ant-b5-darf-nicht-rausgehen";

test("B5-R1: Default -> der Anthropic-Adapter (seine Fehler-Klassifikation, ohne Client-Bau)", () => {
  assert.equal(config.llm.llmProvider, LLM_PROVIDER.ANTHROPIC);
  assert.equal(activeLlmErrors(), anthropicErrors);
  assert.equal(createLlmProvider().errors, anthropicErrors);
});

test("B5-R2: llmProvider=deepseek -> der DeepSeek-Adapter, und er traegt den DEEPSEEK-Schluessel auf den Draht", async () => {
  await withConfigOverrides(
    {
      llmProvider: LLM_PROVIDER.DEEPSEEK,
      deepseekApiKey: TEST_DEEPSEEK_KEY,
      anthropicApiKey: ANTHROPIC_SENTINEL_KEY,
    },
    async () => {
      assert.equal(activeLlmErrors(), deepseekErrors);
      const seen = [];
      const provider = createLlmProvider({
        // Der Test-Seam des DeepSeek-Adapters. Die Registry reicht Optionen unveraendert
        // durch; messagesCreate/messagesStream (Anthropic-Seams) ignoriert er.
        chatCompletionsFetch: (url, init) => {
          seen.push({ url, init });
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
            text: async () => "",
          });
        },
      });
      assert.equal(provider.errors, deepseekErrors);
      const turn = await provider.complete({ model: DEEPSEEK_MODEL, system: "S", messages: [] });
      assert.equal(turn.text, "ok");
      assert.equal(seen.length, 1, "der injizierte Transport wurde tatsaechlich benutzt");
      assert.equal(seen[0].init.headers.authorization, `Bearer ${TEST_DEEPSEEK_KEY}`);
      assert.equal(
        seen[0].init.headers.authorization.includes(ANTHROPIC_SENTINEL_KEY),
        false,
        "der Anthropic-Schluessel darf nie an den Fremdanbieter gehen",
      );
    },
  );
});

test("B5-R3: unbekannter Wert wirft benannt und nennt die gueltige Menge - auch __proto__ (kein Prototyp-Treffer)", async () => {
  for (const bogus of ["deepsek", "", "__proto__", "constructor"]) {
    await withConfig("llmProvider", bogus, () => {
      assert.throws(
        () => createLlmProvider(),
        (err) => {
          assert.match(err.message, /nicht unterstuetzt/);
          assert.match(err.message, /anthropic\|deepseek/);
          return true;
        },
        `LLM_PROVIDER='${bogus}' darf keinen Adapter liefern`,
      );
      assert.throws(() => activeLlmErrors(), /nicht unterstuetzt/);
    });
  }
});

// ---- Preis: der Fremdanbieter darf die Fail-closed-Rate NICHT anheben (Regel 1) --------

// Die AUSGELIEFERTE, auf heute aufgeloeste Tabelle - genau die, aus der worstCasePrice
// (store/state-ops.js) die Fail-closed-Rate fuer unbekannte Modelle bildet. Bewusst ohne
// Zahlen-Literale: ein Preis-Update darf diesen Test nicht rot faerben (Muster B4A-TAB-1).
test("B5-P1: das punktweise Maximum ueber ALLE Staffeln ist je Rate identisch zum Maximum ueber die Anthropic-Staffeln allein", () => {
  const prices = config.llm.modelPricesUsd;
  const ids = Object.keys(prices);
  const deepseekIds = ids.filter((id) => id.startsWith("deepseek-"));
  assert.ok(deepseekIds.length > 0, "ohne Fremdanbieter-Staffel prueft dieser Test nichts");
  const pointwiseMax = (selected) =>
    MODEL_PRICE_RATE_FIELDS.map((field) =>
      selected.reduce((max, id) => (prices[id][field] > max ? prices[id][field] : max), 0),
    );
  assert.deepEqual(
    pointwiseMax(ids),
    pointwiseMax(ids.filter((id) => !id.startsWith("deepseek-"))),
    "waere eine DeepSeek-Rate die teuerste, buchte jedes unbekannte Modell ab sofort teurer (worstCasePrice)",
  );
});

// ---- Boot: die Env-Operation ----------------------------------------------------------

test("B5-R4: ein vertipptes LLM_PROVIDER verweigert den Boot mit genanntem Wert - kein stiller Fallback", async () => {
  const { code, output } = await startServerExpectExit({ env: { LLM_PROVIDER: "deepsek" } });
  assert.equal(code, 1);
  assert.match(output, /Boot wird verweigert/);
  assert.match(output, /LLM_PROVIDER="deepsek" ist unbekannt/);
  assert.equal(/Gateway laeuft/.test(output), false, "kein Start trotz Fatal-Befund");
});

test("B5-R5: Gegenprobe - mit gueltigem LLM_PROVIDER startet derselbe Dienst (sonst belegt R4 nur, dass nie etwas startet)", async () => {
  const srv = await startServer({ env: { LLM_PROVIDER: "anthropic" } });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
  } finally {
    await srv.stop();
  }
});

test("B5-R6: LLM_PROVIDER=deepseek ohne DEEPSEEK_API_KEY verweigert den Boot benannt", async () => {
  const { code, output } = await startServerExpectExit({
    env: { LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "" },
  });
  assert.equal(code, 1);
  assert.match(output, /DEEPSEEK_API_KEY \(weil LLM_PROVIDER=deepseek\)/);
});

test("B5-R7: der Beweis der Phase - Anbieterwechsel ist eine reine Env-Operation, der Dienst startet und hat Preise", async () => {
  const srv = await startServer({
    env: {
      LLM_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: TEST_DEEPSEEK_KEY,
      CLAUDE_MODEL: DEEPSEEK_MODEL,
      PRECALL_BRIEFING_MODEL: DEEPSEEK_MODEL,
    },
  });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.equal(
      /ohne Preis in modelPricesUsd/.test(srv.stdout),
      false,
      "ein DeepSeek-Modell ohne Preisstaffel braeche den Boot ab (assertPricedModels)",
    );
  } finally {
    await srv.stop();
  }
});
