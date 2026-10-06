import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall, makeConfigOverrides } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, MANDATE_OUT_OF_SCOPE } from "../src/store/defaults.js";

const OWNER_FIRST_NAME = "Jonas";
const OWNER = `${OWNER_FIRST_NAME} Beispiel`;
const CONSULT = "get_consult";
const TAKE_MESSAGE = "take_message";
const DE_CONSULT_HEADING = "WENN DIE ENTSCHEIDUNG NICHT DEINE IST:";
const EN_CONSULT_HEADING = "WHEN THE DECISION IS NOT YOURS:";
const FR_CONSULT_HEADING = "QUAND LA DÉCISION N'EST PAS LA TIENNE :";

const BESTAND_DE = Object.freeze({
  noLookup:
    "- Du kannst nichts nachschlagen, nichts recherchieren und niemanden weiterverbinden. Wird das verlangt, sagst du das ehrlich und nimmst das Anliegen als Nachricht auf.",
  noAskingAboutOwner: `- Fehlt dir eine Angabe über ${OWNER_FIRST_NAME} oder dessen Sachen, fragst du NIEMALS dein Gegenüber danach - es kann das nicht wissen. Du klärst das auf deiner Seite oder nimmst das Anliegen als Nachricht auf.`,
  outOfScope: `AUSSERHALB DEINES SPIELRAUMS: Sag klar, dass du das nicht selbst zusagen kannst. Halte das Angebot mit allen Details fest - Tag, Uhrzeit, Preis und bis wann es gilt -, gib es über take_message weiter und sag zu, dass ${OWNER_FIRST_NAME} sich meldet.`,
  declineOutOfScope:
    "AUSSERHALB DEINES SPIELRAUMS: Sag klar, dass du das nicht zusagen kannst, und lehne höflich ab, ohne ein Gegenangebot zu machen.",
});

const FULL_MANDATE = Object.freeze({
  decide_freely: "Jeder Termin Di-Do zwischen 14 und 18 Uhr",
  fallback_order: "1. Donnerstag 15 Uhr, 2. Mittwoch 16 Uhr, 3. naechste Woche",
});

let systemPrompt, config, withConfigOverrides;

before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls: [],
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
    }),
  );
  process.env.IN_CALL_CONSULT_ENABLED = "true";
  process.env.CONSULT_ENABLED = "true";
  process.env.ASSISTANT_CONTEXT_ENABLED = "true";
  process.env.EXA_API_KEY = "test-wwp3-exa-key";
  ({ config } = await import("../src/config.js"));
  ({ systemPrompt } = await import("../src/claude.js"));
  ({ withConfigOverrides } = makeConfigOverrides(config));
});

function callFor({
  language = "de",
  direction = "outbound",
  mandate = null,
  consultPolling = true,
} = {}) {
  const now = new Date();
  return seedCall({
    tenantId: BOOTSTRAP_TENANT_ID,
    language,
    direction,
    mandate,
    status: "active",
    answeredAt: now.toISOString(),
    startedAt: now.toISOString(),
    consultPolledAtMs: consultPolling ? Date.now() : 0,
  });
}

const withLookup = (on, fn) => withConfigOverrides({ lookupEnabled: on }, fn);
const promptFor = (opts, lookupOn = false) =>
  withLookup(lookupOn, () => systemPrompt(callFor(opts)));
const countOf = (text, needle) => text.split(needle).length - 1;

test("WW-P3-1: get_consult angeboten - der Rueckfrage-Weg steht woertlich im Prompt (Faelle a, a2, c, d)", () => {
  const cases = {
    a: promptFor({ mandate: FULL_MANDATE }, false),
    a2: promptFor({ mandate: FULL_MANDATE }, true),
    c: promptFor({ mandate: null }, false),
    d: promptFor({ mandate: { decide_freely: FULL_MANDATE.decide_freely } }, false),
  };
  for (const [name, prompt] of Object.entries(cases)) {
    assert.ok(prompt.includes(DE_CONSULT_HEADING), `Fall ${name}: Rueckfrage-Block fehlt`);
    assert.ok(countOf(prompt, CONSULT) >= 1, `Fall ${name}: get_consult kommt nicht woertlich vor`);
    assert.equal(
      countOf(prompt, DE_CONSULT_HEADING),
      1,
      `Fall ${name}: Block steht nicht genau einmal`,
    );
  }
});

test("WW-P3-2: get_consult NICHT angeboten - kein get_consult im Prompt, Bestandswortlaut unveraendert", () => {
  const prompt = promptFor({ mandate: FULL_MANDATE, consultPolling: false }, false);

  assert.equal(countOf(prompt, CONSULT), 0, "Prompt zeigt auf ein Werkzeug, das im Zug fehlt");
  assert.ok(!prompt.includes(DE_CONSULT_HEADING), "Rueckfrage-Block rendert ohne Werkzeug");
  assert.ok(prompt.includes(BESTAND_DE.noLookup), "noLookup-Zeile weicht vom Bestandswortlaut ab");
  assert.ok(
    prompt.includes(BESTAND_DE.noAskingAboutOwner),
    "GRENZEN-Ausweg weicht vom Bestandswortlaut ab",
  );
  assert.ok(
    prompt.includes(BESTAND_DE.outOfScope),
    "AUSSERHALB-Ausgang weicht vom Bestandswortlaut ab",
  );
});

test("WW-P3-3: Inbound (Fall b) - das Richtungs-Gate haelt, kein get_consult im Prompt", () => {
  const prompt = promptFor({ direction: "inbound", consultPolling: true }, false);
  assert.equal(
    countOf(prompt, CONSULT),
    0,
    "Inbound-Prompt nennt ein Werkzeug, das Inbound nie hat",
  );
  assert.ok(!prompt.includes(DE_CONSULT_HEADING));
});

test("WW-P3-4: die drei Routing-Bloecke schicken den Fall nicht mehr exklusiv auf die Nachricht", () => {
  const prompt = promptFor({ mandate: FULL_MANDATE }, false);

  assert.ok(
    !prompt.includes(BESTAND_DE.outOfScope),
    "AUSSERHALB-Ausgang zeigt weiter nur auf take_message",
  );
  assert.match(prompt, /AUSSERHALB DEINES SPIELRAUMS:[^\n]*get_consult/);
  assert.ok(!prompt.includes(BESTAND_DE.noAskingAboutOwner), "GRENZEN-Ausweg bleibt der alte");
  assert.match(prompt, /Fehlt dir eine Angabe über [^\n]*get_consult/);
  assert.match(prompt, /nichts recherchieren[^\n]*get_consult/);

  assert.ok(prompt.includes(TAKE_MESSAGE), "take_message verschwindet aus dem Prompt");
});

test("WW-P3-5: die Entscheidungsschwelle steht im Block - verbindlich zusagen nur im eigenen Rahmen, samt Gegenrichtung", () => {
  const prompt = promptFor({ mandate: FULL_MANDATE }, false);
  const block = prompt.slice(prompt.indexOf(DE_CONSULT_HEADING));

  assert.match(block, /auch dann, wenn dein Gegenüber gar nicht ausdrücklich danach fragt/);
  assert.match(block, /Verbindlich zusagen darfst du NUR/);
  assert.match(block, /rufst get_consult NICHT auf/);
  assert.match(block, /fragst du nie zurück/);
});

test("WW-P3-6: DECLINE-Mandat behaelt seinen Wortlaut, auch wenn get_consult im Zug steht", () => {
  const prompt = promptFor(
    { mandate: { ...FULL_MANDATE, on_out_of_scope: MANDATE_OUT_OF_SCOPE.DECLINE } },
    false,
  );
  assert.ok(prompt.includes(BESTAND_DE.declineOutOfScope), "DECLINE-Ausgang wurde umformuliert");
  assert.ok(prompt.includes(DE_CONSULT_HEADING));
});

test("WW-P3-7: Sprach-Paritaet - der Block rendert in DE/EN/FR, nennt get_consult und mischt die Sprachen nicht", () => {
  const headings = { de: DE_CONSULT_HEADING, en: EN_CONSULT_HEADING, fr: FR_CONSULT_HEADING };
  const prompts = {};
  for (const language of Object.keys(headings)) {
    prompts[language] = promptFor({ language, mandate: FULL_MANDATE }, false);
  }
  for (const [language, heading] of Object.entries(headings)) {
    assert.equal(
      countOf(prompts[language], heading),
      1,
      `${language}: Block fehlt oder steht doppelt`,
    );
    assert.ok(prompts[language].includes(CONSULT), `${language}: get_consult wird nicht genannt`);
  }
  assert.ok(!prompts.de.includes(EN_CONSULT_HEADING));
  assert.ok(!prompts.de.includes(FR_CONSULT_HEADING));
  assert.ok(!prompts.en.includes(DE_CONSULT_HEADING));
  assert.ok(!prompts.fr.includes(DE_CONSULT_HEADING));
});

test("WW-P3-8: der Block ist die EINZIGE Differenz - ohne Werkzeug bleibt der Prompt Bestand", () => {
  const withConsult = promptFor({ mandate: FULL_MANDATE }, false);
  const withoutConsult = promptFor({ mandate: FULL_MANDATE, consultPolling: false }, false);

  const blockStart = withConsult.indexOf(DE_CONSULT_HEADING);
  const blockEnd = withConsult.indexOf("\n\n", blockStart) + 2;
  const withoutBlock = withConsult.slice(0, blockStart) + withConsult.slice(blockEnd);

  const headingsOf = (text) =>
    text
      .split("\n")
      .filter((line) => /^[A-ZÄÖÜ][A-ZÄÖÜ ]+:/.test(line))
      .map((line) => line.slice(0, line.indexOf(":")));
  assert.deepEqual(
    headingsOf(withoutBlock),
    headingsOf(withoutConsult),
    "Abschnitts-Folge verschoben",
  );
  assert.equal(
    withoutBlock.split("\n").length,
    withoutConsult.split("\n").length,
    "der Block ist nicht die einzige strukturelle Differenz",
  );
});
