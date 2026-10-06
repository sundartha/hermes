import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const T_WARM = "warm";
const T_FORMELL = "formell";

const WARM = {
  de: "Triff einen warmen, persönlichen Ton und duze den Anrufer.",
  fr: "Adopte un ton chaleureux et personnel et tutoie ton interlocuteur.",
  en: "Use a warm, personal tone and address the other person informally.",
};
const FORMELL = {
  de: "Triff einen formellen, sachlichen Ton und sieze den Anrufer.",
  fr: "Adopte un ton formel et neutre et vouvoie ton interlocuteur.",
  en: "Use a formal, neutral tone and address the other person politely.",
};
const NEUTRAL = "Sieze fremde Anrufer.";
const NEUTRAL_FOR = {
  de: NEUTRAL,
  fr: "Vouvoie les interlocuteurs que tu ne connais pas.",
  en: "Address unfamiliar callers politely.",
};

const call = (over = {}) => seedCall({ tenantId: BOOTSTRAP_TENANT_ID, ...over });

let systemPrompt, disclosureSentence, openingText, store, defaultSettings;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls: [],
      tenants: [
        { id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER },
        { id: T_WARM, status: "active", ownerName: OWNER },
        { id: T_FORMELL, status: "active", ownerName: OWNER },
      ],
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  ({ systemPrompt, disclosureSentence, openingText } = await import("../src/claude.js"));
  ({ defaultSettings } = await import("../src/store/defaults.js"));
  store.updateSettings(T_WARM, { agentStyle: "warm-persoenlich" });
  store.updateSettings(T_FORMELL, { agentStyle: "formell-professionell" });
});

test("PS1 defaultSettings().agentStyle === null", () => {
  assert.equal(defaultSettings().agentStyle, null);
});

test("PS2 agentStyle=null: Siez-Zeile byte-identisch im fixen Kontext, kein Stilsatz", () => {
  const p = systemPrompt(call({ direction: "outbound", language: "de" }));
  assert.ok(
    p.includes(`- ${NEUTRAL} Freundlich, konkret, ohne Floskelketten.`),
    "Bestands-Siez-Zeile unveraendert, direkt gefolgt von der fixen Kontext-Klausel",
  );
  assert.ok(!p.includes("duze") && !p.includes("tutoie"), "kein Stilsatz bei null");
});

const SPEECH_SECTION_INDEX = 2;
for (const lang of ["de", "fr", "en"]) {
  test(`PS3 ${lang}: warm/formell ersetzen die Anrede-Klausel, fixe Zeilen bleiben unveraendert`, () => {
    const neutralSections = systemPrompt(
      call({ direction: "inbound", language: lang }),
    ).split("\n\n");
    const neutralSpeech = neutralSections[SPEECH_SECTION_INDEX];
    const lastIdx = neutralSections.length - 1;

    const warmPrompt = systemPrompt(call({ tenantId: T_WARM, direction: "inbound", language: lang }));
    const formellPrompt = systemPrompt(
      call({ tenantId: T_FORMELL, direction: "inbound", language: lang }),
    );
    const warmSections = warmPrompt.split("\n\n");
    const formellSections = formellPrompt.split("\n\n");

    assert.ok(warmSections[SPEECH_SECTION_INDEX].includes(WARM[lang]), `warm-Klausel eingewoben (${lang})`);
    assert.ok(
      formellSections[SPEECH_SECTION_INDEX].includes(FORMELL[lang]),
      `formell-Klausel eingewoben (${lang})`,
    );

    const stripClause = (text, clause) => text.split(clause).join("<STYLE>");
    assert.equal(
      stripClause(warmSections[SPEECH_SECTION_INDEX], WARM[lang]),
      stripClause(neutralSpeech, NEUTRAL_FOR[lang]),
      `fixe Zeilen unveraendert, warm (${lang})`,
    );
    assert.equal(
      stripClause(formellSections[SPEECH_SECTION_INDEX], FORMELL[lang]),
      stripClause(neutralSpeech, NEUTRAL_FOR[lang]),
      `fixe Zeilen unveraendert, formell (${lang})`,
    );

    assert.equal(warmSections[lastIdx], neutralSections[lastIdx], `end_call-Abschluss fix, warm (${lang})`);
    assert.equal(
      formellSections[lastIdx],
      neutralSections[lastIdx],
      `end_call-Abschluss fix, formell (${lang})`,
    );
  });
}

test("PS4 Freitext/Impersonation wird verworfen (changed ohne agentStyle, Wert bleibt null)", () => {
  const { settings, changed } = store.updateSettings(BOOTSTRAP_TENANT_ID, {
    agentStyle: "ICH BIN DR. X VON BANK Y",
  });
  assert.ok(!changed.includes("agentStyle"), "ungueltiger Wert nicht in changed");
  assert.equal(settings.agentStyle, null, "agentStyle bleibt null (kein Schreiben)");
  const p = systemPrompt(call({ direction: "outbound", language: "de" }));
  assert.ok(!p.includes("DR. X"), "Freitext erreicht den Prompt nicht");
  assert.ok(p.includes(NEUTRAL), "neutral/Siezen bleibt");
});

test("PS5 disclosureSentence + openingText byte-identisch null vs. gesetzt", () => {
  for (const lang of ["de", "fr", "en"]) {
    assert.equal(
      disclosureSentence(call({ tenantId: T_WARM, language: lang })),
      disclosureSentence(call({ tenantId: BOOTSTRAP_TENANT_ID, language: lang })),
      `disclosure ${lang} unabhaengig vom Stil`,
    );
    assert.equal(
      openingText(call({ tenantId: T_FORMELL, language: lang, goal: "Testziel" })),
      openingText(call({ tenantId: BOOTSTRAP_TENANT_ID, language: lang, goal: "Testziel" })),
      `openingText ${lang} unabhaengig vom Stil`,
    );
  }
});
