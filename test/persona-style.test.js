// P2 (PLAN-PERSONAL-ASSISTANT.md) - stehender Tenant-Stil settings.agentStyle. Beweist:
// (1) Default null, (2) null = Bestand byte-identisch (inkl. Siezen, keine Blank-Line-Drift,
// Pre-Mortem 5), (3) gueltige ID -> lokalisierte Stil-Klausel ersetzt die Siez-Zeile
// (de Du/Sie, fr tu/vous, en informell/foermlich), (4) Freitext/unbekannt fail-closed
// verworfen (kein PII/Impersonation im Feld, Pre-Mortem 1/2), (5) Offenlegung/openingText
// byte-identisch null vs. gesetzt UND Laengen-/eine-Frage-/end_call-Regeln unveraendert.
// Rein in-process (kein Server-Spawn, kein pglite) - dieselbe Naht wie P0.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const T_WARM = "warm";
const T_FORMELL = "formell";

// Lokalisierte Stil-Klauseln als Golden-Master (byte-stabil; pinnt den P2-Wortlaut).
const WARM = {
  de: "Triff einen warmen, persoenlichen Ton und duze den Anrufer.",
  fr: "Adopte un ton chaleureux et personnel et tutoie ton interlocuteur.",
  en: "Use a warm, personal tone and address the other person informally.",
};
const FORMELL = {
  de: "Triff einen formellen, sachlichen Ton und sieze den Anrufer.",
  fr: "Adopte un ton formel et neutre et vouvoie ton interlocuteur.",
  en: "Use a formal, neutral tone and address the other person politely.",
};
const NEUTRAL = "Sieze fremde Anrufer.";
const FIXED_RULE_FRAGE = "- Stelle pro Antwort hoechstens eine Frage.";
const FIXED_RULE_ENDCALL =
  "- Wenn das Anliegen erledigt ist oder das Gespraech zu Ende geht, verabschiede dich und rufe danach das Tool end_call auf.";
const FIXED_RULE_KURZ = "- Antworte KURZ: 1-2 gesprochene Saetze pro Antwort.";

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
  // Stile ueber den ECHTEN Setter (Produktionspfad, keine Map-Umgehung).
  store.updateSettings(T_WARM, { agentStyle: "warm-persoenlich" });
  store.updateSettings(T_FORMELL, { agentStyle: "formell-professionell" });
});

// (1) Default null.
test("PS1 defaultSettings().agentStyle === null", () => {
  assert.equal(defaultSettings().agentStyle, null);
});

// (2) null = Bestand byte-identisch: die Siez-Zeile steht unveraendert in ihrem fixen
// Kontext (kein Stilsatz, keine Blank-Line). Der VOLLE Prompt-Byte-Pin liegt in
// personal-assistant-characterization (P0, laeuft ebenfalls bei null).
test("PS2 agentStyle=null: Siez-Zeile byte-identisch im fixen Kontext, kein Stilsatz", () => {
  const p = systemPrompt(call({ direction: "outbound", language: "de" }));
  assert.ok(
    p.includes(
      `- Sei freundlich, professionell und effizient. ${NEUTRAL}\n${FIXED_RULE_FRAGE}`,
    ),
    "Bestands-Siez-Zeile unveraendert, direkt gefolgt von der fixen Frage-Regel",
  );
  assert.ok(!p.includes("duze") && !p.includes("tutoie"), "kein Stilsatz bei null");
});

// (3) gueltige ID -> lokalisierte Klausel ersetzt die Siez-Zeile; Stil-ID aus Tenant-
// Settings, Sprache aus call.language (echte Komposition). Vollstaendigkeit ueber alle
// drei Sprachen (Drift gegen PERSONA_STYLE_IDS faellt hier auf).
for (const lang of ["de", "fr", "en"]) {
  test(`PS3 ${lang}: warm/formell ersetzen die Siez-Zeile`, () => {
    const warm = systemPrompt(call({ tenantId: T_WARM, direction: "outbound", language: lang }));
    assert.ok(warm.includes(`und effizient. ${WARM[lang]}`), "warm-Klausel eingewoben");
    assert.ok(!warm.includes(NEUTRAL), "Siez-Zeile ersetzt (warm)");

    const formell = systemPrompt(
      call({ tenantId: T_FORMELL, direction: "outbound", language: lang }),
    );
    assert.ok(formell.includes(`und effizient. ${FORMELL[lang]}`), "formell-Klausel eingewoben");
    // Die fixen Regeln bleiben in JEDEM Fall unveraendert.
    for (const p of [warm, formell]) {
      assert.ok(p.includes(FIXED_RULE_KURZ), "Laengen-Regel fix");
      assert.ok(p.includes(FIXED_RULE_FRAGE), "eine-Frage-Regel fix");
      assert.ok(p.includes(FIXED_RULE_ENDCALL), "end_call-Regel fix");
    }
  });
}

// (4) Freitext/unbekannt fail-closed: updateSettings verwirft, changed enthaelt agentStyle
// NICHT, der gespeicherte Wert bleibt null -> kein Freitext im Prompt.
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

// (5) Offenlegung + openingText byte-identisch null vs. gesetzt (Achse A unberuehrt).
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
