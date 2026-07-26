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
// P5: DE traegt jetzt Umlaute (D3); der Katalog-KEY "warm-persoenlich" bleibt
// unveraendert (D5 - ein Key-Rename braeche jeden Tenant mit gesetztem agentStyle).
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
// P11: Neutral-Anrede pro Sprache (i18n/locales.js NEUTRAL_ADDRESS_CLAUSE_*), fuer die
// strukturelle PS3-Pruefung unten (Golden-Master-Pin wie WARM/FORMELL).
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
// personal-assistant-characterization (P0/P5, laeuft ebenfalls bei null).
test("PS2 agentStyle=null: Siez-Zeile byte-identisch im fixen Kontext, kein Stilsatz", () => {
  const p = systemPrompt(call({ direction: "outbound", language: "de" }));
  assert.ok(
    p.includes(`- ${NEUTRAL} Freundlich, konkret, ohne Floskelketten.`),
    "Bestands-Siez-Zeile unveraendert, direkt gefolgt von der fixen Kontext-Klausel",
  );
  assert.ok(!p.includes("duze") && !p.includes("tutoie"), "kein Stilsatz bei null");
});

// (3) gueltige ID -> lokalisierte Klausel ersetzt die Anrede-Klausel; Stil-ID aus
// Tenant-Settings, Sprache aus call.language (echte Komposition). Vollstaendigkeit ueber
// alle drei Sprachen (Drift gegen PERSONA_STYLE_IDS faellt hier auf).
//
// P11: die fixen Zeilen (Laenge/Frage-Regel, end_call-Abschluss) sind jetzt je Sprache
// uebersetzt - kein DE-Literal-Pin mehr moeglich. Stattdessen strukturell: die
// SO-SPRICHST-DU-Sektion (Index 2 in der "\n\n"-Sektionsliste, s. claude.js systemPrompt)
// und die letzte Sektion (Abschluss) bleiben zwischen neutral/warm/formell IDENTISCH bis
// auf die ausgetauschte Stil-Klausel. INBOUND (nicht outbound): die outbound-SITUATION
// enthaelt selbst ein internes "\n\n" (Situation + Auftragsblock, claude.js
// outboundSituation) und wuerde die Split-Indizes verschieben - inbound bleibt 1:1 zur
// systemPrompt-Array-Reihenfolge.
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

    // Fixe Zeilen der SO-SPRICHST-DU-Sektion bleiben identisch, nur die Stil-Klausel
    // wechselt (strukturelle Gleichheit statt DE-Literal-Pin).
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

    // Abschluss-Sektion (end_call) bleibt in JEDEM Fall unveraendert.
    assert.equal(warmSections[lastIdx], neutralSections[lastIdx], `end_call-Abschluss fix, warm (${lang})`);
    assert.equal(
      formellSections[lastIdx],
      neutralSections[lastIdx],
      `end_call-Abschluss fix, formell (${lang})`,
    );
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
