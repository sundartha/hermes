import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall, makeConfigOverrides } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const REAL_UMLAUT = /[äöüÄÖÜ]/u;
const DE_HEADING = "WENN DU WARTEN LÄSST";
const EN_HEADING = "WHEN YOU MAKE SOMEONE WAIT";
const FR_HEADING = "QUAND TU FAIS PATIENTER";

let systemPrompt, config, withConfigOverrides;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls: [],
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
    }),
  );
  ({ config } = await import("../src/config.js"));
  ({ systemPrompt } = await import("../src/claude.js"));
  ({ withConfigOverrides } = makeConfigOverrides(config));
});

const callFor = (language) =>
  seedCall({ tenantId: BOOTSTRAP_TENANT_ID, language, direction: "outbound" });

test("AL-P7b-6: Flag aus -> Prompt byte-identisch zu einem Lauf ohne Block, kein thinkingSignal-Text drin", () => {
  const call = callFor("de");
  const withoutFlag = withConfigOverrides({ thinkingSignalEnabled: false }, () => systemPrompt(call));
  const withFlag = withConfigOverrides({ thinkingSignalEnabled: true }, () => systemPrompt(call));

  assert.ok(!withoutFlag.includes(DE_HEADING), "Block fehlt komplett bei ausgeschaltetem Flag");
  assert.ok(withFlag.includes(DE_HEADING), "Gegenprobe: der Block existiert ueberhaupt, wenn an");

  const blockStart = withFlag.indexOf(DE_HEADING);
  const beforeBlock = withFlag.slice(0, blockStart).replace(/\n\n$/, "");
  const afterBlockStart = withFlag.indexOf("\n\n", blockStart) + 2;
  const afterBlock = withFlag.slice(afterBlockStart);
  assert.equal(beforeBlock + "\n\n" + afterBlock, withoutFlag);
});

test("AL-P7b-7: Flag an, DE/EN/FR - Block genau einmal, Verbot drin, DE mit echten Umlauten, Sprachen getrennt", () => {
  const languages = { de: DE_HEADING, en: EN_HEADING, fr: FR_HEADING };
  const prompts = {};
  for (const lang of Object.keys(languages)) {
    prompts[lang] = withConfigOverrides({ thinkingSignalEnabled: true }, () => systemPrompt(callFor(lang)));
  }

  for (const [lang, heading] of Object.entries(languages)) {
    const occurrences = prompts[lang].split(heading).length - 1;
    assert.equal(occurrences, 1, `${lang}: Block muss genau einmal stehen`);
  }

  assert.ok(/NIE.*(nachschaust|suchst|nachschlägst|recherchierst)/.test(prompts.de));
  assert.ok(/NEVER.*(looking something up|searching|checking)/.test(prompts.en));
  assert.ok(/JAMAIS.*(vérifies|cherches|consultes)/.test(prompts.fr));

  assert.match(prompts.de, REAL_UMLAUT, "DE-Block muss echte Umlaute tragen");

  assert.ok(!prompts.de.includes(FR_HEADING));
  assert.ok(!prompts.fr.includes(DE_HEADING));
  assert.ok(!prompts.de.includes(EN_HEADING));
});
