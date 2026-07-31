// AL-P7b (Prompt): der Denk-Signal-Block im Systemprompt. Zwei Zusagen:
//   (6) Flag aus -> Prompt byte-identisch zum Bestand (kein Block, kein Locale-Text drin).
//   (7) Flag an -> der Block steht GENAU EINMAL, traegt das Ankuendigungs-Verbot, der
//       DE-Block traegt echte Umlaute (CQ-P5-Regel), FR/DE-Bloecke sind nicht ineinander.
// Rein in-process (kein Server-Spawn, kein pglite), Flag ueber withConfigOverrides
// live geschaltet (Muster config-namespaces.test.js "Setter-Durchschlag") statt eines
// zweiten Prozesses - EIN Import genuegt.
// Testnamen tragen bewusst KEINE Katalog-ID am Namensanfang - Praefix ist "AL-P7b-<n>:".
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

  // Byte-Identitaet zum Bestand: der eingefuegte Block samt seines fuehrenden Absatz-
  // Trenners ist GENAU die Differenz - entfernt man ihn aus withFlag, bleibt exakt
  // withoutFlag stehen (Muster mandateSection/D8: "" -> filter(Boolean) -> kein Rest-Byte).
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

  // Ankuendigungs-Verbot (der Owner-Defekt) in jeder Sprache.
  assert.ok(/NIE.*(nachschaust|suchst|nachschlägst|recherchierst)/.test(prompts.de));
  assert.ok(/NEVER.*(looking something up|searching|checking)/.test(prompts.en));
  assert.ok(/JAMAIS.*(vérifies|cherches|consultes)/.test(prompts.fr));

  // CQ-P5-Regel: der DE-Prompt-Rumpf traegt korrekte Umlaute, keine Transliteration.
  assert.match(prompts.de, REAL_UMLAUT, "DE-Block muss echte Umlaute tragen");

  // Sprachen sind nicht ineinander vermischt.
  assert.ok(!prompts.de.includes(FR_HEADING));
  assert.ok(!prompts.fr.includes(DE_HEADING));
  assert.ok(!prompts.de.includes(EN_HEADING));
});
