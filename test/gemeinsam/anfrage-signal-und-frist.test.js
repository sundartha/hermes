import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../../src/config.js";
import { createLlmProvider } from "../../src/llm/registry.js";
import { inCallSearchProvider } from "../../src/research/registry.js";
import { LLM_PROVIDER } from "../../src/llm/provider.js";
import { makeConfigOverrides, withFetch } from "../helpers.js";
import { mitKurzerFrist } from "./kurze-antwortfrist.mjs";

const { withConfigOverrides } = makeConfigOverrides(config);
const DEEPSEEK = { llmProvider: LLM_PROVIDER.DEEPSEEK, deepseekApiKey: "sk-test" };
const EXA = { lookupEnabled: true, exaApiKey: "exa-test" };
const ANFRAGE = { model: "deepseek-v4-pro", system: "S", messages: [] };
const EXA_FRIST_MS = 20;

function wartetBisAbbruch(_url, init) {
  return new Promise((_resolve, reject) => {
    if (init.signal.aborted) reject(init.signal.reason);
    init.signal.addEventListener("abort", () => reject(init.signal.reason));
  });
}

async function fehlerVon(versuch) {
  try {
    await versuch();
  } catch (fehler) {
    return fehler;
  }
  return null;
}

test("DeepSeek: bricht der Aufrufer die Anfrage ab, kommt sein Abbruchgrund an und nicht die Frist", async () => {
  const aufrufer = new AbortController();
  aufrufer.abort();
  let fehler = null;
  await withConfigOverrides(DEEPSEEK, () =>
    mitKurzerFrist(async () => {
      const provider = createLlmProvider();
      fehler = await withFetch(wartetBisAbbruch, () =>
        fehlerVon(() => provider.completeStream({ ...ANFRAGE, signal: aufrufer.signal }, {})),
      );
    }),
  );
  assert.equal(fehler?.name, "AbortError");
});

test("DeepSeek: ohne Antwort bricht die Anfrage an der Frist ab und die Frist erreicht fetch nicht als Option", async () => {
  const gesehen = [];
  let fehler = null;
  const fristen = await withConfigOverrides(DEEPSEEK, () =>
    mitKurzerFrist(async () => {
      const provider = createLlmProvider();
      fehler = await withFetch(
        (url, init) => {
          gesehen.push(init);
          return wartetBisAbbruch(url, init);
        },
        () => fehlerVon(() => provider.completeStream(ANFRAGE, {})),
      );
    }),
  );
  assert.equal(fehler?.name, "TimeoutError");
  assert.equal(fristen.length, 1);
  assert.equal("fristMs" in gesehen[0], false);
});

test("Exa-Suche: bleibt die Antwort aus, meldet sie timeout", async () => {
  const ergebnis = await withConfigOverrides(EXA, () =>
    withFetch(wartetBisAbbruch, () =>
      inCallSearchProvider({ tenantAllows: true }).searchFacts({ query: "x", timeoutMs: EXA_FRIST_MS }),
    ),
  );
  assert.deepEqual(ergebnis, { ok: false, reason: "timeout" });
});
